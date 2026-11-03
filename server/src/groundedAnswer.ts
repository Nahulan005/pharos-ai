import type { AIProvider, GenerationOptions, ProviderErrorCode } from './aiProvider.ts'
import { generateWithProvider } from './aiProvider.ts'
import { buildGroundedPrompt } from './groundedPrompt.ts'
import type { GroundedAnswerRequest, GroundedContext } from './groundedPrompt.ts'

/** Matches the locally available frontend proposal; this step adds no public route. */
export interface AIResponse {
  answer: string
  citations: { title: string; url: string; recordId?: string }[]
  grounded: boolean
}
export type AnswerErrorCode = 'MALFORMED_OUTPUT' | 'UNKNOWN_CITATION' | 'SYNTHETIC_CITATION'
  | 'UNSUPPORTED_ASSURANCE' | 'UNMAPPED_REFERENCE' | 'INVALID_GROUNDED_REQUEST' | ProviderErrorCode
export type GroundedAnswerResult =
  | { ok: true; response: AIResponse; audit: {
    citationIds: string[]; uncertainties: string[]; reviewWarnings: string[]
    reviewRequirements: GroundedContext['assessments'][number]['reviewRequirements'][]
    humanVerified: false
  } }
  | { ok: false; error: { code: AnswerErrorCode; message: string } }
const fail = (code: AnswerErrorCode, message: string): GroundedAnswerResult => ({ ok: false, error: { code, message } })

/** Citation resolution is deterministic; semantic entailment of free text is not proven. */
export function validateGroundedAnswer(content: string, context: GroundedContext): GroundedAnswerResult {
  let parsed: unknown
  try {
    if (typeof content !== 'string' || content.length > 200_000) throw new Error()
    parsed = JSON.parse(content)
  } catch { return fail('MALFORMED_OUTPUT', 'Model output must be a valid JSON answer.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('MALFORMED_OUTPUT', 'Model answer shape is invalid.')
  const data = parsed as Record<string, unknown>
  if (Object.keys(data).some(key => !['answer', 'citationIds', 'uncertainties'].includes(key))
    || typeof data.answer !== 'string' || !data.answer.trim() || data.answer.length > 100_000
    || !Array.isArray(data.citationIds) || data.citationIds.length > 30
    || !data.citationIds.every(id => typeof id === 'string')
    || new Set(data.citationIds).size !== data.citationIds.length
    || !Array.isArray(data.uncertainties) || data.uncertainties.length > 100
    || !data.uncertainties.every(value => typeof value === 'string' && value.trim() && value.length <= 2000)) {
    return fail('MALFORMED_OUTPUT', 'Model answer shape is invalid.')
  }
  const outputText = [data.answer, ...data.uncertainties].join('\n')
  // Deliberately conservative: false positives are preferable to serving an assurance.
  if (/\b(?:guarantee(?:d|s)?|definitely eligible|certainly eligible|you qualify|you are eligible|human[- ]verified|verified by|fully verified)\b|100\s*%\s*(?:eligible|certain|assured)/i.test(outputText)) {
    return fail('UNSUPPORTED_ASSURANCE', 'Model output contains an unsupported eligibility or verification assurance.')
  }
  if (/https?:\/\/|www\.|\[[^\]\n]+\]|<\/?[a-z][^>]*>/i.test(outputText)) {
    return fail('UNMAPPED_REFERENCE', 'Use structured citation IDs and plain text, not embedded links, citation markers or HTML.')
  }
  const mapped = []
  for (const id of data.citationIds as string[]) {
    const reference = context.references.find(item => item.citationId === id)
    if (!reference) return fail('UNKNOWN_CITATION', 'Model cited an ID absent from supplied evidence.')
    if (reference.synthetic) return fail('SYNTHETIC_CITATION', 'Synthetic evidence cannot be cited as a real opportunity.')
    mapped.push(reference)
  }
  const uncertainties = [...new Set([...context.uncertainties, ...data.uncertainties as string[]])]
  const reviewWarnings = [...context.reviewWarnings]
  if (!mapped.length) reviewWarnings.push('No supplied evidence was cited; this answer is general guidance only.')
  const grounded = mapped.length > 0 && mapped.every(item => item.adequate)
    && reviewWarnings.length === 0 && uncertainties.length === 0
  // The frontend has no warning fields: preserve mandatory caveats in plain-text answer as well as audit metadata.
  const sections = [data.answer.trim()]
  if (!grounded) sections.unshift('General guidance only: adequate evidence grounding has not been established.')
  if (uncertainties.length) sections.push(`Uncertainties:\n${uncertainties.join('\n')}`)
  if (reviewWarnings.length) sections.push(`Evidence review required:\n${[...new Set(reviewWarnings)].join('\n')}`)
  sections.push('Human verification has not been established. A separate recorded human review is required. Eligibility and availability are not guaranteed.')
  const answer = sections.join('\n\n')
  if (answer.length > 100_000) return fail('MALFORMED_OUTPUT', 'Answer and required warnings exceed the response limit.')
  return { ok: true, response: { answer, grounded,
    citations: mapped.map(item => ({ title: item.title, url: item.url, recordId: item.recordId })) },
  audit: { citationIds: [...data.citationIds] as string[], uncertainties, reviewWarnings: [...new Set(reviewWarnings)],
    reviewRequirements: structuredClone(context.assessments.map(item => item.reviewRequirements)), humanVerified: false } }
}

/** Internal orchestration only. No default provider, network calls, or endpoint wiring. */
export async function generateGroundedAnswer(
  provider: AIProvider, request: GroundedAnswerRequest, options: GenerationOptions = {},
): Promise<GroundedAnswerResult> {
  const prompt = buildGroundedPrompt(request)
  if (!prompt.ok) return prompt
  const generation = await generateWithProvider(provider, prompt.value.messages, options)
  if (!generation.ok) return generation
  return validateGroundedAnswer(generation.value.content, prompt.value)
}
