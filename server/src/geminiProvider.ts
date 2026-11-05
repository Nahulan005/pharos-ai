import { generateWithProvider, providerFailure } from './aiProvider.ts'
import type { AIProvider, GenerationRequest, GenerationResult } from './aiProvider.ts'

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Backend-only Gemini REST transport. No tools, web search, SDK, retries or credential logging. */
export class GeminiProvider implements AIProvider {
  readonly providerId = 'gemini'
  readonly modelId: string
  readonly #apiKey = process.env.GEMINI_API_KEY
  private readonly fetcher: typeof fetch
  constructor(options: { model?: string; fetch?: typeof fetch } = {}) {
    this.modelId = options.model ?? process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite'
    this.fetcher = options.fetch ?? globalThis.fetch
  }
  generate(request: GenerationRequest): Promise<GenerationResult> {
    if (request.responseFormat !== 'json') return Promise.resolve(providerFailure('INVALID_REQUEST'))
    return generateWithProvider({ providerId: this.providerId, modelId: this.modelId, generate: input => this.chat(input) },
      request.messages, { timeoutMs: request.timeoutMs, signal: request.signal })
  }
  private async chat(request: GenerationRequest): Promise<GenerationResult> {
    if (!this.#apiKey || !/^[\x21-\x7e]+$/.test(this.#apiKey) || !/^gemini-[a-z0-9.-]{1,100}$/.test(this.modelId)) return providerFailure('UNAVAILABLE')
    let response: Response
    try {
      response = await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:generateContent`, {
        method: 'POST', redirect: 'error', signal: request.signal,
        headers: { 'x-goog-api-key': this.#apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: request.messages[0].content }] },
          contents: [{ role: 'user', parts: [{ text: request.messages[1].content }] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4096, candidateCount: 1 } }),
      })
    } catch { return providerFailure('UNAVAILABLE') }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return providerFailure(response.status === 429 || response.status >= 500 ? 'UNAVAILABLE' : 'PROVIDER_ERROR')
    }
    try {
      if (!response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel().catch(() => {})
        return providerFailure('INVALID_RESPONSE')
      }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
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
      if (data.error !== undefined) return providerFailure('PROVIDER_ERROR')
      if ((object(data.promptFeedback) && data.promptFeedback.blockReason)
        || !Array.isArray(data.candidates) || data.candidates.length !== 1) return providerFailure('INVALID_RESPONSE')
      const candidate = data.candidates[0]
      if (!object(candidate) || candidate.finishReason !== 'STOP' || !object(candidate.content)
        || candidate.content.role !== 'model' || !Array.isArray(candidate.content.parts)
        || candidate.groundingMetadata != null || candidate.citationMetadata != null) return providerFailure('INVALID_RESPONSE')
      const parts: string[] = []
      for (const part of candidate.content.parts) {
        if (!object(part)) return providerFailure('INVALID_RESPONSE')
        if (part.thought === true) continue // Never expose thought parts or signatures.
        if (typeof part.text !== 'string' || Object.keys(part).some(k => !['text', 'thought', 'thoughtSignature'].includes(k))) return providerFailure('INVALID_RESPONSE')
        parts.push(part.text)
      }
      const content = parts.join('')
      if (!content.trim() || content.length > 100_000) return providerFailure('INVALID_RESPONSE')
      const parsed: unknown = JSON.parse(content)
      if (!object(parsed) || /<\/?(?:think|analysis|reasoning)\b/i.test(JSON.stringify(parsed))) return providerFailure('INVALID_RESPONSE')
      return { ok: true, value: { providerId: this.providerId, modelId: this.modelId,
        content: JSON.stringify(parsed), finishReason: 'completed' } }
    } catch { return providerFailure('INVALID_RESPONSE') }
  }
}
