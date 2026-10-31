import { describe, expect, it } from 'vitest'
import type { Opportunity } from '../../shared/contract'
import { filterByApplicability, filterByCategory, filterByCost, filterOpportunities, filtersFromParams, getDeadlineStatus, safeSourceUrl, searchOpportunities } from './opportunities'

const fixture: Opportunity = {
  id: 'demo-test', category: 'scholarship', title: '[DEMO] Learning Grant', provider: 'Fictional Foundation',
  summary: 'Test fixture only', cost: 'free', eligibilitySummary: 'Unspecified',
  applicability: { scope: 'national', states: [] }, deadline: { type: 'unknown', date: null, note: null },
  sourceName: null, sourceUrl: null, sourceType: 'unknown', verificationStatus: 'demo',
  lastVerifiedAt: null, verifiedBy: null, topics: ['general'], tags: ['research', 'student'],
}
const items: Opportunity[] = [
  fixture,
  { ...fixture, id: 'demo-course', category: 'course_cert', title: '[DEMO] Web Course', cost: 'free_to_learn_paid_cert',
    applicability: { scope: 'state', states: ['Tamil Nadu', 'Kerala'] }, tags: ['coding'] },
  { ...fixture, id: 'demo-software', category: 'software_perk', title: '[DEMO] Software', cost: 'unknown',
    applicability: { scope: 'unknown', states: [] }, tags: [] },
]
describe('search', () => {
  it('matches title case-insensitively and trims whitespace', () => expect(searchOpportunities(items, '  WEB  ')).toEqual([items[1]]))
  it('matches providers', () => expect(searchOpportunities(items, 'fictional foundation')).toHaveLength(3))
  it('matches tags', () => expect(searchOpportunities(items, 'research')).toEqual([items[0]]))
  it('requires every search word across fields', () => expect(searchOpportunities(items, 'grant research')).toEqual([items[0]]))
  it('handles blank and unmatched queries', () => {
    expect(searchOpportunities(items, '  ')).toEqual(items)
    expect(searchOpportunities(items, 'missing')).toEqual([])
  })
})
describe('filters', () => {
  it('filters each category', () => { for (const item of items) expect(filterByCategory(items, item.category)).toEqual([item]) })
  it('keeps free, paid-certificate and unknown costs distinct', () => {
    for (const item of items) expect(filterByCost(items, item.cost)).toEqual([item])
    expect(filterByCost(items, 'paid')).toEqual([])
    expect(filterByCost(items, 'all')).toEqual(items)
  })
  it('distinguishes national, state and unknown applicability', () => {
    expect(filterByApplicability(items, 'national')).toEqual([items[0]])
    expect(filterByApplicability(items, 'state')).toEqual([items[1]])
    expect(filterByApplicability(items, 'unknown')).toEqual([items[2]])
  })
  it('matches state names exactly ignoring case and outer whitespace', () => {
    expect(filterByApplicability(items, 'state', ' tamil nadu ')).toEqual([items[1]])
    expect(filterByApplicability(items, 'state', 'Tamil')).toEqual([])
    expect(filterByApplicability(items, 'state', 'Maharashtra')).toEqual([])
  })
  it('ignores stale state names outside state scope', () => expect(filterByApplicability(items, 'all', 'Kerala')).toEqual(items))
  it('combines filters without changing input', () => {
    const before = structuredClone(items)
    expect(filterOpportunities(items, { query: 'web', category: 'course_cert', cost: 'free_to_learn_paid_cert', scope: 'state', state: 'Kerala' })).toEqual([items[1]])
    expect(filterOpportunities(items, { query: 'web', category: 'scholarship', cost: 'all', scope: 'all', state: '' })).toEqual([])
    expect(items).toEqual(before)
  })
  it('tolerates invalid URL filters', () => expect(filtersFromParams(new URLSearchParams('category=constructor&cost=bad&scope=bad&state=Kerala'))).toEqual({ query: '', category: 'all', cost: 'all', scope: 'all', state: '' }))
})
describe('IST deadline boundaries', () => {
  const deadline = { type: 'fixed' as const, date: '2026-10-31', note: null }
  it.each([
    ['2026-10-30T18:30:00.000Z', 'within_deadline'],
    ['2026-10-31T18:29:59.999Z', 'within_deadline'],
    ['2026-10-31T18:30:00.000Z', 'expired'],
    ['2026-11-01T00:00:00+05:30', 'expired'],
  ])('at %s returns %s', (now, expected) => expect(getDeadlineStatus(deadline, new Date(now))).toBe(expected))
  it('handles year rollover', () => {
    expect(getDeadlineStatus({ ...deadline, date: '2026-12-31' }, new Date('2026-12-31T18:29:59.999Z'))).toBe('within_deadline')
    expect(getDeadlineStatus({ ...deadline, date: '2026-12-31' }, new Date('2026-12-31T18:30:00Z'))).toBe('expired')
  })
  it('accepts leap days and rejects impossible dates', () => {
    expect(getDeadlineStatus({ ...deadline, date: '2024-02-29' }, new Date('2024-02-29T12:00:00Z'))).toBe('within_deadline')
    for (const date of ['2026-02-29', '2026-04-31', '1900-02-29', '2026-13-01', 'bad', null]) expect(getDeadlineStatus({ ...deadline, date }, new Date())).toBe('unknown')
  })
  it.each(['rolling', 'annual_expected', 'unknown'] as const)('preserves %s uncertainty', type => expect(getDeadlineStatus({ type, date: null, note: null }, new Date())).toBe(type))
  it('handles invalid clock', () => expect(getDeadlineStatus(deadline, new Date('bad'))).toBe('unknown'))
})
describe('safe external links', () => {
  it.each(['javascript:alert(1)', 'data:text/html,test', '//example.com', 'https://', 'https://user:secret@example.com', null])('rejects %s', value => expect(safeSourceUrl(value)).toBeNull())
  it.each(['https://example.com/source', 'http://example.com/source'])('allows %s', value => expect(safeSourceUrl(value)).toBe(value))
})
