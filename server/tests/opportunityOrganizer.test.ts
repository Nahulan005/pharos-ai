import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SCHEMA_VERSION } from '../../shared/contract.ts'
import { validateOpportunities } from '../../shared/validateOpportunities.mjs'
import { OpportunityOrganizer } from '../src/opportunityOrganizer.ts'
import type { SourceFinding, OrganizerResult } from '../src/sourceFinding.ts'

const organizer = new OpportunityOrganizer()
// Synthetic unit-test observations only; never served as real opportunities.
function finding(): SourceFinding {
  return {
    findingId: 'observation-1', sourceId: 'national-scholarship-portal',
    sourceUrl: 'https://scholarships.gov.in/example?scheme=test',
    retrievedAt: '2026-11-02T10:30:00+05:30', publishedAt: '2026-10-01T00:00:00Z',
    evidenceText: 'Synthetic scholarship evidence for testing only.',
    facts: {
      id: 'test-scholarship', category: 'scholarship', title: 'Synthetic test scholarship',
      provider: 'Test issuer', summary: 'Test summary', eligibilitySummary: 'Test eligibility',
      cost: 'free', applicability: { scope: 'state', states: ['Tamil Nadu'] },
      deadline: { type: 'fixed', date: '2026-12-31', note: 'Test deadline' },
      topics: ['general'], tags: ['test'],
    },
  }
}
function rejected(result: OrganizerResult<unknown>, path: string, code?: string) {
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('Expected rejection')
  assert.ok(result.errors.some(error => error.path.includes(path) && (!code || error.code === code)),
    JSON.stringify(result.errors))
  assert.ok(result.errors.every(error => error.message.length > 0))
  assert.equal('value' in result, false)
}

test('valid finding produces the shared contract with exact provenance and no verification', () => {
  const input = finding()
  const result = organizer.organize(input)
  assert.ok(result.ok)
  assert.deepEqual(result.value.opportunity, {
    ...input.facts, sourceName: 'National Scholarship Portal', sourceType: 'official',
    sourceUrl: input.sourceUrl, verificationStatus: 'unreviewed', lastVerifiedAt: null, verifiedBy: null,
  })
  assert.deepEqual(result.value.evidence, {
    opportunityId: input.facts.id, findingId: input.findingId, sourceId: input.sourceId,
    sourceUrl: input.sourceUrl, retrievedAt: input.retrievedAt, publishedAt: input.publishedAt,
    evidenceText: input.evidenceText, originalFinding: input,
  })
  assert.deepEqual(validateOpportunities({ schemaVersion: SCHEMA_VERSION,
    generatedAt: input.retrievedAt, items: [result.value.opportunity] }), [])
  assert.equal('sourceId' in result.value.opportunity, false)
})

test('missing optional information stays unknown without guessing provider or eligibility', () => {
  const input: SourceFinding = { findingId: 'minimal', sourceId: 'swayam',
    sourceUrl: 'https://swayam.gov.in/test', retrievedAt: '2026-11-02T00:00:00Z',
    facts: { id: 'test-course', category: 'course_cert', title: 'Test course' } }
  for (const facts of [input.facts, { ...input.facts, provider: null, cost: null,
    deadline: null, applicability: null, topics: null, tags: null }]) {
    const result = organizer.organize({ ...input, facts })
    assert.ok(result.ok)
    assert.deepEqual(result.value.opportunity, {
      id: 'test-course', category: 'course_cert', title: 'Test course',
      provider: 'unknown', summary: 'unknown', eligibilitySummary: 'unknown', cost: 'unknown',
      deadline: { type: 'unknown', date: null, note: null },
      applicability: { scope: 'unknown', states: [] }, topics: [], tags: [],
      sourceName: 'SWAYAM', sourceType: 'official', sourceUrl: input.sourceUrl,
      verificationStatus: 'unreviewed', lastVerifiedAt: null, verifiedBy: null,
    })
    assert.equal(result.value.evidence.publishedAt, null)
    assert.equal(result.value.evidence.evidenceText, null)
  }
})

for (const key of ['findingId', 'sourceId', 'sourceUrl', 'retrievedAt', 'facts']) {
  test(`missing required ${key} returns a useful error`, () => {
    const input = finding() as unknown as Record<string, unknown>
    delete input[key]
    rejected(organizer.organize(input), key)
  })
}
for (const key of ['id', 'category', 'title']) {
  test(`missing required fact ${key} is rejected`, () => {
    const input = finding()
    delete (input.facts as Record<string, unknown>)[key]
    rejected(organizer.organize(input), key)
  })
}

test('unknown source and mismatched source URL/category are rejected', () => {
  rejected(organizer.organize({ ...finding(), sourceId: 'missing' }), 'sourceId', 'UNKNOWN_SOURCE')
  for (const sourceUrl of ['https://evil.com/', 'https://scholarships.gov.in.evil.com/',
    'http://scholarships.gov.in/', '/relative', 'https://user@scholarships.gov.in/']) {
    rejected(organizer.organize({ ...finding(), sourceUrl }), 'sourceUrl', 'SOURCE_MISMATCH')
  }
  rejected(organizer.organize({ ...finding(), facts: { ...finding().facts, category: 'software_perk' } }), 'category', 'SOURCE_MISMATCH')
})

for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', 'tomorrow', '2026-12-31T00:00:00Z', null]) {
  test(`invalid fixed deadline ${date} fails shared validation`, () => {
    const input = finding()
    rejected(organizer.organize({ ...input, facts: { ...input.facts,
      deadline: { type: 'fixed', date, note: null } } }), 'deadline.date')
  })
}

