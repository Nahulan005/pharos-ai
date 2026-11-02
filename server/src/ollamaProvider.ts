import { providerFailure } from './aiProvider.ts'
import type { AIProvider, GenerationRequest, GenerationResult, ProviderErrorCode } from './aiProvider.ts'

export type OllamaFetch = (url: string, init: RequestInit) => Promise<Response>
export interface OllamaProviderOptions {
  /** Explicit dependency: tests inject mocks; a live caller must deliberately pass globalThis.fetch. */
  fetch: OllamaFetch
  baseUrl?: string
  modelId?: string
  maxResponseBytes?: number
  maxOutputTokens?: number
}

function endpoint(base: string): string {
  try {
    if (base !== base.trim() || /[\s\\\u0000-\u001f\u007f]/u.test(base)) throw new Error()
    const url = new URL(base)
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error()
    // Avoid DNS for localhost. Alternate loopback IP encodings are normalized by URL.
    if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
    url.pathname = '/api/chat'
    return url.href
  } catch { throw new RangeError('Ollama base URL must be a loopback HTTP(S) origin without credentials or a path.') }
}
class AdapterFailure extends Error {
  constructor(readonly code: ProviderErrorCode) { super(code) }
}
function fail(code: ProviderErrorCode): never { throw new AdapterFailure(code) }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Local Ollama /api/chat adapter. Construction/import never performs I/O. No install/pull/start operations. */
export class OllamaProvider implements AIProvider {
  readonly providerId = 'ollama'
  readonly modelId: string
  private readonly url: string
  private readonly fetcher: OllamaFetch
  private readonly maxBytes: number
  private readonly maxOutputTokens: number

  constructor(options: OllamaProviderOptions) {
    if (typeof options?.fetch !== 'function') throw new TypeError('An explicit Ollama HTTP dependency is required.')
    this.fetcher = options.fetch
    this.url = endpoint(options.baseUrl ?? 'http://127.0.0.1:11434')
    this.modelId = options.modelId ?? 'qwen3:1.7b'
    this.maxBytes = options.maxResponseBytes ?? 512 * 1024
    this.maxOutputTokens = options.maxOutputTokens ?? 2048
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:\-]{0,127}$/.test(this.modelId) || this.modelId.includes('://')
      || !Number.isInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > 1024 * 1024
      || !Number.isInteger(this.maxOutputTokens) || this.maxOutputTokens < 1 || this.maxOutputTokens > 8192) {
      throw new RangeError('Ollama model or generation limits are invalid.')
    }
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    if (!request || request.responseFormat !== 'json' || !(request.signal instanceof AbortSignal)
      || !Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 300_000
      || !Array.isArray(request.messages) || request.messages.length !== 2
      || request.messages[0]?.role !== 'system' || request.messages[1]?.role !== 'user'
      || request.messages.some(message => typeof message?.content !== 'string' || !message.content.trim())) {
      return providerFailure('INVALID_REQUEST')
    }
    if (request.signal.aborted) return providerFailure('CANCELLED')
    // Snapshot before awaiting; only role/content are forwarded, never caller-supplied tools or options.
    const body = JSON.stringify({ model: this.modelId,
      messages: request.messages.map(message => ({ role: message.role, content: message.content })),
      stream: false, format: 'json', think: false,
      options: { temperature: 0, num_predict: this.maxOutputTokens },
    })
    if (Buffer.byteLength(body) > 1024 * 1024) return providerFailure('INVALID_REQUEST')
    const controller = new AbortController()
    let stoppedCode: ProviderErrorCode | undefined
    let stop!: (result: GenerationResult) => void
    const stopped = new Promise<GenerationResult>(resolve => { stop = resolve })
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const cancelBody = () => { if (reader) void reader.cancel().catch(() => {}) }
    const abort = (code: ProviderErrorCode) => {
      if (stoppedCode) return
      stoppedCode = code
      stop(providerFailure(code))
      controller.abort()
      cancelBody()
    }
    const cancel = () => abort('CANCELLED')
    request.signal.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => abort('TIMEOUT'), request.timeoutMs)
    const operation = async (): Promise<GenerationResult> => {
      const response = await this.fetcher(this.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'identity' },
        body, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
      })
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {})
        return providerFailure(stoppedCode ?? 'CANCELLED')
      }
      reader = response.body?.getReader()
      if (response.redirected || (response.url && response.url !== this.url)
        || (response.status >= 300 && response.status < 400)) fail('INVALID_RESPONSE')
      if ([404, 429, 502, 503, 504].includes(response.status)) fail('UNAVAILABLE')
      if (response.status !== 200) fail('PROVIDER_ERROR')
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type') ?? '')
        || !['identity', null].includes(response.headers.get('content-encoding'))) fail('INVALID_RESPONSE')
      const declared = response.headers.get('content-length')
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > this.maxBytes)) fail('INVALID_RESPONSE')
      if (!reader) fail('INVALID_RESPONSE')
      const chunks: Buffer[] = []
      let size = 0
      while (true) {
        const { done, value } = await reader.read()
        controller.signal.throwIfAborted()
        if (done) break
        if (!(value instanceof Uint8Array)) fail('INVALID_RESPONSE')
        size += value.byteLength
        if (size > this.maxBytes) fail('INVALID_RESPONSE')
        chunks.push(Buffer.from(value))
      }
      if (declared !== null && Number(declared) !== size) fail('INVALID_RESPONSE')
      let envelope: unknown
      try {
        envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
      } catch { return providerFailure('INVALID_RESPONSE') }
      if (!object(envelope)) fail('INVALID_RESPONSE')
      if (Object.hasOwn(envelope, 'error')) fail('PROVIDER_ERROR')
      if (envelope.model !== this.modelId || envelope.done !== true || !object(envelope.message)
        || envelope.message.role !== 'assistant'
        || (envelope.done_reason !== 'stop' && envelope.done_reason !== 'length')
        || typeof envelope.message.content !== 'string' || !envelope.message.content.trim()
        || envelope.message.content.length > 200_000
        || (envelope.message.tool_calls !== undefined
          && (!Array.isArray(envelope.message.tool_calls) || envelope.message.tool_calls.length > 0))) fail('INVALID_RESPONSE')
      // message.thinking is intentionally discarded. Never splice reasoning into answer text.
      const content = envelope.message.content
      if (/<\/?think\b/i.test(content)) fail('INVALID_RESPONSE')
      if (envelope.done_reason === 'stop') {
        try { if (!object(JSON.parse(content))) return providerFailure('INVALID_RESPONSE') }
        catch { return providerFailure('INVALID_RESPONSE') }
      }
      return { ok: true, value: { providerId: this.providerId, modelId: this.modelId, content,
        finishReason: envelope.done_reason === 'length' ? 'length' : 'completed' } }
    }
    try { return await Promise.race([operation(), stopped]) }
    catch (error) {
      return providerFailure(stoppedCode ?? (error instanceof AdapterFailure ? error.code : 'UNAVAILABLE'))
    } finally {
      clearTimeout(timer)
      request.signal.removeEventListener('abort', cancel)
      controller.abort()
      cancelBody()
    }
  }
}
