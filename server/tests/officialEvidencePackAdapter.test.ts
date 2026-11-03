import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adaptOfficialEvidencePack } from '../src/officialEvidencePackAdapter.ts'
import type { OfficialEvidenceRecordV1, OfficialEvidencePackV1, OfficialEvidencePackOptions } from '../src/officialEvidencePackAdapter.ts'
import { EvidenceAssessmentService } from '../src/evidenceAssessment.ts'
import { getSourceById, isSourceUrl } from '../src/sourceRegistry.ts'

// Fictional unit-test observations only; no external source was inspected or fetched.
const observedAt = '2026-11-02T10:15:30+05:30'
const assessmentService = new EvidenceAssessmentService({ maxObservationAgeMs: 86_400_000 }, () => '2026-11-02T12:00:00Z')
const options: OfficialEvidencePackOptions = { assessmentService }
function record(category: OfficialEvidenceRecordV1['category'] = 'course', id = 'test-record'): OfficialEvidenceRecordV1 {
  const sourceId = category === 'course' ? 'nptel' : category === 'scholarship' ? 'nsp' : 'aicte-internship'
  const url = category === 'course' ? 'https://nptel.ac.in/courses/test-only'
    : category === 'scholarship' ? 'https://scholarships.gov.in/test-only' : 'https://internship.aicte-india.org/test-only'
  return { id, category, title: 'Fictional test listing', provider: 'Test provider',
    source: { sourceId, url, checkedAt: null, checkedBy: null },
    details: { eligibility: null, deadline: null, cost: null, description: null },
    evidence: [{ field: 'title', sourceUrl: url, exactText: '  Exact test excerpt.\nSecond line.  ', reviewedByHuman: false }],
  }
}
function inspected(category: OfficialEvidenceRecordV1['category'] = 'course', id = 'test-record') {
  const r = record(category, id)
  r.source.checkedAt = '2026-11-02'; r.source.checkedBy = 'Self-reported collector'
  r.evidence[0].reviewedByHuman = true
  return r
}
const pack = (...records: OfficialEvidenceRecordV1[]): OfficialEvidencePackV1 => ({ version: '1.0', records })
const adapt = (input: unknown, times: Readonly<Record<string, string>> = {}) =>
  adaptOfficialEvidencePack(input, { ...options, observedAtByRecordId: times })

test('v1 six-record pack is preserved in order: four pending and two unsupported internships', () => {
  const input = pack(record('scholarship', 'scholarship-one'), record('scholarship', 'scholarship-two'),
    record('course', 'course-one'), record('course', 'course-two'), record('internship', 'internship-one'), record('internship', 'internship-two'))
  const before = structuredClone(input), json = JSON.stringify(input, null, 2)
  const result = adapt(json)
  assert.equal(result.ok, true)
  assert.deepEqual(result.records.map(r => r.state), ['pending', 'pending', 'pending', 'pending', 'unsupported', 'unsupported'])
  assert.equal(result.records.length, 6)
  assert.equal(result.inputText, json)
  assert.deepEqual(result.original, input)
  assert.deepEqual(result.records.map(r => r.original), input.records)
  assert.ok(result.records.every(r => r.humanVerified === false && !('finding' in r)))
  assert.deepEqual(input, before)
})

test('pending metadata does not call assessment, invent times or upgrade verification', () => {
  const notCalled = new EvidenceAssessmentService({ maxObservationAgeMs: 0 }, () => { throw new Error('Assessment must not run for pending records') })
  for (const change of [
    (r: OfficialEvidenceRecordV1) => { r.source.checkedAt = null },
    (r: OfficialEvidenceRecordV1) => { r.source.checkedBy = null },
    (r: OfficialEvidenceRecordV1) => { delete r.source.checkedAt; delete r.source.checkedBy },
    (r: OfficialEvidenceRecordV1) => { r.evidence[0].reviewedByHuman = false },
    (r: OfficialEvidenceRecordV1) => { delete r.evidence[0].reviewedByHuman },
    (r: OfficialEvidenceRecordV1) => { r.evidence = [] },
  ]) {
    const input = inspected(); change(input)
    const result = adaptOfficialEvidencePack(pack(input), { assessmentService: notCalled, observedAtByRecordId: { 'test-record': observedAt } })
    assert.equal(result.records[0].state, 'pending')
    assert.ok(result.records[0].issues.some(i => i.code === 'MISSING_HUMAN_INSPECTION'))
    assert.deepEqual(result.records[0].original, input)
    assert.equal('finding' in result.records[0], false)
  }
  const result = adapt(pack(inspected()))
  assert.equal(result.records[0].state, 'pending')
  assert.ok(result.records[0].issues.some(i => i.code === 'MISSING_OBSERVATION_TIME'))
  assert.equal('finding' in result.records[0], false)
})

