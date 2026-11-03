import type { OpportunityCost } from '../../shared/contract.ts'
import { validateOpportunities } from '../../shared/validateOpportunities.mjs'
import { OpportunityOrganizer } from './opportunityOrganizer.ts'
import { EvidenceAssessmentService } from './evidenceAssessment.ts'
import type { EvidenceReport } from './evidenceAssessment.ts'
import type { OrganizedOpportunity, SourceFinding } from './sourceFinding.ts'
import { getSourceById, isSourceUrl, isValidSourceUrl } from './sourceRegistry.ts'

export interface OfficialEvidenceRecordV1 {
  id: string
  category: 'course' | 'scholarship' | 'internship'
  title: string
  provider: string
  source: { sourceId: 'nptel' | 'nsp' | 'aicte-internship'; url: string; checkedAt?: string | null; checkedBy?: string | null }
  details: { eligibility: string | null; deadline: string | null; cost: string | null; description: string | null }
  evidence: { field: 'title' | 'provider' | 'eligibility' | 'deadline' | 'cost' | 'description'; sourceUrl: string; exactText: string; reviewedByHuman?: boolean }[]
}
export interface OfficialEvidencePackV1 { version: '1.0'; records: OfficialEvidenceRecordV1[] }
export interface PackIssue { path: string; code: string; message: string }
interface RecordResultBase {
  index: number
  /** Detached original, including every excerpt and any malformed/unrecognized fields. */
  original: unknown
  issues: PackIssue[]
  /** Self-reported inspection is never authenticated by this offline adapter. */
  humanVerified: false
}
export type OfficialEvidenceRecordResult = RecordResultBase & (
  | { state: 'pending' | 'unsupported' | 'invalid'; assessment?: EvidenceReport }
  | { state: 'ready_for_organization'; finding: SourceFinding; organized: OrganizedOpportunity; assessment: EvidenceReport }
)
export interface OfficialEvidencePackResult {
  /** True means parse/validation succeeded, not that records are ready or verified. */
  ok: boolean
  original: unknown
  inputText: string | null
  issues: PackIssue[]
  records: OfficialEvidenceRecordResult[]
}
export interface OfficialEvidencePackOptions {
  assessmentService: EvidenceAssessmentService
  /** Actual, separately recorded observation instants. Never derive these from checkedAt. */
  observedAtByRecordId?: Readonly<Record<string, string>>
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object'
  && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
const text = (v: unknown): v is string => typeof v === 'string' && Boolean(v.trim())
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)
const timestamp = (v: unknown): v is string => validateOpportunities({ schemaVersion: 1, generatedAt: v, items: [] }).length === 0
function date(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith('0000')) return false
  const instant = Date.parse(v)
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === v
}
/** Excerpt URLs are metadata only; accepting their syntax grants no registry membership/access. */
function excerptUrl(v: unknown): v is string {
  if (typeof v !== 'string' || !/^https:\/\//i.test(v) || /[\s\\\u0000-\u001f\u007f]/u.test(v)) return false
  try { const url = new URL(v); return Boolean(url.hostname) && !url.username && !url.password } catch { return false }
}
const costs: readonly OpportunityCost[] = ['free', 'free_to_learn_paid_cert', 'paid', 'unknown']

/**
 * Standalone/offline v1 adapter. No persistence, URL fetching, authentication or publication.
 * State precedence: invalid, unsupported, pending, ready. Internships are always unsupported
 * unless malformed. Ready means structurally ingestable, not approved for factual output.
 * Free-text costs remain unknown unless already an exact shared enum; non-ISO deadline
 * text remains an unknown deadline note. Original values and quotes are always retained.
 */
export function adaptOfficialEvidencePack(input: unknown, options: OfficialEvidencePackOptions): OfficialEvidencePackResult {
  const inputText = typeof input === 'string' ? input : null
  let original: unknown
  try { original = inputText === null ? structuredClone(input) : JSON.parse(inputText) }
  catch { return { ok: false, original: input, inputText, issues: [{ path: 'pack', code: 'INVALID_PACKAGE', message: 'Expected JSON or cloneable JSON-shaped input.' }], records: [] } }
  const issues: PackIssue[] = []
  const add = (list: PackIssue[], path: string, code: string, message: string) => { list.push({ path, code, message }) }
  const shape = (v: unknown, path: string, required: string[], optional: string[], into: PackIssue[]): v is Record<string, unknown> => {
    if (!object(v)) { add(into, path, 'INVALID_SHAPE', 'Expected a plain object.'); return false }
    for (const key of required) if (!Object.hasOwn(v, key)) add(into, `${path}.${key}`, 'MISSING_FIELD', 'Required field is missing.')
    for (const key of Object.keys(v)) if (![...required, ...optional].includes(key)) add(into, `${path}.${key}`, 'UNEXPECTED_FIELD', 'Unrecognized field is preserved but not accepted.')
    return true
  }
  shape(original, 'pack', ['version', 'records'], [], issues)
  const envelope = object(original) ? original : undefined
  if (envelope && envelope.version !== '1.0') add(issues, 'pack.version', 'INVALID_VERSION', 'Expected version "1.0".')
  const records = envelope && Array.isArray(envelope.records) ? envelope.records : []
  if (!envelope || !Array.isArray(envelope.records)) add(issues, 'pack.records', 'INVALID_RECORDS', 'Expected a records array; original package is preserved.')
  const observations = options.observedAtByRecordId ?? {}
  if (!object(observations)) add(issues, 'observedAtByRecordId', 'INVALID_OBSERVATIONS', 'Expected a record-ID-to-timestamp mapping.')
  const counts = new Map<string, number>()
  for (const record of records) if (object(record) && id(record.id)) counts.set(record.id, (counts.get(record.id) ?? 0) + 1)
  if (object(observations)) for (const key of Object.keys(observations)) {
    if (!counts.has(key)) add(issues, `observedAtByRecordId.${key}`, 'UNKNOWN_RECORD', 'Observation refers to no package record.')
  }
  const organizer = new OpportunityOrganizer()
  const results: OfficialEvidenceRecordResult[] = Array.from(records, (raw: unknown, index: number): OfficialEvidenceRecordResult => {
    const p = `records[${index}]`, errors: PackIssue[] = []
    const base: RecordResultBase = { index, original: structuredClone(raw), issues: errors, humanVerified: false }
    if (!shape(raw, p, ['id', 'category', 'title', 'provider', 'source', 'details', 'evidence'], [], errors)) return { ...base, state: 'invalid' }
    if (!id(raw.id)) add(errors, `${p}.id`, 'INVALID_ID', 'Expected a lowercase kebab-case ID.')
    else if (counts.get(raw.id)! > 1) add(errors, `${p}.id`, 'DUPLICATE_ID', 'Every occurrence of a repeated ID requires reconciliation.')
    for (const key of ['title', 'provider']) if (!text(raw[key])) add(errors, `${p}.${key}`, 'INVALID_TEXT', 'Expected nonblank text.')
    if (!['course', 'scholarship', 'internship'].includes(String(raw.category))) add(errors, `${p}.category`, 'INVALID_CATEGORY', 'Expected course, scholarship or internship.')
    if (shape(raw.source, `${p}.source`, ['sourceId', 'url'], ['checkedAt', 'checkedBy'], errors)) {
      const s = raw.source
      const expected = raw.category === 'course' ? 'nptel' : raw.category === 'scholarship' ? 'nsp' : 'aicte-internship'
      if (s.sourceId !== expected) add(errors, `${p}.source.sourceId`, 'SOURCE_CATEGORY_CONFLICT', 'Source ID does not match the v1 category/source pairing.')
      if (!isValidSourceUrl(s.url)) add(errors, `${p}.source.url`, 'INVALID_URL', 'Expected a valid primary HTTPS source URL.')
      if (s.checkedAt != null && !date(s.checkedAt)) add(errors, `${p}.source.checkedAt`, 'INVALID_DATE', 'Expected a real YYYY-MM-DD inspection date or null, not a retrieval timestamp.')
      if (s.checkedBy != null && !text(s.checkedBy)) add(errors, `${p}.source.checkedBy`, 'INVALID_REVIEWER', 'Expected a nonblank name or null.')
    }
    if (shape(raw.details, `${p}.details`, ['eligibility', 'deadline', 'cost', 'description'], [], errors)) {
      for (const [key, value] of Object.entries(raw.details)) {
        if (value !== null && !text(value)) add(errors, `${p}.details.${key}`, 'INVALID_DETAIL', 'Expected nonblank text or null.')
      }
      if (typeof raw.details.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.details.deadline) && !date(raw.details.deadline)) {
        add(errors, `${p}.details.deadline`, 'INVALID_DEADLINE', 'Invalid calendar deadline date.')
      }
    }
    if (!Array.isArray(raw.evidence)) add(errors, `${p}.evidence`, 'INVALID_EVIDENCE', 'Expected an array of original excerpts.')
    else for (const [j, quote] of raw.evidence.entries()) {
      const q = `${p}.evidence[${j}]`
      if (!shape(quote, q, ['field', 'sourceUrl', 'exactText'], ['reviewedByHuman'], errors)) continue
      if (!['title', 'provider', 'eligibility', 'deadline', 'cost', 'description'].includes(String(quote.field))) add(errors, `${q}.field`, 'INVALID_FIELD', 'Excerpt must name a supported record field.')
      if (!excerptUrl(quote.sourceUrl)) add(errors, `${q}.sourceUrl`, 'INVALID_URL', 'Expected an HTTPS evidence URL without credentials.')
      if (!text(quote.exactText)) add(errors, `${q}.exactText`, 'INVALID_EXCERPT', 'Expected a nonblank exact excerpt.')
      if (quote.reviewedByHuman !== undefined && typeof quote.reviewedByHuman !== 'boolean') add(errors, `${q}.reviewedByHuman`, 'INVALID_REVIEW_FLAG', 'Expected a boolean when supplied.')
    }
    const hasObservation = id(raw.id) && object(observations) && Object.hasOwn(observations, raw.id)
    const observedAt: unknown = hasObservation ? observations[raw.id as string] : undefined
    if (hasObservation && !timestamp(observedAt)) add(errors, `observedAtByRecordId.${String(raw.id)}`, 'INVALID_OBSERVATION_TIME', 'Actual observation time must be a valid ISO timestamp with seconds and timezone.')
    if (issues.length) add(errors, p, 'INVALID_PACKAGE', 'Resolve package-level errors before organization; record is preserved.')
    if (errors.length) return { ...base, state: 'invalid' }
    // All record structure and primitive types were checked above; do not change the original.
    const record = raw as unknown as OfficialEvidenceRecordV1
    if (record.category === 'internship') {
      add(errors, `${p}.category`, 'UNSUPPORTED_CATEGORY', 'Internships are not represented by the shared Opportunity contract.')
      return { ...base, state: 'unsupported' }
    }
    const sourceId = record.source.sourceId === 'nsp' ? 'national-scholarship-portal' : record.source.sourceId
    const source = getSourceById(sourceId)
    if (!source || !isSourceUrl(sourceId, record.source.url)) {
      add(errors, `${p}.source.url`, 'UNSUPPORTED_SOURCE_ORIGIN', 'Primary URL is outside the registered exact origin; it is preserved without rewriting or granting source membership.')
      return { ...base, state: 'unsupported' }
    }
    if (record.source.checkedAt == null || record.source.checkedBy == null || record.evidence.length === 0
      || record.evidence.some(q => q.reviewedByHuman !== true)) {
      add(errors, p, 'MISSING_HUMAN_INSPECTION', 'Inspection date, name and an inspected excerpt set are required for organization; these assertions are not authenticated verification.')
    }
    if (observedAt === undefined) add(errors, p, 'MISSING_OBSERVATION_TIME', 'Supply an actual observation timestamp separately; checkedAt cannot supply it.')
    if (record.evidence.some(q => q.sourceUrl !== record.source.url)) {
      add(errors, `${p}.evidence`, 'MULTI_URL_EVIDENCE', 'Excerpts are preserved, but the single-URL SourceFinding cannot attribute other URLs to the primary page.')
    }
    if (errors.length) return { ...base, state: 'pending' }
    const deadline = record.details.deadline
    const finding: SourceFinding = {
      findingId: `official-pack-${record.id}`, sourceId, sourceUrl: record.source.url,
      retrievedAt: observedAt as string, verificationStatus: 'unreviewed',
      evidenceText: record.evidence.map(q => q.exactText).join('\n\n'),
      facts: { id: record.id, category: record.category === 'course' ? 'course_cert' : 'scholarship',
        title: record.title, provider: record.provider, summary: record.details.description,
        eligibilitySummary: record.details.eligibility,
        cost: costs.includes(record.details.cost as OpportunityCost) ? record.details.cost as OpportunityCost : 'unknown',
        deadline: deadline !== null && date(deadline) ? { type: 'fixed', date: deadline, note: null }
          : { type: 'unknown', date: null, note: deadline },
      },
    }
    const organized = organizer.organize(finding)
    if (!organized.ok) { errors.push(...organized.errors); return { ...base, state: 'invalid' } }
    const assessment = options.assessmentService.assess(organized.value)
    const failures = assessment.issues.filter(issue => issue.severity === 'error')
    if (failures.length) { errors.push(...failures); return { ...base, state: 'invalid', assessment } }
    return { ...base, state: 'ready_for_organization', finding, organized: organized.value, assessment }
  })
  return { ok: issues.length === 0 && !results.some(r => r.state === 'invalid'), original, inputText, issues, records: results }
}
