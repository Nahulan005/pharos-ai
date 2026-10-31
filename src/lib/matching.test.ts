import { describe, expect, it } from 'vitest'
import type { Opportunity, OpportunityCost, Topic } from '../../shared/contract'
import { createDefaultProfile } from '../models/studentProfile'
import type { StudentProfile } from '../models/studentProfile'
import { matchOpportunities, matchOpportunity } from './matching'

// Synthetic fixtures exercise real-record states; they are never application data.
const opportunity: Opportunity = {
  id: 'test-course', category: 'course_cert', title: 'Test fixture', provider: 'Test provider',
  summary: 'Unit test only', cost: 'free', eligibilitySummary: 'Students may apply; provider requirements apply.',
  applicability: { scope: 'national', states: [] }, deadline: { type: 'fixed', date: '2026-12-31', note: null },
  sourceName: 'Test source', sourceUrl: 'https://example.com', sourceType: 'official',
  verificationStatus: 'checked_against_source', lastVerifiedAt: '2026-10-31', verifiedBy: 'Test reviewer',
  topics: ['web_dev'], tags: [],
}
const profile: StudentProfile = {
  ...createDefaultProfile(), degreeCourse: 'BSc Computer Science', yearOfStudy: 2, careerInterests: ['web_dev'],
}
const now = new Date('2026-11-01T12:00:00Z')
const match = (item = opportunity, student: StudentProfile | null = profile) => matchOpportunity(item, student, now)

describe('matching signals and explanations', () => {
  it('returns the shared MatchResult shape and high relevance for documented positive signals', () => {
    expect(match()).toMatchObject({ opportunityId: opportunity.id, relevance: 'high' })
    expect(Object.keys(match()).sort()).toEqual(['opportunityId', 'reasons', 'relevance', 'uncertainties'])
    expect(match().reasons.join(' ')).toContain('Web development')
    expect(match().uncertainties.join(' ')).toContain('not structured rules')
  })
  it('changes relevance when interests do not overlap', () => {
    expect(match(opportunity, { ...profile, careerInterests: ['cybersecurity'] }).relevance).toBe('medium')
    expect(match(opportunity, { ...profile, careerInterests: ['cybersecurity'] }).reasons.join(' ')).toContain('No listed topics overlap')
  })
  it('does not treat general as a wildcard', () => {
    expect(match({ ...opportunity, topics: ['general'] }).relevance).toBe('medium')
    expect(match({ ...opportunity, topics: ['general'] }, { ...profile, careerInterests: ['general'] }).relevance).toBe('high')
  })
  it('counts duplicate topic values only once', () => {
    expect(match({ ...opportunity, topics: ['web_dev', 'web_dev'] })).toEqual(match())
  })
  it('matches full state names, ignoring case and repeated whitespace', () => {
    const result = match({ ...opportunity, applicability: { scope: 'state', states: ['tamil   nadu'] } })
    expect(result.relevance).toBe('high')
    expect(result.reasons.join(' ')).toContain('Tamil Nadu, appears in the listed states')
  })
  it('ranks state mismatches low even with topic and free-cost matches', () => {
    const result = match({ ...opportunity, applicability: { scope: 'state', states: ['Kerala'] } })
    expect(result.relevance).toBe('low')
    expect(result.reasons.join(' ')).toContain('location mismatch')
  })
  it('does not use a partial state-name match', () => {
    expect(match({ ...opportunity, applicability: { scope: 'state', states: ['Tamil Nadu'] } }, { ...profile, state: 'Tamil' }).relevance).toBe('low')
  })
  it('keeps unknown and missing state applicability uncertain', () => {
    const unknown = match({ ...opportunity, applicability: { scope: 'unknown', states: [] } })
    expect(unknown.relevance).toBe('medium')
    expect(unknown.uncertainties.join(' ')).toContain('coverage cannot be assumed')
    expect(match({ ...opportunity, applicability: { scope: 'state', states: [] } }).relevance).toBe('medium')
  })
  it.each<OpportunityCost>(['free', 'free_to_learn_paid_cert', 'paid', 'unknown'])('explains %s cost honestly', cost => {
    const result = match({ ...opportunity, cost })
    if (cost === 'free') expect(result.relevance).toBe('high')
    else expect(result.relevance).not.toBe('high')
    if (cost === 'unknown') expect(result.uncertainties.join(' ')).toContain('must not be assumed to be free')
    if (cost === 'free_to_learn_paid_cert') expect(result.uncertainties.join(' ')).toContain('Certificate fees')
    if (cost === 'paid') expect(result.uncertainties.join(' ')).toContain('no budget preference')
  })
  it('ranks otherwise equal free, free-learning and paid options in that order', () => {
    const result = matchOpportunities([
      { ...opportunity, id: 'paid', cost: 'paid' },
      { ...opportunity, id: 'free-learning', cost: 'free_to_learn_paid_cert' },
      { ...opportunity, id: 'free', cost: 'free' },
    ], profile, now)
    expect(result.map(item => item.opportunityId)).toEqual(['free', 'free-learning', 'paid'])
  })
})