test('supported mappings reuse the organizer and assessor with only actual recorded observation time', () => {
  for (const category of ['course', 'scholarship'] as const) {
    const input = inspected(category)
    input.details = { eligibility: 'Example conditions', deadline: '2026-12-31', cost: 'free', description: 'Example description' }
    const r = adapt(pack(input), { 'test-record': observedAt }).records[0]
    assert.equal(r.state, 'ready_for_organization')
    if (r.state !== 'ready_for_organization') throw new Error('Expected ready record')
    assert.equal(r.finding.facts.category, category === 'course' ? 'course_cert' : 'scholarship')
    assert.equal(r.finding.sourceId, category === 'course' ? 'nptel' : 'national-scholarship-portal')
    assert.equal(r.finding.sourceUrl, input.source.url)
    assert.equal(r.finding.retrievedAt, observedAt)
    assert.equal(r.finding.evidenceText, input.evidence[0].exactText)
    assert.equal(r.finding.facts.summary, input.details.description)
    assert.equal(r.finding.facts.eligibilitySummary, input.details.eligibility)
    assert.deepEqual(r.finding.facts.deadline, { type: 'fixed', date: '2026-12-31', note: null })
    assert.equal(r.organized.opportunity.verificationStatus, 'unreviewed')
    assert.equal(r.organized.opportunity.verifiedBy, null)
    assert.equal(r.organized.opportunity.lastVerifiedAt, null)
    assert.equal(r.assessment.humanVerified, false)
    assert.deepEqual(r.assessment, assessmentService.assess(r.organized))
    assert.deepEqual(r.original, input)
  }
})

test('AICTE internships remain unsupported even with complete inspection and observation metadata', () => {
  const input = inspected('internship')
  const r = adapt(pack(input), { 'test-record': observedAt }).records[0]
  assert.equal(r.state, 'unsupported')
  assert.ok(r.issues.some(i => i.code === 'UNSUPPORTED_CATEGORY'))
  assert.deepEqual(r.original, input)
  assert.equal('finding' in r, false)
  assert.equal(getSourceById('aicte-internship'), undefined)
})

test('cross-origin official syllabus excerpts are preserved and never attributed to the primary page', () => {
  const input = inspected()
  input.evidence.push({ field: 'description', sourceUrl: 'https://onlinecourses.nptel.ac.in/noc26-test/preview#syllabus',
    exactText: '\nOriginal syllabus quote.\n', reviewedByHuman: true })
  const r = adapt(pack(input), { 'test-record': observedAt }).records[0]
  assert.equal(r.state, 'pending')
  assert.ok(r.issues.some(i => i.code === 'MULTI_URL_EVIDENCE'))
  assert.deepEqual(r.original, input)
  assert.equal(isSourceUrl('nptel', input.evidence[1].sourceUrl), false)
  assert.equal('finding' in r, false)
  input.source.url = 'https://onlinecourses.nptel.ac.in/noc26-test/preview'
  const differentPrimary = adapt(pack(input), { 'test-record': observedAt }).records[0]
  assert.equal(differentPrimary.state, 'unsupported')
  assert.ok(differentPrimary.issues.some(i => i.code === 'UNSUPPORTED_SOURCE_ORIGIN'))
  assert.deepEqual(differentPrimary.original, input)
})

test('duplicate IDs mark all occurrences invalid, retaining every record and excerpt', () => {
  const first = record(), second = record('scholarship')
  const input = pack(first, second, record('internship', 'other'))
  const result = adapt(input)
  assert.equal(result.ok, false)
  assert.deepEqual(result.records.map(r => r.state), ['invalid', 'invalid', 'unsupported'])
  assert.ok(result.records.slice(0, 2).every(r => r.issues.some(i => i.code === 'DUPLICATE_ID')))
  assert.deepEqual(result.records.map(r => r.original), input.records)
})

test('malformed envelopes and JSON fail explicitly while recoverable records and raw input survive', () => {
  for (const input of ['{broken', null, [], {}, { version: '1.0', records: {} }]) {
    const result = adapt(input)
    assert.equal(result.ok, false)
    assert.ok(result.issues.length > 0)
    assert.deepEqual(result.original, input)
  }
  for (const input of [{ version: '2.0', records: [record(), null] }, { schemaVersion: 1, records: [record()] }]) {
    const result = adapt(input)
    assert.equal(result.ok, false)
    assert.equal(result.records.length, input.records.length)
    assert.ok(result.records.every(r => r.state === 'invalid'))
    assert.deepEqual(result.records.map(r => r.original), input.records)
  }
})

