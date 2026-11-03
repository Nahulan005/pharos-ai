import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Claim, ClaimLedger, HumanReview, LedgerValidationContext } from '../src/claimLedger.ts'
import { validateClaimLedger, validateClaimLedgerTransition } from '../src/claimLedgerValidation.ts'
import { effectiveStatus } from '../src/claimStatus.ts'

// Fictional test data only. 'captured' exercises the future real-capture shape; no website was fetched.
const context: LedgerValidationContext = {
  opportunityIds: ['course-one'], registeredSourceIds: ['source-one'], authenticatedReviewerIds: ['reviewer-one'],
}
const human = { kind: 'human', id: 'reviewer-one' } as const
const script = { kind: 'script', id: 'importer-one' } as const
const now = '2026-11-02T12:00:00Z'
function ledger(): ClaimLedger {
  return {
    snapshots: [{ snapshotId: 'snapshot-one', sourceId: 'source-one', sourceUrl: 'https://example.org/course',
      retrievedAt: '2026-11-01T09:00:00Z', capture: 'captured', retrievalMethod: 'manual',
      contentRef: 'captures/snapshot-one', mediaType: 'text/plain', sha256: 'a'.repeat(64) }],
    evidence: [{ evidenceId: 'evidence-one', snapshotId: 'snapshot-one', quote: {
      exact: 'Applications close on 2 November 2026.', before: '2026 cycle. ', after: ' Apply online.',
      location: { representationRef: 'captures/snapshot-one/text', start: 12, end: 50 },
    } }],
    claims: [{ opportunityId: 'course-one', claimId: 'deadline-one', version: 1, cycle: '2026',
      type: 'application_deadline', value: { kind: 'date', date: '2026-11-02', timezone: 'Asia/Kolkata' },
      proposedAt: '2026-11-01T10:00:00Z', proposer: script, evidenceIds: ['evidence-one'],
      supersedes: null, validUntil: null, recheckBy: null, review: null }],
  }
}
function review(): HumanReview {
  return { reviewId: 'review-one', claim: { claimId: 'deadline-one', version: 1 }, reviewer: { ...human },
    reviewedAt: '2026-11-01T11:00:00Z', decision: 'approve', evidenceIds: ['evidence-one'],
    authority: [{ evidenceId: 'evidence-one', rationale: 'Issuer statement for this course and application cycle.' }],
    rationale: 'Exact deadline statement checked against captured text.' }
}
function reviewed(): ClaimLedger { const l = ledger(); l.claims[0].review = review(); return l }
function invalid(value: unknown, path: string, ctx = context) {
  const result = validateClaimLedger(value, ctx)
  assert.ok(!result.ok)
  assert.ok(result.issues.some(issue => issue.path.includes(path)), JSON.stringify(result.issues))
}
function rejectedTransition(previous: ClaimLedger, next: ClaimLedger, actor = human) {
  const result = validateClaimLedgerTransition(previous, next, context, actor)
  assert.ok(!result.ok)
  return result.issues
}

test('candidate ledger retains exact evidence and is detached without changing public types', () => {
  const input = ledger(), before = structuredClone(input)
  const result = validateClaimLedger(input, context)
  assert.ok(result.ok, JSON.stringify(result))
  assert.equal(effectiveStatus(result.value.claims[0], now), 'candidate')
  assert.deepEqual(input, before)
  input.evidence[0].quote.exact = 'Changed'
  assert.equal(result.value.evidence[0].quote.exact, before.evidence[0].quote.exact)
})

test('all core claim types accept only their typed values, including explicit unknowns', () => {
  for (const [type, value] of [
    ['application_deadline', { kind: 'instant', at: '2026-11-02T18:30:00Z' }],
    ['application_url', { kind: 'url', url: 'https://example.org/apply' }],
    ['learning_cost', { kind: 'money', amountMinor: 0, currency: 'INR' }],
    ['assessment_fee', { kind: 'money', amountMinor: 10000, currency: 'INR' }],
    ['certificate_fee', { kind: 'money', amountMinor: 50000, currency: 'INR' }],
    ['eligibility_text', { kind: 'text', text: 'Current students.' }],
    ['benefit_text', { kind: 'text', text: 'Access to course materials.' }],
  ]) {
    const l = ledger()
    Object.assign(l.claims[0], { type, value })
    assert.ok(validateClaimLedger(l, context).ok)
    Object.assign(l.claims[0], { value: { kind: 'unknown', reason: 'not_published', detail: 'Issuer has not published the detail.' } })
    assert.ok(validateClaimLedger(l, context).ok)
    Object.assign(l.claims[0], { value: { kind: 'unknown', reason: 'guess', detail: '' } })
    invalid(l, 'value')
  }
  // Compile-time protection for the discriminated union, in addition to runtime validation.
  // @ts-expect-error A deadline cannot have a monetary value.
  const bad: Claim = { ...ledger().claims[0], type: 'application_deadline', value: { kind: 'money', amountMinor: 0, currency: 'INR' } }
  assert.ok(bad)
})

