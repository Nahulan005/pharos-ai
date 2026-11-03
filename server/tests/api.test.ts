import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { createApp } from '../src/app.ts'
import { createOpportunityStore } from '../src/opportunityStore.ts'
import type { OpportunityStore } from '../src/opportunityStore.ts'
import { validateOpportunities } from '../../shared/validateOpportunities.mjs'

const sampleText = await readFile(new URL('../../shared/opportunities.sample.json', import.meta.url), 'utf8')
const sample = JSON.parse(sampleText)

/** Tests exercise real HTTP requests on an ephemeral loopback port. */
async function withApi(run: (base: string) => Promise<void>, store?: OpportunityStore) {
  const server = createApp(store).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try { await run(base) }
  finally { await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() }) }
}

test('health returns JSON and does not depend on opportunity availability', async () => {
  await withApi(async base => {
    const response = await fetch(`${base}/api/health`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type')!, /application\/json/)
    assert.deepEqual(await response.json(), { status: 'ok' })
    assert.equal(response.headers.get('x-powered-by'), null)
  }, createOpportunityStore(async () => { throw new Error('private filesystem failure') }))
})
test('list and trailing slash return four researched candidates with exact official URLs and no verification claims', async () => {
  await withApi(async base => {
    for (const path of ['/api/opportunities', '/api/opportunities/']) {
      const response = await fetch(base + path)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), sample)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    assert.deepEqual(validateOpportunities(sample), [])
    assert.equal(sample.items.length, 4)
    assert.deepEqual(sample.items.map((item: { sourceUrl: string }) => item.sourceUrl), [
      'https://nptel.ac.in/courses/106102576',
      'https://nptel.ac.in/courses/106106182',
      'https://scholarships.gov.in/public/schemeGuidelines/CSSS_GUIDLINES_07022024_updated.pdf',
      'https://scholarships.gov.in/public/schemeGuidelines/DEPDGuidelines_1.pdf',
    ])
    for (const item of sample.items) {
      assert.equal(item.verificationStatus, 'unreviewed')
      assert.equal(item.sourceType, 'official')
      assert.equal(item.verifiedBy, null)
      assert.equal(item.lastVerifiedAt, null)
      if (item.id === 'nptel-joy-of-computing-using-python') {
        assert.equal(item.provider, 'NPTEL / IIT Ropar')
        assert.equal(item.cost, 'free_to_learn_paid_cert')
        assert.match(item.summary, /Archived course information/)
        assert.match(item.summary, /certification requires an optional paid examination/)
        assert.match(item.summary, /Current session terms and exam fees need review/)
        assert.match(item.summary, /current enrollment availability is unconfirmed/)
      } else {
        assert.equal(item.cost, 'unknown')
      }
      assert.equal(item.eligibilitySummary, 'unknown')
      assert.equal(item.deadline.type, 'unknown')
      assert.equal(item.deadline.date, null)
      assert.doesNotMatch(item.title, /\[DEMO\]|fictional/i)
      assert.ok(['course_cert', 'scholarship'].includes(item.category))
      if (item.category === 'course_cert') {
        assert.match(item.summary, /^Enrollment was previously reported closed/)
        assert.match(item.deadline.note, /previously reported closed/)
      } else {
        assert.match(item.deadline.note, /Fresh-application deadline is unknown/)
        assert.match(item.deadline.note, /Renewal deadlines must not be treated as fresh-application deadlines/)
      }
    }
  })
})
test('lookup returns each exact record', async () => {
  await withApi(async base => {
    for (const item of sample.items) {
      const response = await fetch(`${base}/api/opportunities/${item.id}`)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), item)
    }
  })
})
test('unknown ID returns a consistent 404', async () => {
  await withApi(async base => {
    const response = await fetch(`${base}/api/opportunities/not-a-real-id`)
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: { code: 'OPPORTUNITY_NOT_FOUND', message: 'Opportunity not found.' } })
  })
})
for (const [name, read] of [
  ['malformed JSON', async () => '{private-invalid-json'],
  ['invalid schema', async () => JSON.stringify({ ...sample, schemaVersion: 99 })],
  ['missing field', async () => { const data = structuredClone(sample); delete data.items[0].title; return JSON.stringify(data) }],
  ['false unreviewed verification', async () => { const data = structuredClone(sample); data.items[0].verifiedBy = 'not-allowed'; return JSON.stringify(data) }],
  ['read failure', async () => { throw new Error('secret/path/password') }],
] as const) {
  test(`${name}: list and lookup fail closed without exposing internals`, async () => {
    await withApi(async base => {
      for (const path of ['/api/opportunities', `/api/opportunities/${sample.items[0].id}`]) {
        const response = await fetch(base + path)
        assert.equal(response.status, 503)
        assert.deepEqual(await response.json(), { error: { code: 'OPPORTUNITY_DATA_UNAVAILABLE', message: 'Opportunity data is temporarily unavailable.' } })
      }
    }, createOpportunityStore(read))
  })
}
test('data is revalidated on subsequent requests', async () => {
  let current = sampleText
  await withApi(async base => {
    assert.equal((await fetch(`${base}/api/opportunities`)).status, 200)
    current = '{}'
    assert.equal((await fetch(`${base}/api/opportunities`)).status, 503)
  }, createOpportunityStore(async () => current))
})
test('unknown routes, unsupported methods and malformed paths produce JSON errors', async () => {
  await withApi(async base => {
    for (const response of [await fetch(`${base}/missing`), await fetch(`${base}/api/opportunities`, { method: 'POST' })]) {
      assert.equal(response.status, 404)
      assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } })
    }
    const response = await fetch(`${base}/api/opportunities/%E0%A4%A`)
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: { code: 'INVALID_REQUEST', message: 'Invalid request path.' } })
  })
})
test('unexpected failures return a sanitized 500', async () => {
  await withApi(async base => {
    const response = await fetch(`${base}/api/opportunities`)
    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' } })
  }, { getAll: async () => { throw new Error('secret-internal-detail') } })
})