test('malformed and contradictory records are invalid even before human inspection', () => {
  for (const patch of [{ id: 'Bad ID' }, { category: 'software_perk' }, { title: '' }, { provider: 10 },
    { source: null }, { details: null }, { evidence: null }, { verificationStatus: 'checked_against_source' }]) {
    const input = { ...record(), ...patch }
    const r = adapt({ version: '1.0', records: [input] }).records[0]
    assert.equal(r.state, 'invalid', JSON.stringify(patch))
    assert.ok(r.issues.length > 0)
    assert.deepEqual(r.original, input)
  }
  for (const patch of [{ sourceId: 'nsp' }, { checkedAt: '2026-02-30' }, { checkedAt: observedAt },
    { checkedBy: '' }, { checkedBy: true }, { url: 'http://nptel.ac.in/course' }]) {
    const input = record(); Object.assign(input.source, patch)
    assert.equal(adapt(pack(input)).records[0].state, 'invalid', JSON.stringify(patch))
  }
  for (const patch of [{ field: 'verifiedBy' }, { sourceUrl: 'javascript:alert(1)' }, { exactText: '' }, { reviewedByHuman: 'true' }, { reviewedByHuman: null }]) {
    const input = record(); Object.assign(input.evidence[0], patch)
    assert.equal(adapt(pack(input)).records[0].state, 'invalid', JSON.stringify(patch))
  }
  for (const patch of [{ deadline: '2026-02-30' }, { cost: 0 }, { description: [] }, { eligibility: '' }]) {
    const input = record(); Object.assign(input.details, patch)
    assert.equal(adapt(pack(input)).records[0].state, 'invalid', JSON.stringify(patch))
  }
})

test('observation timestamps require real instants, correct IDs and assessment chronology', () => {
  for (const value of ['2026-11-02', '2026-11-02T12:00:00', '2026-02-30T00:00:00Z', '', null, undefined]) {
    const result = adaptOfficialEvidencePack(pack(inspected()), { ...options, observedAtByRecordId: { 'test-record': value } as unknown as Record<string, string> })
    assert.equal(result.records[0].state, 'invalid')
    assert.ok(result.records[0].issues.some(i => i.code === 'INVALID_OBSERVATION_TIME'))
  }
  const unknownId = adapt(pack(inspected()), { unknown: observedAt })
  assert.equal(unknownId.ok, false)
  assert.ok(unknownId.issues.some(i => i.code === 'UNKNOWN_RECORD'))
  const future = adapt(pack(inspected()), { 'test-record': '2027-01-01T00:00:00Z' }).records[0]
  assert.equal(future.state, 'invalid')
  assert.ok(future.issues.some(i => i.code === 'FUTURE_TIMESTAMP'))
})

test('unstructured cost and deadline text stay unknown, not guessed; review metadata never authenticates', () => {
  const input = inspected()
  input.details.cost = 'Learning may be free; check exam terms.'
  input.details.deadline = 'See the next application cycle.'
  const result = adapt(pack(input), { 'test-record': observedAt }).records[0]
  assert.equal(result.state, 'ready_for_organization')
  if (result.state !== 'ready_for_organization') throw new Error('Expected ready record')
  assert.equal(result.finding.facts.cost, 'unknown')
  assert.deepEqual(result.finding.facts.deadline, { type: 'unknown', date: null, note: input.details.deadline })
  assert.equal(result.assessment.overall, 'needs_review')
  assert.equal(result.humanVerified, false)
  assert.equal(result.assessment.humanVerified, false)
  assert.deepEqual(result.original, input)
})

test('adapter is deterministic, does not mutate inputs, and mapped fields cannot alter original excerpts', () => {
  const input = pack(inspected()), before = structuredClone(input), times = { 'test-record': observedAt }
  const first = adapt(input, times), second = adapt(input, times)
  assert.deepEqual(first, second)
  assert.deepEqual(input, before)
  const r = first.records[0]
  assert.equal(r.state, 'ready_for_organization')
  if (r.state !== 'ready_for_organization') throw new Error('Expected ready record')
  r.finding.evidenceText = 'Changed mapped output'
  r.organized.opportunity.title = 'Changed mapped output'
  assert.deepEqual(r.original, before.records[0])
  input.records[0].evidence[0].exactText = 'Changed caller input'
  assert.deepEqual(second.records[0].original, before.records[0])
})
