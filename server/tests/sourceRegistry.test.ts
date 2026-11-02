import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  sources, getSourceById, isValidSourceUrl, isSourceUrl,
  isAutomatedRetrievalPermitted, getSourceTrust,
} from '../src/sourceRegistry.ts'
import type { RetrievalMethod } from '../src/sourceRegistry.ts'

test('candidate registry has unique IDs, valid URLs and no fabricated reviews', () => {
  assert.equal(sources.length, 7)
  assert.equal(new Set(sources.map(source => source.id)).size, sources.length)
  for (const source of sources) {
    assert.equal(getSourceById(source.id), source)
    assert.equal(isValidSourceUrl(source.websiteUrl), true)
    assert.equal(source.automatedAccessStatus, 'not_reviewed')
    assert.equal(source.lastReviewedAt, null)
    assert.deepEqual(source.permittedRetrievalMethods, ['manual_review'])
    assert.ok(source.categories.length)
  }
  assert.equal(getSourceById('missing'), undefined)
  assert.equal(getSourceById('toString'), undefined)
})

test('URL checks reject malformed and ambiguous URLs without network access', () => {
  for (const value of [null, '', '/relative', 'https:example.com', 'http://example.com',
    'file:///tmp/a', 'javascript:alert(1)', ' https://example.com',
    'https://user:password@example.com', 'https://example.com/#fragment',
    'https://example.com:8443', 'https://exa mple.com', 'https://example.com\\evil',
    'https://example.com/\npath']) {
    assert.equal(isValidSourceUrl(value), false, String(value))
  }
  assert.equal(isValidSourceUrl('https://example.com/path?q=value'), true)
  assert.equal(isSourceUrl('swayam', 'https://swayam.gov.in/course'), true)
  for (const url of ['https://swayam.gov.in.evil.com/', 'https://evil.com/swayam.gov.in',
    'https://sub.swayam.gov.in/', 'https://swayam.gov.in@evil.com/']) {
    assert.equal(isSourceUrl('swayam', url), false)
  }
  assert.equal(isSourceUrl('missing', 'https://swayam.gov.in/'), false)
})

test('every retrieval method fails closed for all candidates and unknown IDs', () => {
  const methods: RetrievalMethod[] = ['manual_review', 'api', 'feed', 'web_fetch', 'browser_automation']
  for (const id of [...sources.map(source => source.id), 'missing']) {
    for (const method of methods) assert.equal(isAutomatedRetrievalPermitted(id, method), false)
  }
})

test('source provenance never implies claim verification', () => {
  for (const source of sources) {
    assert.deepEqual(getSourceTrust(source.id), {
      sourceId: source.id, sourceType: source.sourceType,
      requiresClaimVerification: true, verifiesIndividualClaims: false,
    })
  }
  assert.equal(getSourceTrust('missing'), undefined)
})

test('callers cannot mutate registry access policies or nested arrays', () => {
  assert.throws(() => { Object.assign(getSourceById('swayam')!, { automatedAccessStatus: 'approved' }) }, TypeError)
  assert.throws(() => { (sources as unknown[]).push({}) }, TypeError)
  assert.throws(() => { (sources[0].permittedRetrievalMethods as string[]).push('web_fetch') }, TypeError)
  assert.throws(() => { (sources[0].categories as string[]).push('software_perk') }, TypeError)
  assert.equal(isAutomatedRetrievalPermitted('swayam', 'web_fetch'), false)
})
