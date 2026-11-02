import { SCHEMA_VERSION } from '../../shared/contract.ts'
import type { Opportunity } from '../../shared/contract.ts'
import { validateOpportunities } from '../../shared/validateOpportunities.mjs'
import { getSourceById, isSourceUrl } from './sourceRegistry.ts'
import type { OrganizedOpportunity, OrganizerError, OrganizerResult, SourceFinding } from './sourceFinding.ts'

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

/** Pure transformation of JSON-shaped input. No network, storage, clock or verification side effects. */
export class OpportunityOrganizer {
  organize(input: unknown): OrganizerResult {
    const errors: OrganizerError[] = []
    const fail = (path: string, code: OrganizerError['code'], message: string) => {
      errors.push({ path, code, message })
    }
    if (!isObject(input)) {
      return { ok: false, errors: [{ path: 'finding', code: 'INVALID_FINDING', message: 'Must be a plain object.' }] }
    }
    const allowed = ['findingId', 'sourceId', 'sourceUrl', 'retrievedAt', 'publishedAt',
      'evidenceText', 'verificationStatus', 'facts']
    for (const key of Object.keys(input)) {
      if (!allowed.includes(key)) fail(`finding.${key}`, 'INVALID_FINDING', 'Unexpected property.')
    }
    for (const key of ['findingId', 'sourceId', 'sourceUrl', 'retrievedAt']) {
      if (typeof input[key] !== 'string' || !input[key].trim()) {
        fail(`finding.${key}`, 'INVALID_FINDING', 'Required nonblank string.')
      }
    }
    // Reuse the shared validator's real calendar/timezone checks, rather than Date.parse alone.
    for (const key of ['retrievedAt', 'publishedAt']) {
      if (key === 'publishedAt' && (input[key] === undefined || input[key] === null)) continue
      const dateErrors = validateOpportunities({ schemaVersion: SCHEMA_VERSION, generatedAt: input[key], items: [] })
      if (dateErrors.length) fail(`finding.${key}`, 'INVALID_FINDING', 'Must be a valid ISO timestamp with seconds and timezone.')
    }
    if (typeof input.retrievedAt === 'string' && typeof input.publishedAt === 'string'
      && Date.parse(input.publishedAt) > Date.parse(input.retrievedAt)) {
      fail('finding.publishedAt', 'CONFLICT', 'Publication cannot be later than retrieval.')
    }
    if (input.evidenceText !== undefined && input.evidenceText !== null
      && (typeof input.evidenceText !== 'string' || !input.evidenceText.trim())) {
      fail('finding.evidenceText', 'INVALID_FINDING', 'Must be nonblank text or null.')
    }
    if (Object.hasOwn(input, 'verificationStatus') && input.verificationStatus !== 'unreviewed') {
      fail('finding.verificationStatus', 'VERIFICATION_FORBIDDEN', 'Organizer accepts only unreviewed findings; human verification is a separate workflow.')
    }
    const source = typeof input.sourceId === 'string' ? getSourceById(input.sourceId) : undefined
    if (!source) fail('finding.sourceId', 'UNKNOWN_SOURCE', 'Source ID is not registered.')
    else if (!isSourceUrl(source.id, input.sourceUrl)) {
      fail('finding.sourceUrl', 'SOURCE_MISMATCH', 'Must be a valid HTTPS URL on the registered source origin.')
    }
    if (!isObject(input.facts)) {
      fail('finding.facts', 'INVALID_FINDING', 'Required plain object.')
      return { ok: false, errors }
    }
    const facts = input.facts
    const factKeys = ['id', 'category', 'title', 'provider', 'summary', 'eligibilitySummary',
      'cost', 'applicability', 'deadline', 'topics', 'tags']
    for (const key of Object.keys(facts)) {
      if (!factKeys.includes(key)) fail(`finding.facts.${key}`, 'INVALID_FINDING', 'Unexpected property; source and verification metadata cannot be overridden.')
    }
    for (const key of ['id', 'category', 'title', 'provider', 'summary', 'eligibilitySummary']) {
      const value = facts[key]
      if (['provider', 'summary', 'eligibilitySummary'].includes(key) && (value === undefined || value === null)) continue
      if (typeof value !== 'string' || !value.trim()) fail(`finding.facts.${key}`, 'INVALID_FINDING', 'Must be a nonblank string.')
    }
    if (source && typeof facts.category === 'string'
      && !source.categories.some(category => category === facts.category)) {
      fail('finding.facts.category', 'SOURCE_MISMATCH', 'Category is outside the registered source scope.')
    }
    if (isObject(facts.deadline) && facts.deadline.type !== 'fixed' && facts.deadline.date != null) {
      fail('finding.facts.deadline.date', 'CONFLICT', 'Only a fixed deadline may have an exact date; use a note for an expected annual deadline.')
    }
    if (isObject(facts.applicability) && Array.isArray(facts.applicability.states)) {
      if (facts.applicability.states.some(state => typeof state !== 'string' || !state.trim())) {
        fail('finding.facts.applicability.states', 'INVALID_FINDING', 'State names must be nonblank strings.')
      }
    }
    // Strings required by the shared contract use the explicit sentinel "unknown".
    // Only absent/null values default; malformed provided values must reach validation.
    const opportunity = {
      id: facts.id, category: facts.category, title: facts.title,
      provider: facts.provider ?? 'unknown', summary: facts.summary ?? 'unknown',
      eligibilitySummary: facts.eligibilitySummary ?? 'unknown', cost: facts.cost ?? 'unknown',
      applicability: facts.applicability ?? { scope: 'unknown', states: [] },
      deadline: facts.deadline ?? { type: 'unknown', date: null, note: null },
      topics: facts.topics ?? [], tags: facts.tags ?? [],
      sourceName: source?.name ?? null, sourceUrl: input.sourceUrl,
      sourceType: source?.sourceType ?? 'unknown',
      verificationStatus: 'unreviewed', lastVerifiedAt: null, verifiedBy: null,
    }
    const validationErrors: string[] = validateOpportunities({
      schemaVersion: SCHEMA_VERSION, generatedAt: input.retrievedAt, items: [opportunity],
    })
    for (const error of validationErrors) {
      if (error.startsWith('response.generatedAt:')) continue // reported above with input path
      const separator = error.indexOf(': ')
      fail(error.slice(0, separator).replace('items[0]', 'opportunity'),
        'INVALID_OPPORTUNITY', error.slice(separator + 2))
    }
    if (errors.length) return { ok: false, errors }

    // Assertions follow runtime validation; snapshots prevent caller mutations from changing evidence.
    const originalFinding = structuredClone(input) as unknown as SourceFinding
    return { ok: true, value: {
      opportunity: structuredClone(opportunity) as Opportunity,
      evidence: {
        opportunityId: originalFinding.facts.id, findingId: originalFinding.findingId,
        sourceId: originalFinding.sourceId, sourceUrl: originalFinding.sourceUrl,
        retrievedAt: originalFinding.retrievedAt, publishedAt: originalFinding.publishedAt ?? null,
        evidenceText: originalFinding.evidenceText ?? null, originalFinding,
      },
    } }
  }

