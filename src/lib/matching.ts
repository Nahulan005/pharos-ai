import type { MatchResult, Opportunity, Relevance, Topic } from '../../shared/contract'
import type { StudentProfile } from '../models/studentProfile'
import { getDeadlineStatus, topicLabels } from './opportunities'

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
const relevanceOrder: Record<Relevance, number> = { high: 0, medium: 1, low: 2 }

/** Free-text eligibility is evidence to review, never a machine-readable rule. */
function hasEligibilityInformation(summary: string): boolean {
  return Boolean(summary.trim())
    && !/\b(unknown|unspecified|not specified|not provided|not available|unclear|to be confirmed)\b/i.test(summary)
}

function assess(opportunity: Opportunity, profile: StudentProfile | null, now: Date) {
  const reasons: string[] = []
  const uncertainties: string[] = []
  let score = 0
  let limited = false
  let stateMismatch = false
  let personalSignal = false

  const interests = new Set<Topic>(profile?.careerInterests ?? [])
  const overlap = [...new Set(opportunity.topics)].filter(topic => interests.has(topic))
  if (overlap.length) {
    score += 3
    personalSignal = true
    reasons.push(`Matches your saved interests: ${overlap.map(topic => topicLabels[topic]).join(', ')}.`)
  } else if (!interests.size) {
    uncertainties.push('No career interests are saved, so topic relevance cannot be personalized.')
  } else if (!opportunity.topics.length) {
    limited = true
    uncertainties.push('No topics are listed for this opportunity.')
  } else {
    reasons.push('No listed topics overlap with your saved career interests.')
  }

  const state = profile?.state.trim() ?? ''
  const { scope, states } = opportunity.applicability
  if (scope === 'national') {
    score += 1
    personalSignal ||= Boolean(state)
    reasons.push('Listed with national applicability; this is a location signal, not eligibility confirmation.')
  } else if (scope === 'state' && states.some(value => normalize(value) === normalize(state)) && state) {
    score += 1
    personalSignal = true
    reasons.push(`Your saved state, ${state}, appears in the listed states.`)
  } else if (scope === 'state' && state && states.some(value => value.trim())) {
    stateMismatch = true
    reasons.push(`Your saved state, ${state}, is not in the listed states: ${states.join(', ')}. Ranked lower for this location mismatch.`)
  } else {
    limited = true
    if (scope === 'unknown') uncertainties.push('State applicability is unknown; national or state coverage cannot be assumed.')
    else if (!state) uncertainties.push('No state is saved, so state-specific applicability cannot be compared.')
    else uncertainties.push('State-specific applicability is listed without usable state names.')
  }

  // The profile has no budget field. This is an explicit accessibility rule,
  // not an inferred personal budget preference.
  if (opportunity.cost === 'free') {
    score += 1
    reasons.push('Listed as free; free options receive a small accessibility boost.')
  } else if (opportunity.cost === 'free_to_learn_paid_cert') {
    score += 0.5
    reasons.push('Listed as free to learn, with a paid certificate; free learning receives a smaller boost.')
    uncertainties.push('Certificate fees are not covered by free learning. No budget preference is stored in your profile.')
  } else if (opportunity.cost === 'paid') {
    score -= 1
    reasons.push('Listed as paid; ranked below otherwise equivalent free options.')
    uncertainties.push('Affordability is unconfirmed because your profile has no budget preference.')
  } else {
    limited = true
    uncertainties.push('Cost is unknown; this opportunity must not be assumed to be free.')
  }

  if (hasEligibilityInformation(opportunity.eligibilitySummary)) {
    reasons.push(`Recorded eligibility to review: ${opportunity.eligibilitySummary.trim()}`)
    uncertainties.push('Eligibility is free-text guidance, not structured rules. Degree, year and other requirements have not been verified against your profile.')
  } else {
    limited = true
    uncertainties.push('Eligibility information is unspecified or incomplete; suitability cannot be established.')
  }
  if (!profile?.degreeCourse.trim() || profile.yearOfStudy === null) {
    limited = true
    uncertainties.push('Your degree/course or year of study is unspecified. No educational eligibility is inferred.')
  }
  if (opportunity.category === 'scholarship') {
    uncertainties.push('Scholarship eligibility is never guaranteed by this match. Confirm all requirements with the provider.')
  }

  const deadline = getDeadlineStatus(opportunity.deadline, now)
  if (deadline === 'expired') uncertainties.push('The fixed deadline has passed in IST. Ranked lower; do not assume applications are available.')
  else if (deadline !== 'within_deadline') {
    limited = true
    uncertainties.push(deadline === 'rolling'
      ? 'The deadline is rolling; current availability must be confirmed.'
      : deadline === 'annual_expected'
        ? 'An annual cycle is expected, but its date and current availability are unconfirmed.'
        : 'The deadline is unknown; current availability cannot be established.')
  }

  if (opportunity.verificationStatus === 'demo') {
    limited = true
    uncertainties.push('[DEMO] Fictional opportunity. This demonstrates matching only and is not a real offer.')
  } else if (opportunity.verificationStatus === 'unreviewed') {
    limited = true
    uncertainties.push('This record has not been manually checked against its source.')
  } else {
    uncertainties.push('A source check does not guarantee personal eligibility or availability today.')
  }

  // High requires all three positive signals plus usable documentation.
  // Missing facts never earn points; known location conflicts and expiry win
  // over positive topic/cost signals. Stable ties use the opportunity ID.
  let relevance: Relevance = score >= 5 && overlap.length > 0 && !limited ? 'high' : score >= 2 ? 'medium' : 'low'
  if (!profile || !personalSignal || stateMismatch || deadline === 'expired') relevance = 'low'
  if (!profile) uncertainties.unshift('No saved profile is available. This is not a personalized recommendation.')
  return { result: { opportunityId: opportunity.id, relevance, reasons, uncertainties } satisfies MatchResult, score }
}

/** Pure and deterministic: the caller supplies both the profile and clock. */
export function matchOpportunity(opportunity: Opportunity, profile: StudentProfile | null, now: Date): MatchResult {
  return assess(opportunity, profile, now).result
}

export function matchOpportunities(opportunities: readonly Opportunity[], profile: StudentProfile | null, now: Date): MatchResult[] {
  return opportunities.map(opportunity => assess(opportunity, profile, now))
    .sort((a, b) => relevanceOrder[a.result.relevance] - relevanceOrder[b.result.relevance]
      || b.score - a.score
      || (a.result.opportunityId < b.result.opportunityId ? -1 : a.result.opportunityId > b.result.opportunityId ? 1 : 0))
    .map(({ result }) => result)
}
