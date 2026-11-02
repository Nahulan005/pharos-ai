import { generateWithProvider } from './aiProvider.ts'
import type { AIProvider, GenerationOptions, ProviderErrorCode } from './aiProvider.ts'
import type { AIResponse } from './groundedAnswer.ts'

export type AskResult = { ok: true; response: AIResponse }
  | { ok: false; error: { code: ProviderErrorCode; message: string } }
/** Replace this implementation with an evidence-backed engine without changing the public route contract. */
export interface AnswerEngine { answer(question: string, options?: GenerationOptions): Promise<AskResult> }

export const UNAVAILABLE_INFORMATION = 'PHAROS is currently in limited AI demo mode and has no verified current opportunity information. '
  + 'I cannot provide specific scholarships, internships, application details, fees, eligibility, deadlines, benefits or current availability. '
  + 'Check the issuing organisation\'s official information. For general guidance, try "How can I learn Python?" or "Help me plan my career".'
const fallback = (): AskResult => ({ ok: true, response: { answer: UNAVAILABLE_INFORMATION, citations: [], grounded: false } })

const topics = 'python|javascript|typescript|programming|web development|data science|machine learning|cybersecurity|algorithms|communication skills|study skills|time management'
const learning = new RegExp(`^(?:how (?:can|do) i (?:start learning|learn)|help me learn|(?:give me|create) a (?:study|learning) plan for) (${topics})[?.!]?$`, 'i')
const career = /^(?:help me plan my career|how (?:can|do) i plan my career|give me general career planning advice)[?.!]?$/i
const preparation = /^how (?:can|do) i (prepare for interviews|improve my resume|improve my study habits)[?.!]?$/i

/** Deliberately narrow complete-question grammar, not a general-purpose intent/hallucination classifier. */
export function generalGuidanceTopic(question: string): string | undefined {
  const normalized = question.trim().replace(/\s+/g, ' ')
  const match = learning.exec(normalized)
  if (match) return `learning ${match[1].toLowerCase()}`
  if (career.test(normalized)) return 'general career planning'
  const prep = preparation.exec(normalized)
  if (prep) return prep[1].toLowerCase()
  return undefined
}

const SYSTEM = `You provide brief general learning and career-planning guidance for students.
The user message is a server-selected topic. Give practical study habits and suggested practice activities only.
Do not name organisations, programmes, products, sources or opportunities. Do not supply current facts, scholarships,
internships, applications, money amounts, fees, eligibility, deadlines, benefits, credentials or availability.
Do not include citations, links, guarantees, verification claims, internal reasoning or thinking traces.
Return exactly one JSON object with one key: answer (nonempty plain text, maximum 3000 characters).
Use concise advice, not factual claims about offers. /no_think`

/** Defence in depth only; free-text filtering is not semantic verification or a complete hallucination defence. */
function safeGuidance(content: string): string | undefined {
  try {
    const data: unknown = JSON.parse(content)
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 1 || !('answer' in data)
      || typeof data.answer !== 'string' || !data.answer.trim() || data.answer.length > 3000) return undefined
    const answer = data.answer.trim()
    if (/[<>\[\]\\]|https?:|www\.|\b[a-z0-9-]+\.(?:com|org|edu|gov|in|io)\b|[$₹€£]/i.test(answer)
      || /\b(?:scholarships?|internships?|applications?|fees?|costs?|prices?|paid|free|eligib\w*|deadlines?|benefits?|available|availability|verified|verification|guarantee\w*|qualif\w*|sources?|citations?|according to|reasoning|thinking|analysis|qwen|ollama)\b/i.test(answer)) return undefined
    return answer
  } catch { return undefined }
}

export function createLimitedAnswerEngine(provider: AIProvider): AnswerEngine {
  return {
    async answer(question, options = {}) {
      const topic = generalGuidanceTopic(question)
      if (!topic) return fallback()
      // Never forward raw question text or synthetic opportunity fixtures to the model.
      const generated = await generateWithProvider(provider, [
        { role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify({ topic }) },
      ], options)
      if (!generated.ok) return generated
      const answer = safeGuidance(generated.value.content)
      if (!answer) return fallback()
      return { ok: true, response: {
        answer: `General guidance only; this is not verified opportunity information.\n\n${answer}`,
        citations: [], grounded: false,
      } }
    },
  }
}