  /** Atomic batch. Repeated IDs require explicit reconciliation, never silent last-write-wins. */
  organizeMany(input: unknown): OrganizerResult<OrganizedOpportunity[]> {
    if (!Array.isArray(input)) return { ok: false, errors: [
      { path: 'findings', code: 'INVALID_FINDING', message: 'Must be an array.' },
    ] }
    const records: OrganizedOpportunity[] = []
    const errors: OrganizerError[] = []
    const opportunityIds = new Set<string>()
    const findingIds = new Set<string>()
    for (const [index, finding] of input.entries()) {
      const result = this.organize(finding)
      if (!result.ok) {
        errors.push(...result.errors.map(error => ({ ...error, path: `findings[${index}].${error.path}` })))
        continue
      }
      const { opportunity, evidence } = result.value
      for (const [id, seen, path] of [
        [opportunity.id, opportunityIds, 'facts.id'], [evidence.findingId, findingIds, 'findingId'],
      ] as const) {
        if (seen.has(id)) errors.push({ path: `findings[${index}].${path}`, code: 'CONFLICT',
          message: `Repeated ID ${JSON.stringify(id)} requires reconciliation; findings are not automatically merged.` })
        seen.add(id)
      }
      records.push(result.value)
    }
    return errors.length ? { ok: false, errors } : { ok: true, value: records }
  }
}
