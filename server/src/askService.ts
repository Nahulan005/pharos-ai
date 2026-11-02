import type { ApiError } from '../../shared/contract.ts'
import { generateWithProvider } from './aiProvider.ts'
import type { AIProvider } from './aiProvider.ts'
import { EvidenceAssessmentService } from './evidenceAssessment.ts'
import type { EvidenceInput, FreshnessPolicy } from './evidenceAssessment.ts'
import { buildGroundedPrompt } from './groundedPrompt.ts'
import { validateGroundedAnswer } from './groundedAnswer.ts'
import type { GroundedAnswerResult } from './groundedAnswer.ts'

export interface AskEvidence {
  records: readonly EvidenceInput[]
  uncertainties: readonly string[]
  reviewWarnings: readonly string[]
}
/** Trusted server-side supplier, never request-body evidence or the fictional opportunity store. */
export type AskEvidenceSupplier = (question: string, signal: AbortSignal) => Promise<AskEvidence>
export type AskResult = Extract<GroundedAnswerResult, { ok: true }>
  | { ok: false; status: number; error: ApiError['error'] }
export interface AskServiceOptions {
  provider?: AIProvider
  evidence?: AskEvidenceSupplier
  freshnessPolicy: FreshnessPolicy
  clock?: () => string
  timeoutMs?: number
  maxConcurrent?: number
}

export function validQuestion(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 4000
}
const failure = (status: number, code: string, message: string): AskResult => ({ ok: false, status, error: { code, message } })
const timeout = () => failure(504, 'AI_TIMEOUT', 'The research request timed out.')
const cancelled = () => failure(499, 'AI_CANCELLED', 'The research request was cancelled.')

export class AskService {
  private readonly assessor: EvidenceAssessmentService
  private readonly provider?: AIProvider
  private readonly evidence: AskEvidenceSupplier
  private readonly timeoutMs: number
  private readonly maxConcurrent: number
  private active = 0
  constructor(options: AskServiceOptions) {
    this.assessor = new EvidenceAssessmentService(options.freshnessPolicy, options.clock)
    this.provider = options.provider
    this.evidence = options.evidence ?? (async () => ({ records: [], uncertainties: [], reviewWarnings: [] }))
    this.timeoutMs = options.timeoutMs ?? 45_000
    this.maxConcurrent = options.maxConcurrent ?? 2
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 300_000
      || !Number.isInteger(this.maxConcurrent) || this.maxConcurrent < 1 || this.maxConcurrent > 32) {
      throw new RangeError('Ask timeout or concurrency limit is invalid.')
    }
  }

  async ask(question: string, signal?: AbortSignal): Promise<AskResult> {
    if (!validQuestion(question)) return failure(400, 'INVALID_REQUEST', 'Question must contain 1–4000 characters.')
    if (signal?.aborted) return cancelled()
    if (!this.provider) return failure(503, 'AI_UNAVAILABLE', 'PHAROS AI is not configured.')
    if (this.active >= this.maxConcurrent) return failure(429, 'AI_BUSY', 'The research service is busy. Try again later.')
    this.active++
    const controller = new AbortController()
    const startedAt = performance.now()
    let stop!: (result: AskResult) => void
    const stopped = new Promise<AskResult>(resolve => { stop = resolve })
    const cancel = () => { stop(cancelled()); controller.abort() }
    signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => { stop(timeout()); controller.abort() }, this.timeoutMs)
    const operation = async (): Promise<AskResult> => {
      let supplied: AskEvidence
      try { supplied = await this.evidence(question.trim(), controller.signal) }
      catch { return failure(503, 'EVIDENCE_UNAVAILABLE', 'Research evidence is temporarily unavailable.') }
      if (controller.signal.aborted) return cancelled()
      if (!supplied || !Array.isArray(supplied.records) || supplied.records.length > 30) {
        return failure(503, 'EVIDENCE_UNAVAILABLE', 'Research evidence is temporarily unavailable.')
      }
      // Assess server-supplied records afresh; clients cannot submit assessment flags or citation mappings.
      const prompt = buildGroundedPrompt({ question: question.trim(),
        evidence: supplied.records.map((record, index) => ({ citationId: `evidence-${index + 1}`,
          record, assessment: this.assessor.assess(record) })),
        uncertainties: supplied.uncertainties, reviewWarnings: supplied.reviewWarnings,
      })
      if (!prompt.ok) return failure(503, 'EVIDENCE_UNAVAILABLE', 'Research evidence is temporarily unavailable.')
      if (controller.signal.aborted) return cancelled()
      if (!prompt.value.references.some(reference => reference.adequate)
        || prompt.value.reviewWarnings.length || prompt.value.uncertainties.length) {
        // This is an evidence-status explanation, never a substitute answer after model failure.
        const limited = validateGroundedAnswer(JSON.stringify({
          answer: 'PHAROS cannot identify current opportunities from the evidence available for this request. '
            + 'No adequate, current real-world evidence is available, or the supplied evidence still needs review. '
            + 'I cannot confirm current deadlines, eligibility, costs or financial benefits. '
            + 'Check these details with the issuing organisation before applying. This is an evidence limitation, not a model-generated opportunity recommendation.',
          citationIds: [], uncertainties: [],
        }), prompt.value)
        return limited.ok ? limited : failure(503, 'EVIDENCE_UNAVAILABLE', 'Research evidence is temporarily unavailable.')
      }
      const remainingMs = Math.floor(this.timeoutMs - (performance.now() - startedAt))
      if (remainingMs < 1) return timeout()
      const generated = await generateWithProvider(this.provider!, prompt.value.messages,
        { timeoutMs: remainingMs, signal: controller.signal })
      if (!generated.ok) {
        if (generated.error.code === 'TIMEOUT') return timeout()
        if (generated.error.code === 'CANCELLED') return cancelled()
        if (generated.error.code === 'UNAVAILABLE') return failure(503, 'AI_UNAVAILABLE', 'The AI provider is unavailable.')
        return failure(502, 'AI_GENERATION_FAILED', 'The AI provider could not produce an acceptable answer.')
      }
      const result = validateGroundedAnswer(generated.value.content, prompt.value)
      return result.ok ? result : failure(502, 'AI_INVALID_RESPONSE', 'The AI provider returned an unsupported or invalid answer.')
    }
    try { return await Promise.race([operation(), stopped]) }
    catch { return failure(500, 'INTERNAL_ERROR', 'An unexpected server error occurred.') }
    finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      controller.abort()
      this.active--
    }
  }
}
