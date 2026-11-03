import { generateWithProvider, providerFailure } from './aiProvider.ts'
import type { AIProvider, GenerationRequest, GenerationResult } from './aiProvider.ts'

export interface OllamaOptions {
  baseUrl?: string
  model?: string
  /** Trusted transport injection for offline tests, never supplied through /api/ask. */
  fetch?: typeof fetch
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Backend-only transport. Uses the existing wrapper for deadlines, cancellation and sanitized failures. */
export class OllamaProvider implements AIProvider {
  readonly providerId = 'ollama'
  readonly modelId: string
  private readonly endpoint: string | undefined
  private readonly fetcher: typeof fetch

  constructor(options: OllamaOptions = {}) {
    this.modelId = options.model ?? process.env.OLLAMA_MODEL ?? 'qwen3:1.7b'
    this.fetcher = options.fetch ?? globalThis.fetch
    const base = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
    try {
      const url = new URL(base)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.search || url.hash || url.pathname !== '/' || base !== base.trim()
        || !/^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,127}$/.test(this.modelId)) return
      this.endpoint = new URL('/api/chat', url).href
    } catch { /* Invalid deployment configuration fails closed when called, without breaking other APIs. */ }
  }

  generate(request: GenerationRequest): Promise<GenerationResult> {
    if (request.responseFormat !== 'json') return Promise.resolve(providerFailure('INVALID_REQUEST'))
    return generateWithProvider({
      providerId: this.providerId, modelId: this.modelId,
      generate: input => this.chat(input),
    }, request.messages, { timeoutMs: request.timeoutMs, signal: request.signal })
  }

  private async chat(request: GenerationRequest): Promise<GenerationResult> {
    if (!this.endpoint) {
      console.warn('[PHAROS Ollama] INVALID_CONFIGURATION')
      return providerFailure('UNAVAILABLE')
    }
    let response: Response
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'POST', redirect: 'error', signal: request.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ model: this.modelId, messages: request.messages,
          stream: false, format: 'json', think: false, options: { temperature: 0, num_predict: 768 } }),
      })
    } catch {
      // Fixed categories only: never log request data, URLs, exceptions or response bodies.
      console.warn('[PHAROS Ollama]', request.signal.aborted ? 'REQUEST_ABORTED' : 'CONNECTION_FAILURE')
      return providerFailure('UNAVAILABLE')
    }
    // Never return or log Ollama error bodies, reasoning, prompts or transport exceptions.
    if (!response.ok) {
      console.warn('[PHAROS Ollama] HTTP_FAILURE', response.status)
      await response.body?.cancel().catch(() => {})
      return providerFailure(response.status >= 500 ? 'UNAVAILABLE' : 'PROVIDER_ERROR')
    }
    try {
      if (!response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel().catch(() => {})
        return providerFailure('INVALID_RESPONSE')
      }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          request.signal.throwIfAborted()
          const next = await reader.read()
          if (next.done) break
          size += next.value.byteLength
          if (size > 256 * 1024) return providerFailure('INVALID_RESPONSE')
          chunks.push(next.value)
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
      if (!object(data)) return providerFailure('INVALID_RESPONSE')
      if (Object.hasOwn(data, 'error')) return providerFailure('PROVIDER_ERROR')
      const message = data.message
      const expectedModel = this.modelId.includes(':') ? this.modelId : `${this.modelId}:latest`
      if ((data.model !== this.modelId && data.model !== expectedModel) || data.done !== true || data.done_reason !== 'stop'
        || !object(message) || message.role !== 'assistant' || message.tool_calls !== undefined
        || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 200_000) {
        return providerFailure('INVALID_RESPONSE')
      }
      // Only content is returned. Ignore message.thinking, and reject inline reasoning blocks rather than exposing them.
      const parsed: unknown = JSON.parse(message.content)
      if (!object(parsed) || /<\/?(?:think|analysis|reasoning)\b/i.test(JSON.stringify(parsed))) return providerFailure('INVALID_RESPONSE')
      return { ok: true, value: { providerId: this.providerId, modelId: this.modelId,
        content: JSON.stringify(parsed), finishReason: 'completed' } }
    } catch { return providerFailure('INVALID_RESPONSE') }
  }
}
