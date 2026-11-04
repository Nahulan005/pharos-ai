import { generateWithProvider, providerFailure } from './aiProvider.ts'
import type { AIProvider, GenerationRequest, GenerationResult } from './aiProvider.ts'

export interface GroqOptions {
  model?: string
  /** Trusted test transport only; never accepted from an API request. */
  fetch?: typeof fetch
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Backend-only, fixed HTTPS destination. Credentials come exclusively from the server environment. */
export class GroqProvider implements AIProvider {
  readonly providerId = 'groq'
  readonly modelId: string
  readonly #apiKey: string | undefined
  private readonly fetcher: typeof fetch

  constructor(options: GroqOptions = {}) {
    this.modelId = options.model ?? process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant'
    this.#apiKey = process.env.GROQ_API_KEY
    this.fetcher = options.fetch ?? globalThis.fetch
  }

  generate(request: GenerationRequest): Promise<GenerationResult> {
    if (request.responseFormat !== 'json') return Promise.resolve(providerFailure('INVALID_REQUEST'))
    return generateWithProvider({ providerId: this.providerId, modelId: this.modelId,
      generate: input => this.chat(input),
    }, request.messages, { timeoutMs: request.timeoutMs, signal: request.signal })
  }

  private async chat(request: GenerationRequest): Promise<GenerationResult> {
    if (!this.#apiKey || !/^[\x21-\x7e]+$/.test(this.#apiKey)
      || !/^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,127}$/.test(this.modelId)) return providerFailure('UNAVAILABLE')
    let response: Response
    try {
      response = await this.fetcher('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal: request.signal,
        headers: { Authorization: `Bearer ${this.#apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ model: this.modelId, messages: request.messages, stream: false,
          response_format: { type: 'json_object' }, temperature: 0, max_completion_tokens: 768 }),
      })
    } catch { return providerFailure('UNAVAILABLE') }
    // No retries, raw error bodies, credentials, reasoning or prompts in logs/results.
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return providerFailure(response.status === 429 || response.status >= 500 ? 'UNAVAILABLE' : 'PROVIDER_ERROR')
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
      if (data.model !== this.modelId || !Array.isArray(data.choices) || data.choices.length !== 1) return providerFailure('INVALID_RESPONSE')
      const choice: unknown = data.choices[0]
      if (!object(choice) || choice.finish_reason !== 'stop' || !object(choice.message)) return providerFailure('INVALID_RESPONSE')
      const message = choice.message
      if (message.role !== 'assistant' || message.tool_calls != null || message.function_call != null || message.refusal != null
        || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 200_000) return providerFailure('INVALID_RESPONSE')
      // Ignore separate reasoning metadata, reject inline reasoning, then let the engines validate their schemas.
      const parsed: unknown = JSON.parse(message.content)
      if (!object(parsed) || /<\/?(?:think|analysis|reasoning)\b/i.test(JSON.stringify(parsed))) return providerFailure('INVALID_RESPONSE')
      return { ok: true, value: { providerId: this.providerId, modelId: this.modelId,
        content: JSON.stringify(parsed), finishReason: 'completed' } }
    } catch { return providerFailure('INVALID_RESPONSE') }
  }
}