test('real leap dates and past fixed deadlines are preserved, not silently rewritten', () => {
  const input = finding()
  input.facts.deadline = { type: 'fixed', date: '2024-02-29', note: null }
  const result = organizer.organize(input)
  assert.ok(result.ok)
  assert.equal(result.value.opportunity.deadline.date, '2024-02-29')
})

test('invalid timestamps and impossible publication chronology are rejected', () => {
  for (const key of ['retrievedAt', 'publishedAt']) {
    for (const value of ['2026-02-30T00:00:00Z', '2026-11-02', '2026-11-02T00:00:00',
      '2026-11-02T25:00:00Z', 123]) {
      rejected(organizer.organize({ ...finding(), [key]: value }), key)
    }
  }
  rejected(organizer.organize({ ...finding(), publishedAt: '2027-01-01T00:00:00Z' }), 'publishedAt', 'CONFLICT')
})

test('contradictory deadline and geographic scope are rejected', () => {
  for (const type of ['unknown', 'rolling', 'annual_expected']) {
    rejected(organizer.organize({ ...finding(), facts: { ...finding().facts,
      deadline: { type, date: '2026-12-31', note: null } } }), 'deadline.date', 'CONFLICT')
  }
  for (const applicability of [{ scope: 'national', states: ['Tamil Nadu'] },
    { scope: 'unknown', states: ['Tamil Nadu'] }, { scope: 'state', states: [] },
    { scope: 'state', states: ['Tamil Nadu', ' '] }]) {
    rejected(organizer.organize({ ...finding(), facts: { ...finding().facts, applicability } }), 'applicability.states')
  }
})

test('malformed facts are rejected rather than defaulted or coerced', () => {
  for (const [key, value] of [['cost', 'probably-free'], ['cost', 0], ['title', ' '],
    ['provider', ''], ['topics', ['invented']], ['tags', 'tag'], ['deadline', {}],
    ['eligibilitySummary', false], ['applicability', []], ['id', 'Not a valid ID']]) {
    rejected(organizer.organize({ ...finding(), facts: { ...finding().facts, [key as string]: value } }), key as string)
  }
  for (const input of [null, [], 'finding', 1, { ...finding(), facts: null }]) {
    rejected(organizer.organize(input), 'finding')
  }
  rejected(organizer.organize({ ...finding(), evidenceText: 42 }), 'evidenceText')
})

test('attempted automatic verification or metadata overrides are rejected', () => {
  for (const verificationStatus of ['checked_against_source', 'demo', null, true]) {
    rejected(organizer.organize({ ...finding(), verificationStatus }), 'verificationStatus', 'VERIFICATION_FORBIDDEN')
  }
  for (const field of ['verifiedBy', 'lastVerifiedAt', 'verificationStatus', 'sourceType', 'sourceName']) {
    rejected(organizer.organize({ ...finding(), facts: { ...finding().facts, [field]: 'forged' } }), field)
  }
  rejected(organizer.organize({ ...finding(), verifiedBy: 'Someone' }), 'verifiedBy')
  const result = organizer.organize({ ...finding(), verificationStatus: 'unreviewed' })
  assert.ok(result.ok)
  assert.equal(result.value.opportunity.verificationStatus, 'unreviewed')
})

test('source trust never upgrades third-party or provider findings', () => {
  for (const [sourceId, sourceUrl, category] of [
    ['buddy4study', 'https://www.buddy4study.com/test', 'scholarship'],
    ['github-education', 'https://github.com/education/students', 'software_perk'],
  ]) {
    const result = organizer.organize({ ...finding(), sourceId, sourceUrl,
      facts: { ...finding().facts, category } })
    assert.ok(result.ok)
    assert.equal(result.value.opportunity.verificationStatus, 'unreviewed')
    assert.equal(result.value.opportunity.verifiedBy, null)
  }
})

test('evidence and organized facts are detached from each other and the caller', () => {
  const input = finding()
  const original = structuredClone(input)
  const result = organizer.organize(input)
  assert.ok(result.ok)
  assert.deepEqual(input, original)
  input.facts.tags!.push('changed')
  input.sourceUrl = 'https://evil.com/'
  assert.deepEqual(result.value.evidence.originalFinding, original)
  result.value.opportunity.deadline.date = null
  assert.equal(result.value.evidence.originalFinding.facts.deadline!.date, '2026-12-31')
  assert.deepEqual(result.value.opportunity.tags, ['test'])
})

test('batch rejects conflicting opportunity IDs and repeated finding IDs atomically', () => {
  const first = finding()
  const second = { ...finding(), findingId: 'observation-2', facts: { ...finding().facts, cost: 'paid' } }
  rejected(organizer.organizeMany([first, second]), 'facts.id', 'CONFLICT')
  rejected(organizer.organizeMany([first, { ...first, facts: { ...first.facts, id: 'another' } }]), 'findingId', 'CONFLICT')
  rejected(organizer.organizeMany([first, {}]), 'findings[1]')
  rejected(organizer.organizeMany(null), 'findings')
  rejected(organizer.organizeMany(new Array(1)), 'findings[0]')
  const valid = organizer.organizeMany([first, { ...second, facts: { ...second.facts, id: 'another' } }])
  assert.ok(valid.ok)
  assert.equal(valid.value.length, 2)
  assert.deepEqual(organizer.organizeMany([]), { ok: true, value: [] })
})
