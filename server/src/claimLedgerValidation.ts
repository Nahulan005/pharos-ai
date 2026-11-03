import { isDeepStrictEqual } from 'node:util'
import type { Actor, ClaimLedger, LedgerValidationContext } from './claimLedger.ts'

export interface LedgerIssue { path: string; message: string }
export type LedgerValidation = { ok: true; value: ClaimLedger } | { ok: false; issues: LedgerIssue[] }
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)
const text = (v: unknown): v is string => typeof v === 'string' && Boolean(v.trim())
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
export function isLedgerDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith('0000')) return false
  const parsed = Date.parse(`${v}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === v
}
export function isLedgerTimestamp(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(v)
  return Boolean(m && isLedgerDate(m[1]) && +m[2] < 24 && +m[3] < 60 && +m[4] < 60
    && (m[5] === 'Z' || (+m[6] <= 14 && +m[7] < 60 && (+m[6] < 14 || +m[7] === 0)))
    && Number.isFinite(Date.parse(v)))
}
const time = (v: unknown): number => isLedgerTimestamp(v) ? Date.parse(v) : NaN
function url(v: unknown): boolean {
  if (typeof v !== 'string' || !/^https:\/\//i.test(v) || /[\s\\]/.test(v)) return false
  try { const u = new URL(v); return Boolean(u.hostname) && !u.username && !u.password } catch { return false }
}
const types = ['application_deadline', 'application_url', 'learning_cost', 'assessment_fee', 'certificate_fee', 'eligibility_text', 'benefit_text']
type Obj = Record<string, any>

/** Validates a complete in-memory ledger and all references. Does not authenticate callers or read storage. */
export function validateClaimLedger(input: unknown, context: LedgerValidationContext): LedgerValidation {
  const issues: LedgerIssue[] = []
  const check = (condition: unknown, path: string, message: string) => { if (!condition) issues.push({ path, message }) }
  const object = (v: unknown, path: string, keys: string[]): v is Obj => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) {
      check(false, path, 'Expected a plain object.'); return false
    }
    check(Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k)), path, 'Missing or unexpected properties.')
    return true
  }
  const ids = (v: unknown, path: string): v is string[] => {
    const valid = Array.isArray(v) && v.every(id) && new Set(v).size === v.length
    check(valid, path, 'Expected unique valid IDs.'); return valid
  }
  const ref = (v: unknown, path: string) => {
    if (object(v, path, ['claimId', 'version'])) check(id(v.claimId) && integer(v.version) && v.version > 0, path, 'Invalid claim reference.')
  }
  if (!object(input, 'ledger', ['claims', 'evidence', 'snapshots'])) return { ok: false, issues }
  for (const key of ['claims', 'evidence', 'snapshots']) check(Array.isArray(input[key]), key, 'Expected an array.')
  if (issues.length) return { ok: false, issues }
  const snapshots = new Map<string, Obj>(), evidence = new Map<string, Obj>(), claims = new Map<string, Obj>()
  const reviewIds = new Set<string>()
  for (const [i, s] of input.snapshots.entries()) {
    const p = `snapshots[${i}]`
    if (!object(s, p, ['snapshotId', 'sourceId', 'sourceUrl', 'retrievedAt', 'capture', 'retrievalMethod', 'contentRef', 'mediaType', 'sha256'])) continue
    check(id(s.snapshotId) && !snapshots.has(s.snapshotId), `${p}.snapshotId`, 'Invalid or duplicate snapshot ID.')
    check(id(s.sourceId) && context.registeredSourceIds.includes(s.sourceId), `${p}.sourceId`, 'Unregistered source reference.')
    check(url(s.sourceUrl), `${p}.sourceUrl`, 'Expected an HTTPS URL without credentials.')
    check(isLedgerTimestamp(s.retrievedAt), `${p}.retrievedAt`, 'Invalid retrieval timestamp.')
    check(['synthetic', 'captured'].includes(s.capture), `${p}.capture`, 'Invalid capture classification.')
    check(['fixture', 'manual', 'api', 'web_fetch'].includes(s.retrievalMethod)
      && (s.retrievalMethod !== 'fixture' || s.capture === 'synthetic'), `${p}.retrievalMethod`, 'Invalid retrieval method or fixture classification.')
    check(text(s.contentRef) && text(s.mediaType), p, 'Snapshot storage reference and media type are required.')
    check(typeof s.sha256 === 'string' && /^[a-f0-9]{64}$/.test(s.sha256), `${p}.sha256`, 'Invalid SHA-256 digest.')
    snapshots.set(s.snapshotId, s)
  }
  for (const [i, e] of input.evidence.entries()) {
    const p = `evidence[${i}]`
    if (!object(e, p, ['evidenceId', 'snapshotId', 'quote'])) continue
    check(id(e.evidenceId) && !evidence.has(e.evidenceId), `${p}.evidenceId`, 'Invalid or duplicate evidence ID.')
    check(id(e.snapshotId) && snapshots.has(e.snapshotId), `${p}.snapshotId`, 'Missing snapshot reference.')
    if (object(e.quote, `${p}.quote`, ['exact', 'location', 'before', 'after'])) {
      const q = e.quote
      check(text(q.exact) && typeof q.before === 'string' && typeof q.after === 'string', `${p}.quote`, 'Exact quote and surrounding context are required (context may be empty at boundaries).')
      if (object(q.location, `${p}.quote.location`, ['representationRef', 'start', 'end'])) {
        const l = q.location
        check(text(l.representationRef) && integer(l.start) && integer(l.end) && l.end > l.start
          && typeof q.exact === 'string' && l.end - l.start === q.exact.length, `${p}.quote.location`, 'Invalid quote location or length.')
      }
    }
    evidence.set(e.evidenceId, e)
  }
  for (const [i, c] of input.claims.entries()) {
    const p = `claims[${i}]`
    if (!object(c, p, ['opportunityId', 'claimId', 'version', 'cycle', 'proposedAt', 'proposer', 'evidenceIds', 'supersedes', 'validUntil', 'recheckBy', 'review', 'type', 'value'])) continue
    check(id(c.opportunityId) && context.opportunityIds.includes(c.opportunityId), `${p}.opportunityId`, 'Missing opportunity reference.')
    check(id(c.claimId) && integer(c.version) && c.version > 0 && !claims.has(`${c.claimId}:${c.version}`), p, 'Invalid or duplicate claim version.')
    check(c.cycle === null || id(c.cycle), `${p}.cycle`, 'Invalid cycle ID.')
    check(types.includes(c.type), `${p}.type`, 'Invalid claim type.')
    check(c.type !== 'application_deadline' || id(c.cycle), `${p}.cycle`, 'Deadline claims require a cycle.')
    check(isLedgerTimestamp(c.proposedAt), `${p}.proposedAt`, 'Invalid proposal timestamp.')
    if (object(c.proposer, `${p}.proposer`, ['kind', 'id'])) check(['human', 'ai', 'script'].includes(c.proposer.kind) && id(c.proposer.id), `${p}.proposer`, 'Invalid proposer.')
    for (const key of ['validUntil', 'recheckBy']) {
      check(c[key] === null || isLedgerTimestamp(c[key]), `${p}.${key}`, 'Expected null or a timestamp.')
      if (c[key] !== null) check(time(c[key]) >= time(c.proposedAt), `${p}.${key}`, 'Time bound precedes proposal.')
    }
    if (ids(c.evidenceIds, `${p}.evidenceIds`)) for (const eid of c.evidenceIds) check(evidence.has(eid), `${p}.evidenceIds`, `Missing evidence ${eid}.`)
    const v = c.value
    if (!v || typeof v !== 'object') check(false, `${p}.value`, 'Missing claim value.')
    else if (v.kind === 'unknown') {
      if (object(v, `${p}.value`, ['kind', 'reason', 'detail'])) check(['not_published', 'not_found', 'conflicting_evidence', 'ambiguous_source', 'not_applicable'].includes(v.reason) && text(v.detail), `${p}.value`, 'Explicit unknown reason and detail required.')
    } else if (c.type === 'application_deadline' && v.kind === 'date') {
      if (object(v, `${p}.value`, ['kind', 'date', 'timezone'])) check(isLedgerDate(v.date) && v.timezone === 'Asia/Kolkata', `${p}.value`, 'Expected a real IST calendar date.')
    } else if (c.type === 'application_deadline' && v.kind === 'instant') {
      if (object(v, `${p}.value`, ['kind', 'at'])) check(isLedgerTimestamp(v.at), `${p}.value`, 'Invalid deadline instant.')
    } else if (c.type === 'application_url' && v.kind === 'url') {
      if (object(v, `${p}.value`, ['kind', 'url'])) check(url(v.url), `${p}.value`, 'Invalid application URL.')
    } else if (['learning_cost', 'assessment_fee', 'certificate_fee'].includes(c.type) && v.kind === 'money') {
      if (object(v, `${p}.value`, ['kind', 'amountMinor', 'currency'])) check(integer(v.amountMinor) && typeof v.currency === 'string' && /^[A-Z]{3}$/.test(v.currency), `${p}.value`, 'Expected nonnegative integer minor units and a three-letter currency code.')
    } else if (['eligibility_text', 'benefit_text'].includes(c.type) && v.kind === 'text') {
      if (object(v, `${p}.value`, ['kind', 'text'])) check(text(v.text), `${p}.value`, 'Expected nonblank text.')
    } else check(false, `${p}.value`, 'Claim type and value kind do not match.')
    if (c.supersedes !== null) ref(c.supersedes, `${p}.supersedes`)
    if (c.review !== null && object(c.review, `${p}.review`, ['reviewId', 'claim', 'reviewer', 'reviewedAt', 'decision', 'evidenceIds', 'authority', 'rationale'])) {
      const r = c.review
      check(id(r.reviewId) && !reviewIds.has(r.reviewId), `${p}.review.reviewId`, 'Invalid or reused review ID.'); reviewIds.add(r.reviewId)
      ref(r.claim, `${p}.review.claim`)
      check(r.claim?.claimId === c.claimId && r.claim?.version === c.version, `${p}.review.claim`, 'Review must bind this exact claim version.')
      if (object(r.reviewer, `${p}.review.reviewer`, ['kind', 'id'])) check(r.reviewer.kind === 'human' && id(r.reviewer.id)
        && context.authenticatedReviewerIds.includes(r.reviewer.id), `${p}.review.reviewer`, 'Review requires an externally authenticated human identity.')
      check(isLedgerTimestamp(r.reviewedAt) && time(r.reviewedAt) >= time(c.proposedAt), `${p}.review.reviewedAt`, 'Invalid review chronology.')
      check(['approve', 'reject', 'request_changes'].includes(r.decision) && text(r.rationale), `${p}.review`, 'Invalid decision or missing rationale.')
      if (ids(r.evidenceIds, `${p}.review.evidenceIds`)) {
        check(r.evidenceIds.length > 0 && Array.isArray(c.evidenceIds) && c.evidenceIds.every(id)
          && isDeepStrictEqual([...r.evidenceIds].sort(), [...c.evidenceIds].sort()), `${p}.review.evidenceIds`, 'Review must cover all claim evidence, with at least one observation.')
        for (const eid of r.evidenceIds) {
          const s = snapshots.get(evidence.get(eid)?.snapshotId)
          check(s?.capture === 'captured', `${p}.review.evidenceIds`, 'Reviewed evidence must reference a real captured snapshot.')
          check(s && time(s.retrievedAt) <= time(r.reviewedAt), `${p}.review.reviewedAt`, 'Review cannot precede evidence retrieval.')
        }
      }
      check(Array.isArray(r.authority), `${p}.review.authority`, 'Expected claim-scoped authority judgments.')
      if (Array.isArray(r.authority)) {
        check(r.decision !== 'approve' || r.authority.length > 0, `${p}.review.authority`, 'Approval requires an explicit authority rationale.')
        const seen = new Set<string>()
        for (const a of r.authority) if (object(a, `${p}.review.authority`, ['evidenceId', 'rationale'])) {
          check(id(a.evidenceId) && Array.isArray(r.evidenceIds) && r.evidenceIds.includes(a.evidenceId) && !seen.has(a.evidenceId) && text(a.rationale), `${p}.review.authority`, 'Invalid authority evidence reference or rationale.')
          seen.add(a.evidenceId)
        }
      }
    }
    claims.set(`${c.claimId}:${c.version}`, c)
  }
  for (const [key, c] of claims) {
    if (c.version === 1) check(c.supersedes === null, `claims.${key}.supersedes`, 'First version cannot supersede a claim.')
    else {
      const previous = claims.get(`${c.claimId}:${c.version - 1}`)
      check(previous && c.supersedes?.claimId === c.claimId && c.supersedes?.version === c.version - 1
        && previous.opportunityId === c.opportunityId && previous.type === c.type && previous.cycle === c.cycle
        && time(previous.proposedAt) <= time(c.proposedAt)
        && (!previous.review || time(previous.review.reviewedAt) <= time(c.proposedAt)), `claims.${key}.supersedes`, 'Revision requires its immediate predecessor, stable scope and chronological order.')
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: structuredClone(input) as ClaimLedger }
}

/** Full prior history is required. Enforces append-only observations and immutable claim versions. */
export function validateClaimLedgerTransition(previous: unknown, next: unknown, context: LedgerValidationContext, actor: Actor): LedgerValidation {
  const before = validateClaimLedger(previous, context), after = validateClaimLedger(next, context)
  if (!before.ok) return before
  if (!after.ok) return after
  const issues: LedgerIssue[] = []
  const fail = (path: string, message: string) => { issues.push({ path, message }) }
  if (!actor || !id(actor.id) || !['human', 'ai', 'script'].includes(actor.kind)) fail('actor', 'Invalid trusted actor.')
  for (const kind of ['snapshots', 'evidence'] as const) {
    for (const old of before.value[kind]) {
      const current = 'snapshotId' in old && !('evidenceId' in old)
        ? after.value.snapshots.find(item => item.snapshotId === old.snapshotId)
        : after.value.evidence.find(item => item.evidenceId === old.evidenceId)
      if (!isDeepStrictEqual(old, current)) fail(kind, 'Existing observations cannot be edited, relabelled or removed.')
    }
  }
  for (const old of before.value.claims) {
    const current = after.value.claims.find(c => c.claimId === old.claimId && c.version === old.version)
    if (!current || !isDeepStrictEqual({ ...old, review: null }, { ...current, review: null })
      || (old.review !== null && !isDeepStrictEqual(old.review, current.review))) {
      fail(`claims.${old.claimId}:${old.version}`, 'Claim versions and recorded reviews are immutable; append a superseding version.')
    }
  }
  for (const c of after.value.claims) {
    const old = before.value.claims.find(x => x.claimId === c.claimId && x.version === c.version)
    if (!old && (!actor || c.proposer.id !== actor.id || c.proposer.kind !== actor.kind)) fail(`claims.${c.claimId}`, 'New claim proposer must match the trusted actor.')
    if (c.review && !old?.review && (!actor || actor.kind !== 'human' || actor.id !== c.review.reviewer.id
      || !context.authenticatedReviewerIds.includes(actor.id))) fail(`claims.${c.claimId}.review`, 'Only the authenticated reviewing human may record a review.')
  }
  return issues.length ? { ok: false, issues } : after
}