test('missing opportunity, source, snapshot and evidence references fail closed', () => {
  const missingOpportunity = ledger(); missingOpportunity.claims[0].opportunityId = 'missing'; invalid(missingOpportunity, 'opportunityId')
  const missingSource = ledger(); missingSource.snapshots[0].sourceId = 'missing'; invalid(missingSource, 'sourceId')
  const missingSnapshot = ledger(); missingSnapshot.evidence[0].snapshotId = 'missing'; invalid(missingSnapshot, 'snapshotId')
  const missingEvidence = ledger(); missingEvidence.claims[0].evidenceIds = ['missing']; invalid(missingEvidence, 'evidenceIds')
  const duplicate = ledger(); duplicate.claims[0].evidenceIds = ['evidence-one', 'evidence-one']; invalid(duplicate, 'evidenceIds')
})

test('candidate may lack evidence; any recorded review requires evidence and a human identity', () => {
  const candidate = ledger(); candidate.claims[0].evidenceIds = []
  assert.ok(validateClaimLedger(candidate, context).ok)
  candidate.claims[0].review = { ...review(), evidenceIds: [], authority: [] }
  invalid(candidate, 'review.evidenceIds')
  for (const kind of ['ai', 'script']) {
    const l = reviewed(); Object.assign(l.claims[0].review!.reviewer, { kind }); invalid(l, 'reviewer')
  }
  invalid(reviewed(), 'reviewer', { ...context, authenticatedReviewerIds: [] })
  const forged = ledger(); Object.assign(forged.claims[0], { status: 'reviewed' }); invalid(forged, 'claims[0]')
  const noRecord = ledger(); Object.assign(noRecord.claims[0], { review: {} }); invalid(noRecord, 'review')
})

test('only the authenticated human actor can add a review, even to an AI proposal', () => {
  const before = ledger(); before.claims[0].proposer = { kind: 'ai', id: 'model-one' }
  const after = structuredClone(before); after.claims[0].review = review()
  assert.ok(validateClaimLedgerTransition(before, after, context, human).ok)
  for (const actor of [script, { kind: 'ai', id: 'model-one' } as const, { kind: 'human', id: 'other-human' } as const]) {
    assert.equal(validateClaimLedgerTransition(before, after, context, actor).ok, false)
  }
  const empty: ClaimLedger = { claims: [], snapshots: [], evidence: [] }
  assert.ok(validateClaimLedgerTransition(empty, ledger(), context, script).ok)
  assert.equal(validateClaimLedgerTransition(empty, ledger(), context, human).ok, false)
})

test('reviews bind exact versions, all evidence, review IDs and explicit claim authority', () => {
  for (const patch of [{ claim: { claimId: 'another', version: 1 } }, { claim: { claimId: 'deadline-one', version: 2 } },
    { evidenceIds: ['missing'] }, { authority: [] }, { authority: [{ evidenceId: 'missing', rationale: 'Official source' }] },
    { reviewedAt: '2026-10-01T00:00:00Z' }, { decision: 'verified' }, { rationale: '' }]) {
    const l = reviewed(); Object.assign(l.claims[0].review!, patch); invalid(l, 'review')
  }
  const late = reviewed(); late.snapshots[0].retrievedAt = '2026-11-02T00:00:00Z'; invalid(late, 'reviewedAt')
})

test('synthetic observations cannot receive any human review or be relabelled in history', () => {
  const synthetic = ledger(); synthetic.snapshots[0].capture = 'synthetic'; synthetic.snapshots[0].retrievalMethod = 'fixture'
  assert.ok(validateClaimLedger(synthetic, context).ok)
  for (const decision of ['approve', 'reject', 'request_changes'] as const) {
    const after = structuredClone(synthetic); after.claims[0].review = { ...review(), decision }; invalid(after, 'review.evidenceIds')
  }
  const relabelled = structuredClone(synthetic); relabelled.snapshots[0].capture = 'captured'
  invalid(relabelled, 'retrievalMethod')
  relabelled.snapshots[0].retrievalMethod = 'manual'; relabelled.claims[0].review = review()
  assert.ok(validateClaimLedger(relabelled, context).ok) // A standalone snapshot cannot prove its origin.
  rejectedTransition(synthetic, relabelled)
})

