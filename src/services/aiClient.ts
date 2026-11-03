import type { AIClient, AIResponse, AskOptions } from '../models/ai'
import { safeSourceUrl } from '../lib/opportunities'
import type { StudentProfile } from '../models/studentProfile'

export class AIUnavailableError extends Error {
  constructor() { super('PHAROS AI Research is not connected yet.'); this.name = 'AIUnavailableError' }
}
export class AIRequestError extends Error {
  constructor(public readonly code: 'invalid-question' | 'network' | 'timeout' | 'cancelled' | 'invalid-response' | 'server', message: string) {
    super(message); this.name = 'AIRequestError'
  }
}
export const MAX_QUESTION_LENGTH = 4000
const invalidResponse = () => new AIRequestError('invalid-response', 'The research service returned an invalid response. No answer was displayed.')

/** Reject unsafe citations instead of presenting an answer whose grounding cannot be displayed safely. */
export function parseAIResponse(value: unknown): AIResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse()
  const data = value as Record<string, unknown>
  if (typeof data.answer !== 'string' || !data.answer.trim() || data.answer.length > 100_000
    || typeof data.grounded !== 'boolean' || !Array.isArray(data.citations) || data.citations.length > 30) throw invalidResponse()
  const citations = data.citations.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse()
    const citation = value as Record<string, unknown>
    if (typeof citation.title !== 'string' || !citation.title.trim() || citation.title.length > 500
      || typeof citation.url !== 'string' || citation.url.length > 4096 || !safeSourceUrl(citation.url)
      || (citation.recordId !== undefined && (typeof citation.recordId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(citation.recordId)))) throw invalidResponse()
    return { title: citation.title.trim(), url: safeSourceUrl(citation.url)!, ...(citation.recordId === undefined ? {} : { recordId: citation.recordId as string }) }
  })
  if (data.grounded && citations.length === 0) throw invalidResponse()
  return { answer: data.answer.trim(), citations, grounded: data.grounded }
}

function endpointFor(baseUrl: string | undefined): string | null {
  if (!baseUrl?.trim()) return null
  try {
    const base = new URL(baseUrl.trim())
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) return null
    return `${base.href.replace(/\/$/, '')}/api/ask`
  } catch { return null }
}

/** Only the PHAROS backend is called. This client never calls Ollama or synthesizes answers. */
export function createAIClient(baseUrl?: string, fetcher: typeof fetch = (...args) => fetch(...args)): AIClient {
  const endpoint = endpointFor(baseUrl)
  return {
    configured: endpoint !== null,
    async ask(question: string, options: AskOptions = {}): Promise<AIResponse> {
      if (!endpoint) throw new AIUnavailableError()
      if (typeof question !== 'string' || !question.trim() || question.trim().length > MAX_QUESTION_LENGTH) {
        throw new AIRequestError('invalid-question', `Enter a question of 1–${MAX_QUESTION_LENGTH} characters.`)
      }
      const timeoutMs = options.timeoutMs ?? 60_000
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) throw new AIRequestError('timeout', 'Request timeout must be between 1 and 300000 milliseconds.')
      const controller = new AbortController()
      const cancelled = () => new AIRequestError('cancelled', 'Request cancelled. No new answer was added.')
      if (options.signal?.aborted) throw cancelled()
      let rejectStop!: (error: Error) => void
      const stopped = new Promise<never>((_, reject) => { rejectStop = reject })
      const cancel = () => { rejectStop(cancelled()); controller.abort() }
      options.signal?.addEventListener('abort', cancel, { once: true })
      const timer = setTimeout(() => {
        rejectStop(new AIRequestError('timeout', 'The research request timed out. You can try again.'))
        controller.abort()
      }, timeoutMs)
      try {
        const request = (async () => {
          const response = await fetcher(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ question: question.trim() }), signal: controller.signal,
            credentials: 'omit', redirect: 'error',
          })
          if ([404, 502, 503, 504].includes(response.status)) throw new AIUnavailableError()
          if (!response.ok) throw new AIRequestError('server', 'The research service could not answer this request. Try again later.')
          let data: unknown
          try { data = await response.json() } catch { throw invalidResponse() }
          return parseAIResponse(data)
        })()
        return await Promise.race([request, stopped])
      } catch (error) {
        if (error instanceof AIUnavailableError || error instanceof AIRequestError) throw error
        throw new AIRequestError('network', 'Could not reach the research backend. Check your connection and try again.')
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', cancel)
      }
    },
  }
}

export const aiClient = createAIClient(import.meta.env.VITE_API_BASE_URL)
export const ask = (question: string, options?: AskOptions) => aiClient.ask(question, options)

/** Same-origin PHAROS API through the existing /api proxy. No defaults are sent as saved preferences. */
export async function explainOpportunity(id: string, profile: StudentProfile | null, signal?: AbortSignal): Promise<AIResponse> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new AIRequestError('server', 'Invalid opportunity ID.')
  const requestSignal = AbortSignal.any([AbortSignal.timeout(35_000), ...(signal ? [signal] : [])])
  try {
    requestSignal.throwIfAborted()
    const response = await fetch(`/api/opportunities/${id}/explanation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'omit', redirect: 'error', signal: requestSignal,
      body: JSON.stringify({ profile: { careerInterests: profile?.careerInterests ?? [],
        skills: profile?.skills ?? [], weeklyLearningHours: profile?.weeklyLearningHours ?? null } }),
    })
    if (!response.ok) throw new AIRequestError('server', 'The explanation could not be loaded. Check that the backend is running and try again.')
    const result = parseAIResponse(await response.json())
    if (result.grounded || result.citations.length) throw invalidResponse()
    return result
  } catch (error) {
    if (signal?.aborted) throw new AIRequestError('cancelled', 'Explanation cancelled.')
    if (requestSignal.aborted) throw new AIRequestError('timeout', 'The explanation timed out. Try again.')
    if (error instanceof AIRequestError) throw error
    throw new AIRequestError('network', 'Could not load an explanation. Check the backend connection and try again.')
  }
}
