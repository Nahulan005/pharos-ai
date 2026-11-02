export interface AIMessage { role: 'system' | 'user'; content: string }
export interface GenerationRequest {
  messages: readonly AIMessage[]
  responseFormat: 'json'
  timeoutMs: number
  signal: AbortSignal
}
export interface GenerationResponse {
  providerId: string
  modelId: string
  content: string
  finishReason: 'completed' | 'length'
}
export type ProviderErrorCode = 'INVALID_REQUEST' | 'TIMEOUT' | 'CANCELLED'
  | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'PROVIDER_ERROR'
export type GenerationResult = { ok: true; value: GenerationResponse }
  | { ok: false; error: { code: ProviderErrorCode; message: string } }
export interface AIProvider {
  readonly providerId: string
  readonly modelId: string
  /** Adapters must propagate signal and return typed failures; importing one must not perform I/O. */
  generate(request: GenerationRequest): Promise<GenerationResult>
}
export interface GenerationOptions { timeoutMs?: number; signal?: AbortSignal }

const errorMessages: Record<ProviderErrorCode, string> = {
  INVALID_REQUEST: 'Generation request is invalid.', TIMEOUT: 'Generation timed out.',
  CANCELLED: 'Generation was cancelled.', UNAVAILABLE: 'AI provider is unavailable.',
  INVALID_RESPONSE: 'AI provider returned an invalid response.', PROVIDER_ERROR: 'AI generation failed.',
}
export function providerFailure(code: ProviderErrorCode): Extract<GenerationResult, { ok: false }> {
  return { ok: false, error: { code, message: errorMessages[code] } }
}

/** Enforce caller-visible deadlines/cancellation even if an injected adapter ignores its signal. */
export async function generateWithProvider(
  provider: AIProvider, messages: readonly AIMessage[], options: GenerationOptions = {},
): Promise<GenerationResult> {
  const timeoutMs = options.timeoutMs ?? 60_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000
    || !provider.providerId?.trim() || !provider.modelId?.trim()
    || !Array.isArray(messages) || messages.length !== 2
    || messages[0]?.role !== 'system' || messages[1]?.role !== 'user'
    || messages.some(message => typeof message.content !== 'string' || !message.content.trim())) {
    return providerFailure('INVALID_REQUEST')
  }
  if (options.signal?.aborted) return providerFailure('CANCELLED')
  const controller = new AbortController()
  let stop!: (value: GenerationResult) => void
  const stopped = new Promise<GenerationResult>(resolve => { stop = resolve })
  const cancel = () => { stop(providerFailure('CANCELLED')); controller.abort() }
  options.signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => { stop(providerFailure('TIMEOUT')); controller.abort() }, timeoutMs)
  try {
    const operation = Promise.resolve().then(() => {
      if (controller.signal.aborted) return providerFailure('CANCELLED')
      return provider.generate({ messages: structuredClone(messages), responseFormat: 'json', timeoutMs, signal: controller.signal })
    })
    const result = await Promise.race([operation, stopped])
    if (!result || typeof result !== 'object') return providerFailure('INVALID_RESPONSE')
    if (result.ok === false) {
      const code = result.error?.code
      return providerFailure(Object.hasOwn(errorMessages, code ?? '') ? code : 'PROVIDER_ERROR')
    }
    if (result.ok !== true || !result.value || result.value.providerId !== provider.providerId
      || result.value.modelId !== provider.modelId || typeof result.value.content !== 'string'
      || !result.value.content.trim() || result.value.content.length > 200_000
      || result.value.finishReason !== 'completed') return providerFailure('INVALID_RESPONSE')
    return { ok: true, value: { providerId: provider.providerId, modelId: provider.modelId,
      content: result.value.content, finishReason: 'completed' } }
  } catch { return providerFailure(controller.signal.aborted ? 'CANCELLED' : 'PROVIDER_ERROR') }
  finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
    controller.abort()
  }
}