test('deadline requires a cycle and expires at next midnight IST, including leap days', () => {
  const l = reviewed()
  assert.equal(effectiveStatus(l.claims[0], '2026-11-02T18:29:59.999Z'), 'reviewed')
  assert.equal(effectiveStatus(l.claims[0], '2026-11-02T18:30:00Z'), 'lapsed')
  assert.equal(effectiveStatus(l.claims[0], '2026-11-03T00:00:00+05:30'), 'lapsed')
  l.claims[0].cycle = null; invalid(l, 'cycle')
  const leap = ledger().claims[0]
  leap.proposedAt = '2024-02-28T00:00:00Z'
  Object.assign(leap, { value: { kind: 'date', date: '2024-02-29', timezone: 'Asia/Kolkata' } })
  assert.equal(effectiveStatus(leap, '2024-02-29T18:29:59.999Z'), 'candidate')
  assert.equal(effectiveStatus(leap, '2024-02-29T18:30:00Z'), 'lapsed')
})

test('validUntil and recheckBy are exclusive bounds with lapse taking precedence', () => {
  const c = reviewed().claims[0]
  c.recheckBy = '2026-11-02T12:00:00Z'; c.validUntil = '2026-11-02T13:00:00Z'
  assert.equal(effectiveStatus(c, '2026-11-02T11:59:59.999Z'), 'reviewed')
  assert.equal(effectiveStatus(c, now), 'needs_recheck')
  assert.equal(effectiveStatus(c, '2026-11-02T13:00:00Z'), 'lapsed')
  assert.equal(c.review!.decision, 'approve')
  c.review!.decision = 'reject'; assert.equal(effectiveStatus(c, '2026-11-03T00:00:00Z'), 'rejected')
  c.review!.decision = 'request_changes'; assert.equal(effectiveStatus(c, '2026-11-03T00:00:00Z'), 'changes_requested')
})

test('retrieval time neither extends validity nor supplies a review decision', () => {
  const l = ledger()
  l.snapshots[0].retrievedAt = '2026-11-03T00:00:00Z'
  assert.ok(validateClaimLedger(l, context).ok)
  assert.equal(effectiveStatus(l.claims[0], '2026-11-03T01:00:00Z'), 'lapsed')
  Object.assign(l.claims[0], { type: 'benefit_text', value: { kind: 'text', text: 'Materials.' } })
  assert.equal(effectiveStatus(l.claims[0], '2030-01-01T00:00:00Z'), 'candidate')
})

function revision(before = reviewed()): ClaimLedger {
  const c = structuredClone(before.claims[0])
  c.version = 2; c.supersedes = { claimId: c.claimId, version: 1 }; c.review = null
  c.proposedAt = '2026-11-02T10:00:00Z'; c.proposer = human
  Object.assign(c, { value: { kind: 'date', date: '2026-11-30', timezone: 'Asia/Kolkata' } })
  return { ...structuredClone(before), claims: [...structuredClone(before.claims), c] }
}

test('supersession appends a candidate version and retains the original reviewed facts', () => {
  const before = reviewed(), after = revision(before), snapshot = structuredClone(before)
  assert.ok(validateClaimLedgerTransition(before, after, context, human).ok)
  assert.equal(effectiveStatus(after.claims[1], now), 'candidate')
  assert.deepEqual(after.claims[0], before.claims[0])
  assert.deepEqual(before, snapshot)
  const edited = reviewed(); Object.assign(edited.claims[0], { value: { kind: 'date', date: '2026-11-30', timezone: 'Asia/Kolkata' } })
  assert.ok(validateClaimLedger(edited, context).ok) // Requires history to detect the edit.
  rejectedTransition(before, edited)
  const removed = { ...after, claims: [after.claims[1]] }; invalid(removed, 'supersedes')
})

test('invalid supersession, changed review, deleted history and edited evidence are rejected', () => {
  for (const patch of [{ version: 3 }, { supersedes: null }, { supersedes: { claimId: 'other', version: 1 } },
    { cycle: '2027' }, { opportunityId: 'other' }, { proposedAt: '2026-10-01T00:00:00Z' }]) {
    const l = revision(); Object.assign(l.claims[1], patch); assert.equal(validateClaimLedger(l, context).ok, false)
  }
  const before = reviewed()
  for (const edit of [
    (l: ClaimLedger) => { l.claims[0].review!.decision = 'reject' },
    (l: ClaimLedger) => { l.claims[0].review = null },
    (l: ClaimLedger) => { l.claims = [] },
    (l: ClaimLedger) => { l.claims[0].validUntil = '2027-01-01T00:00:00Z' },
    (l: ClaimLedger) => { l.evidence[0].quote.before = 'Changed context' },
    (l: ClaimLedger) => { l.snapshots[0].contentRef = 'replacement' },
  ]) { const after = structuredClone(before); edit(after); rejectedTransition(before, after) }
})

