import type { Category, Opportunity, OpportunityCost, SourceType, Topic, VerificationStatus } from '../../shared/contract'

export const categoryLabels: Record<Category, string> = {
  scholarship: 'Scholarships', course_cert: 'Courses & certificates', software_perk: 'Software benefits',
}
export const costLabels: Record<OpportunityCost, string> = {
  free: 'Free', free_to_learn_paid_cert: 'Free to learn · paid certificate', paid: 'Paid', unknown: 'Cost unknown',
}
export const topicLabels: Record<Topic, string> = {
  ai_ml: 'AI & machine learning', web_dev: 'Web development', cybersecurity: 'Cybersecurity',
  data_science: 'Data science', general: 'General',
}
export const sourceLabels: Record<SourceType, string> = {
  official: 'Official source', provider: 'Provider source', third_party: 'Third-party source', unknown: 'Source unknown',
}
export const verificationLabels: Record<VerificationStatus, string> = {
  checked_against_source: 'Checked against source', unreviewed: 'Unreviewed', demo: 'Fictional demo',
}
export type ApplicabilityScope = Opportunity['applicability']['scope']
export interface OpportunityFilters {
  query: string
  category: Category | 'all'
  cost: OpportunityCost | 'all'
  scope: ApplicabilityScope | 'all'
  state: string
}
const normalize = (value: string) => value.trim().toLocaleLowerCase('en-IN')

export function searchOpportunities(items: readonly Opportunity[], query: string): Opportunity[] {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  return items.filter(item => {
    const searchable = normalize([item.title, item.provider, ...item.tags].join(' '))
    return words.every(word => searchable.includes(word))
  })
}
export function filterByCategory(items: readonly Opportunity[], category: Category | 'all'): Opportunity[] {
  return items.filter(item => category === 'all' || item.category === category)
}
export function filterByCost(items: readonly Opportunity[], cost: OpportunityCost | 'all'): Opportunity[] {
  return items.filter(item => cost === 'all' || item.cost === cost)
}
// A state name narrows state-specific records only. Unknown scope is never
// treated as nationwide eligibility, and national records stay distinct.
export function filterByApplicability(items: readonly Opportunity[], scope: ApplicabilityScope | 'all', state = ''): Opportunity[] {
  return items.filter(item => {
    if (scope !== 'all' && item.applicability.scope !== scope) return false
    return scope !== 'state' || !normalize(state)
      || item.applicability.states.some(value => normalize(value) === normalize(state))
  })
}
export function filterOpportunities(items: readonly Opportunity[], filters: OpportunityFilters): Opportunity[] {
  return filterByApplicability(
    filterByCost(filterByCategory(searchOpportunities(items, filters.query), filters.category), filters.cost),
    filters.scope, filters.state,
  )
}

export type DeadlineStatus = 'within_deadline' | 'expired' | 'rolling' | 'annual_expected' | 'unknown'
export function isCalendarDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
export function getDeadlineStatus(deadline: Opportunity['deadline'], now: Date): DeadlineStatus {
  if (deadline.type !== 'fixed') return deadline.type
  if (!isCalendarDate(deadline.date) || !Number.isFinite(now.getTime())) return 'unknown'
  // Midnight after the stated date in IST (UTC+05:30), which has no DST.
  const expiresAt = Date.parse(`${deadline.date}T00:00:00+05:30`) + 86_400_000
  return now.getTime() < expiresAt ? 'within_deadline' : 'expired'
}
export function formatDate(date: string | null): string {
  if (!isCalendarDate(date)) return 'Unknown'
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`))
}
export function deadlineLabel(deadline: Opportunity['deadline'], now: Date): string {
  const status = getDeadlineStatus(deadline, now)
  if (status === 'within_deadline') return `Deadline ${formatDate(deadline.date)} · IST`
  if (status === 'expired') return `Deadline passed · ${formatDate(deadline.date)}`
  if (status === 'rolling') return 'Rolling · confirm availability'
  if (status === 'annual_expected') return 'Annual cycle expected · unconfirmed'
  return 'Deadline unknown'
}
export function applicabilityLabel(item: Opportunity): string {
  if (item.applicability.scope === 'national') return 'National applicability'
  if (item.applicability.scope === 'state') return item.applicability.states.join(', ') || 'State not specified'
  return 'Applicability unknown'
}
export function safeSourceUrl(value: string | null): string | null {
  if (!value || value !== value.trim() || !/^https?:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null
  } catch { return null }
}
export function filtersFromParams(params: URLSearchParams): OpportunityFilters {
  const category = params.get('category') ?? ''
  const cost = params.get('cost') ?? ''
  const scope = params.get('scope') ?? ''
  return {
    query: params.get('q') ?? '',
    category: Object.hasOwn(categoryLabels, category) ? category as Category : 'all',
    cost: Object.hasOwn(costLabels, cost) ? cost as OpportunityCost : 'all',
    scope: scope === 'national' || scope === 'state' || scope === 'unknown' ? scope : 'all',
    state: scope === 'state' ? params.get('state') ?? '' : '',
  }
}
