import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { createApp } from '../src/app.ts'
import { createOpportunityStore } from '../src/opportunityStore.ts'
import { explainOpportunity } from '../src/opportunityExplanation.ts'
import { providerFailure } from '../src/aiProvider.ts'
import type { AIProvider, GenerationRequest } from '../src/aiProvider.ts'

const profile = { careerInterests: ['general'], skills: ['Python'], weeklyLearningHours: 5 }
const id = 'nptel-joy-of-computing-using-python'
function provider(content: string, inspect?: (request: GenerationRequest) => void): AIProvider {
  return { providerId: 'test', modelId: 'test', async generate(request) {
    inspect?.(request)
    return { ok: true, value: { providerId: 'test', modelId: 'test', content, finishReason: 'completed' } }
  } }
}
async function api(model: AIProvider, run: (post: (body: unknown, recordId?: string) => Promise<Response>) => Promise<void>) {
  const server = createApp(undefined, undefined, model).listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    await run((body, recordId = id) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/opportunities/${recordId}/explanation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}

test('detail explanation loads only the selected stored record and uses bounded profile matches', async () => {
  let calls = 0
  await api(provider('{"reasonIds":["topic_general","skill_1","time"]}', request => {
    calls++
    const data = JSON.parse(request.messages[1].content)
    assert.equal(data.opportunity.id, id)
    assert.deepEqual(data.profile, profile)
    assert.equal(data.opportunity.verificationStatus, 'unreviewed')
    assert.doesNotMatch(request.messages[1].content, /106102576|scholarships.gov.in/)
  }), async post => {
    const response = await post({ profile })
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.deepEqual(Object.keys(data).sort(), ['answer', 'citations', 'grounded'])
    assert.equal(data.grounded, false); assert.deepEqual(data.citations, [])
    assert.match(data.answer, /AI-selected/)
    assert.match(data.answer, /Unreviewed/)
    assert.match(data.answer, /saved skills matches/)
    assert.match(data.answer, /5 learning hours/)
    assert.match(data.answer, /does not confirm eligibility, availability, fees or deadlines/)
  })
  assert.equal(calls, 1)
})

test('unsupported claims, fabricated IDs and malformed output never become displayed prose', async () => {
  for (const content of ['not json', 'null', '{"reasonIds":["you are eligible; enrollment open; fee 100"]}',
    '{"reasonIds":[1,2,3,4,5,6,7,8]}',
    '{"reasonIds":[]}', '{"reasonIds":["time","time"]}',
    '{"reasonIds":["time"],"answer":"Guaranteed admission, deadline tomorrow"}']) {
    await api(provider(content), async post => {
      const data = await (await post({ profile })).json()
      assert.match(data.answer, /Deterministic explanation/)
      assert.doesNotMatch(data.answer, /Guaranteed admission|fee 100|deadline tomorrow|you are eligible/)
      assert.equal(data.grounded, false); assert.deepEqual(data.citations, [])
    })
  }
})

test('invalid bodies and missing IDs fail before inference', async () => {
  await api(provider('{}', () => assert.fail('must not call model')), async post => {
    for (const body of [null, {}, [], { profile: null }, { profile: {} }, { profile, opportunity: {} },
      { profile: { ...profile, skills: ['x'.repeat(81)] } }, { profile: { ...profile, careerInterests: ['fake'] } },
      { profile: { ...profile, weeklyLearningHours: -1 } }, { profile: { ...profile, state: 'Tamil Nadu' } }]) {
      assert.equal((await post(body)).status, 400)
    }
    assert.equal((await post({ profile }, 'not-found')).status, 404)
  })
})

test('offline Ollama returns a useful explicitly deterministic explanation', async () => {
  await api({ providerId: 'offline', modelId: 'offline', async generate() { return providerFailure('UNAVAILABLE') } }, async post => {
    const response = await post({ profile })
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.match(data.answer, /Deterministic explanation: AI is unavailable/)
    assert.match(data.answer, /Next checks:/)
    assert.equal(data.grounded, false)
  })
})

test('missing preferences do not imply a match, and timeout/cancellation preserve safe fallback', async () => {
  const item = (await createOpportunityStore().getAll()).items.find(item => item.id === id)!
  const empty = { careerInterests: [], skills: [], weeklyLearningHours: null }
  const result = await explainOpportunity(provider('{"reasonIds":["explore"]}'), item, empty)
  assert.match(result.answer, /do not establish a direct match/)
  const controller = new AbortController(); controller.abort()
  const cancelled = await explainOpportunity(provider('{}', () => assert.fail()), item, empty, { signal: controller.signal })
  assert.match(cancelled.answer, /Deterministic/)
  const stalled: AIProvider = { providerId: 'stall', modelId: 'stall', generate: () => new Promise(() => {}) }
  const timed = await explainOpportunity(stalled, item, empty, { timeoutMs: 5 })
  assert.match(timed.answer, /Deterministic/)
})

test('selection prompt enumerates actual string IDs with a valid bounded example', async () => {
  const item = (await createOpportunityStore().getAll()).items.find(item => item.id === id)!
  const result = await explainOpportunity(provider('{"reasonIds":["explore"]}', request => {
    const system = request.messages[0].content
    assert.match(system, /1 to 1 distinct STRING IDs/)
    assert.ok(system.includes('allowed list: ["explore"]'))
    assert.ok(system.includes('Valid response example: {"reasonIds":["explore"]}'))
    assert.match(system, /do not return numbers/)
  }), item, { careerInterests: [], skills: [], weeklyLearningHours: null })
  assert.match(result.answer, /AI-selected/)
})

test('diagnostics distinguish provider and selection failures without logging profile or model content', async t => {
  const warn = t.mock.method(console, 'warn', () => {})
  const item = (await createOpportunityStore().getAll()).items.find(item => item.id === id)!
  const privateProfile = { careerInterests: [], skills: ['PRIVATE_PROFILE_SENTINEL'], weeklyLearningHours: null }
  for (const code of ['UNAVAILABLE', 'TIMEOUT', 'INVALID_RESPONSE'] as const) {
    await explainOpportunity({ providerId: 'test', modelId: 'test', async generate() { return providerFailure(code) } }, item, privateProfile)
  }
  await explainOpportunity(provider('{"reasonIds":[1,2,3,4,5,6,7,8],"private":"PRIVATE_MODEL_SENTINEL"}'), item, privateProfile)
  await explainOpportunity(provider('not JSON PRIVATE_MODEL_SENTINEL'), item, privateProfile)
  assert.deepEqual(warn.mock.calls.map(call => call.arguments), [
    ['[PHAROS explanation] PROVIDER_FAILURE', 'UNAVAILABLE'],
    ['[PHAROS explanation] PROVIDER_FAILURE', 'TIMEOUT'],
    ['[PHAROS explanation] PROVIDER_FAILURE', 'INVALID_RESPONSE'],
    ['[PHAROS explanation] VALIDATION_FAILURE'],
    ['[PHAROS explanation] INVALID_JSON'],
  ])
})