test('malformed inputs, dates, timestamps, IDs, quotes and type/value combinations are rejected', () => {
  for (const value of [null, [], {}, 'ledger', { claims: {}, snapshots: [], evidence: [] }]) assert.equal(validateClaimLedger(value, context).ok, false)
  for (const value of ['2026-02-29', '2026-04-31', '0000-01-01', '2026-13-01', 'tomorrow']) {
    const l = ledger(); Object.assign(l.claims[0].value, { date: value }); invalid(l, 'value')
  }
  for (const value of ['2026-02-30T00:00:00Z', '2026-11-02', '2026-11-02T12:00:00', '2026-11-02T24:00:00Z',
    '2026-11-02T12:00:00+14:30', '2026-11-02T12:00:60Z', null, 42]) {
    const l = ledger(); Object.assign(l.claims[0], { proposedAt: value }); invalid(l, 'proposedAt')
  }
  for (const patch of [{ claimId: '../bad' }, { version: 0 }, { version: 1.5 }, { type: 'invented' },
    { value: { kind: 'money', amountMinor: 0, currency: 'INR' } }, { validUntil: '2026-10-01T00:00:00Z' },
    { recheckBy: '2026-11-02' }, { proposer: { kind: 'unknown', id: 'actor' } }]) {
    const l = ledger(); Object.assign(l.claims[0], patch); invalid(l, 'claims')
  }
  const badQuote = ledger(); badQuote.evidence[0].quote.location.end = 2; invalid(badQuote, 'location')
  const badDigest = ledger(); badDigest.snapshots[0].sha256 = 'hash'; invalid(badDigest, 'sha256')
  const badUrl = ledger(); badUrl.snapshots[0].sourceUrl = 'https://user:password@example.org'; invalid(badUrl, 'sourceUrl')
  for (const amountMinor of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const l = ledger(); Object.assign(l.claims[0], { type: 'learning_cost', value: { kind: 'money', amountMinor, currency: 'INR' } }); invalid(l, 'value')
  }
})

test('duplicate identities and malformed nested records cannot bypass reference checks', () => {
  for (const key of ['claims', 'evidence', 'snapshots'] as const) {
    const l = ledger()
    Object.assign(l, { [key]: [...l[key], structuredClone(l[key][0])] })
    assert.equal(validateClaimLedger(l, context).ok, false)
  }
  const repeatedReview = revision()
  repeatedReview.claims[1].review = { ...review(), claim: { claimId: 'deadline-one', version: 2 }, reviewedAt: now }
  invalid(repeatedReview, 'reviewId')
  for (const patch of [{ review: [] }, { review: { ...review(), claim: null } },
    { review: { ...review(), reviewer: null } }, { review: { ...review(), authority: [null] } },
    { value: [] }, { value: null }, { proposer: null }, { evidenceIds: [null] },
    { validUntil: {} }, { supersedes: {} }]) {
    const l = ledger(); Object.assign(l.claims[0], patch)
    assert.equal(validateClaimLedger(l, context).ok, false)
  }
  const snapshot = ledger(); Object.assign(snapshot.snapshots[0], { capture: 'unknown' }); invalid(snapshot, 'capture')
  const quote = ledger(); Object.assign(quote.evidence[0], { quote: null }); invalid(quote, 'quote')
  const unknown = ledger(); Object.assign(unknown.claims[0], { value: { kind: 'unknown', reason: 'not_found', detail: 'Not located.' }, cycle: null }); invalid(unknown, 'cycle')
})

test('instant deadlines expire at equality and review decisions survive computed lapse', () => {
  const c = reviewed().claims[0], original = structuredClone(c.review)
  Object.assign(c, { value: { kind: 'instant', at: '2026-11-02T12:00:00Z' } })
  assert.equal(effectiveStatus(c, '2026-11-02T11:59:59.999Z'), 'reviewed')
  assert.equal(effectiveStatus(c, now), 'lapsed')
  assert.deepEqual(c.review, original)
})

test('validation and effective status are deterministic and preserve recorded decisions', () => {
  const l = reviewed(), before = structuredClone(l)
  assert.deepEqual(validateClaimLedger(l, context), validateClaimLedger(l, context))
  assert.equal(effectiveStatus(l.claims[0], now), effectiveStatus(l.claims[0], now))
  assert.deepEqual(l, before)
  assert.throws(() => effectiveStatus(l.claims[0], '2026-02-30T00:00:00Z'), RangeError)
  assert.throws(() => effectiveStatus(l.claims[0], '2026-10-01T00:00:00Z'), RangeError)
})