describe('incomplete profiles and uncertain eligibility', () => {
  it('never personalizes an absent profile', () => {
    const result = match(opportunity, null)
    expect(result.relevance).toBe('low')
    expect(result.uncertainties.join(' ')).toContain('not a personalized recommendation')
  })
  it('keeps a saved empty profile low instead of inventing interests or state', () => {
    const result = match(opportunity, { ...createDefaultProfile(), state: '' })
    expect(result.relevance).toBe('low')
    expect(result.uncertainties.join(' ')).toContain('No career interests')
  })
  it('explains missing state for state-specific records', () => {
    const result = match({ ...opportunity, applicability: { scope: 'state', states: ['Tamil Nadu'] } }, { ...profile, state: '' })
    expect(result.relevance).toBe('medium')
    expect(result.uncertainties.join(' ')).toContain('No state is saved')
  })
  it('limits relevance when education information is incomplete', () => {
    expect(match(opportunity, { ...profile, degreeCourse: '' }).relevance).toBe('medium')
    expect(match(opportunity, { ...profile, yearOfStudy: null }).relevance).toBe('medium')
  })
  it.each(['', 'Unknown', 'Eligibility is unspecified for this example.', 'Not provided'])('limits relevance for missing eligibility: %s', eligibilitySummary => {
    const result = match({ ...opportunity, eligibilitySummary })
    expect(result.relevance).toBe('medium')
    expect(result.uncertainties.join(' ')).toContain('suitability cannot be established')
  })
  it('preserves recorded requirements without asserting that degree/year satisfy them', () => {
    const eligibilitySummary = 'Only final-year engineering students may apply; additional criteria apply.'
    const result = match({ ...opportunity, category: 'scholarship', eligibilitySummary })
    expect(result.reasons.join(' ')).toContain(eligibilitySummary)
    expect(result.uncertainties.join(' ')).toContain('Degree, year and other requirements have not been verified')
    expect(result.uncertainties.join(' ')).toContain('Scholarship eligibility is never guaranteed')
    expect(result.reasons.join(' ')).not.toMatch(/you qualify|you are eligible|guaranteed eligibility/i)
  })
  it('labels fictional matches and never assigns high relevance to a demo', () => {
    const result = match({ ...opportunity, verificationStatus: 'demo' })
    expect(result.relevance).toBe('medium')
    expect(result.uncertainties.join(' ')).toContain('[DEMO] Fictional opportunity')
  })
  it('limits unreviewed records', () => expect(match({ ...opportunity, verificationStatus: 'unreviewed' }).relevance).toBe('medium'))
  it('limits missing topics without inventing tags as interests', () => {
    const result = match({ ...opportunity, topics: [] as Topic[], tags: ['web_dev'] })
    expect(result.relevance).not.toBe('high')
    expect(result.uncertainties.join(' ')).toContain('No topics are listed')
  })
  it('does not infer workload or skill requirements absent from the opportunity contract', () => {
    expect(match(opportunity, { ...profile, skills: ['Python'], weeklyLearningHours: 2, learningIntensity: 'focused' })).toEqual(match())
  })
})

describe('determinism and deadline handling', () => {
  it('is deterministic, does not mutate inputs, and breaks ties by ID', () => {
    const items = [{ ...opportunity, id: 'b' }, { ...opportunity, id: 'a' }]
    const before = structuredClone({ items, profile })
    const first = matchOpportunities(items, profile, now)
    expect(first.map(result => result.opportunityId)).toEqual(['a', 'b'])
    expect(matchOpportunities([...items].reverse(), profile, now)).toEqual(first)
    expect({ items, profile }).toEqual(before)
  })
  it('keeps fixed deadlines valid through the last millisecond of their IST date', () => {
    const item = { ...opportunity, deadline: { type: 'fixed' as const, date: '2026-11-01', note: null } }
    expect(matchOpportunity(item, profile, new Date('2026-11-01T18:29:59.999Z')).relevance).toBe('high')
    const expired = matchOpportunity(item, profile, new Date('2026-11-01T18:30:00Z'))
    expect(expired.relevance).toBe('low')
    expect(expired.uncertainties.join(' ')).toContain('deadline has passed in IST')
  })
  it.each(['unknown', 'rolling', 'annual_expected'] as const)('treats %s deadlines as uncertain', type => {
    expect(match({ ...opportunity, deadline: { type, date: null, note: null } }).relevance).toBe('medium')
  })
})
