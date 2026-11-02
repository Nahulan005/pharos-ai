import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { createApp } from '../src/app.ts'
import { AskService } from '../src/askService.ts'
import type { AskServiceOptions } from '../src/askService.ts'
import { createConfiguredAskService } from '../src/askConfiguration.ts'
import { OpportunityOrganizer } from '../src/opportunityOrganizer.ts'
import type { SourceFinding } from '../src/sourceFinding.ts'
import { readAndOrganize } from '../src/readAndOrganize.ts'
import { OllamaProvider } from '../src/ollamaProvider.ts'
import type { AIProvider } from '../src/aiProvider.ts'

// In-memory course observations for tests only; not an approved live source or a real offer.
function testRecord() {
  const finding: SourceFinding = { findingId: 'ask-test-finding', sourceId: 'swayam',
    sourceUrl: 'https://swayam.gov.in/ask-test-only', retrievedAt: '2026-11-02T10:00:00Z',
    evidenceText: 'Structured unit-test observation only.', facts: {
      id: 'ask-test-course', category: 'course_cert', title: 'Endpoint test course only',
      provider: 'Test issuer', summary: 'Test summary', eligibilitySummary: 'Test issuer requirements', cost: 'free',
      applicability: { scope: 'national', states: [] }, deadline: { type: 'rolling', date: null, note: null },
    } }
  const result = new OpportunityOrganizer().organize(finding)
  assert.ok(result.ok)
  return result.value
}
function provider(content = JSON.stringify({ answer: 'Consult the recorded issuer requirements.', citationIds: ['evidence-1'], uncertainties: [] })): AIProvider {
  return { providerId: 'test', modelId: 'mock', async generate() {
    return { ok: true, value: { providerId: 'test', modelId: 'mock', content, finishReason: 'completed' } }
  } }
}
function service(options: Partial<AskServiceOptions> = {}) {
  return new AskService({ provider: provider(), freshnessPolicy: { maxObservationAgeMs: 86400000 },
    clock: () => '2026-11-02T12:00:00Z', timeoutMs: 1000,
    evidence: async () => ({ records: [testRecord()], uncertainties: [], reviewWarnings: [] }), ...options })
}
async function withApi(ask: AskService | undefined, run: (base: string) => Promise<void>) {
  const server = createApp(undefined, ask).listen(0, '127.0.0.1')
  await once(server, 'listening')
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`) }
  finally { await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections()
  }) }
}
const post = (base: string, body: unknown = { question: 'What can help me learn AI?' }) => fetch(`${base}/api/ask`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status)
  const body = await response.json()
  assert.deepEqual(Object.keys(body), ['error'])
  assert.equal(body.error.code, code)
  assert.equal(typeof body.error.message, 'string')
  assert.doesNotMatch(JSON.stringify(body), /secret|private-path|student-private|stack|ECONNREFUSED/)
}

test('POST ask returns exactly the established frontend shape with server-resolved citations', async () => {
  await withApi(service(), async base => {
    const response = await post(base)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json()
    assert.deepEqual(Object.keys(body).sort(), ['answer', 'citations', 'grounded'])
    assert.equal(body.grounded, true)
    assert.deepEqual(body.citations, [{ title: 'Endpoint test course only', url: 'https://swayam.gov.in/ask-test-only', recordId: 'ask-test-course' }])
    assert.match(body.answer, /Human verification has not been established/)
    assert.equal('audit' in body, false)
    assert.equal('providerId' in body, false)
  })
})

test('invalid questions and extra client-controlled fields fail before evidence or generation', async () => {
  let calls = 0
  await withApi(service({ evidence: async () => { calls++; throw new Error('must not load') } }), async base => {
    for (const body of [{}, null, [], 'student-private', { question: '' }, { question: '   ' },
      { question: 42 }, { question: {} }, { question: 'x'.repeat(4001) },
      { question: 'Test', evidence: [] }, { question: 'Test', provider: 'http://evil.example' },
      { question: 'Test', model: 'other' }, { question: 'Test', grounded: true }]) {
      await expectError(await post(base, body), 400, 'INVALID_REQUEST')
    }
    assert.equal(calls, 0)
  })
})

test('question whitespace is trimmed and the 4000-character boundary is accepted', async () => {
  let seen = ''
  await withApi(service({ evidence: async question => {
    seen = question; return { records: [], uncertainties: [], reviewWarnings: [] }
  } }), async base => {
    assert.equal((await post(base, { question: '  hello  ' })).status, 200)
    assert.equal(seen, 'hello')
    assert.equal((await post(base, { question: 'x'.repeat(4000) })).status, 200)
    assert.equal(seen.length, 4000)
  })
})

test('malformed JSON, unsupported media, compression and oversized bodies have sanitized errors', async () => {
  await withApi(service(), async base => {
    const send = (body: string, headers: Record<string, string>) => fetch(`${base}/api/ask`, { method: 'POST', body, headers })
    await expectError(await send('{"question":"student-private",', { 'Content-Type': 'application/json' }), 400, 'INVALID_REQUEST')
    await expectError(await send('', { 'Content-Type': 'application/json' }), 400, 'INVALID_REQUEST')
    await expectError(await send('student-private', { 'Content-Type': 'text/plain' }), 415, 'UNSUPPORTED_MEDIA_TYPE')
    await expectError(await send('{}', { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }), 415, 'UNSUPPORTED_MEDIA_TYPE')
    await expectError(await send(JSON.stringify({ question: 'x'.repeat(33000) }), { 'Content-Type': 'application/json' }), 413, 'REQUEST_TOO_LARGE')
  })
})

test('default app fails gracefully without a configured provider and never requires Ollama', async () => {
  await withApi(undefined, async base => {
    await expectError(await post(base), 503, 'AI_UNAVAILABLE')
    assert.equal((await fetch(`${base}/api/health`)).status, 200)
    assert.equal((await fetch(`${base}/api/opportunities`)).status, 200)
  })
})

test('absent evidence returns an honest limitation with no fictional records or generation', async () => {
  let modelCalls = 0
  await withApi(service({ provider: { ...provider(), async generate() { modelCalls++; throw new Error('must not generate') } },
    evidence: async () => ({ records: [], uncertainties: [], reviewWarnings: [] }) }), async base => {
    const result = await (await post(base)).json()
    assert.equal(result.grounded, false)
    assert.deepEqual(result.citations, [])
    assert.match(result.answer, /cannot confirm current deadlines, eligibility, costs or financial benefits/)
    assert.match(result.answer, /not a model-generated opportunity recommendation/)
    assert.doesNotMatch(result.answer, /Fictional Student Scholarship|demo-scholarship/)
    assert.equal(modelCalls, 0)
  })
})

test('synthetic fixture content never masquerades as an opportunity in an ask response', async () => {
  const read = await readAndOrganize({ sourceId: 'swayam', method: 'fixture', fixtureId: 'course-v1' })
  assert.ok(read.ok)
  await withApi(service({ provider: { ...provider(), async generate() { throw new Error('must not generate') } },
    evidence: async () => ({ records: [read.value], uncertainties: [], reviewWarnings: [] }) }), async base => {
    const response = await post(base)
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.grounded, false)
    assert.deepEqual(result.citations, [])
    assert.match(result.answer, /SYNTHETIC_EVIDENCE/)
    assert.doesNotMatch(result.answer, /PHAROS fixture only|pharos-fixture-only/)
  })
})

test('stale or conflicting evidence requires review instead of asking a model to choose claims', async () => {
  for (const kind of ['stale', 'conflict']) {
    const first = testRecord(), second = testRecord()
    if (kind === 'stale') first.evidence.retrievedAt = first.evidence.originalFinding.retrievedAt = '2026-09-01T00:00:00Z'
    else {
      second.evidence.findingId = second.evidence.originalFinding.findingId = 'second'
      second.opportunity.cost = second.evidence.originalFinding.facts.cost = 'paid'
    }
    await withApi(service({ provider: { ...provider(), async generate() { throw new Error('must not generate') } },
      evidence: async () => ({ records: kind === 'stale' ? [first] : [first, second], uncertainties: [], reviewWarnings: [] }) }), async base => {
      const response = await post(base)
      assert.equal(response.status, 200)
      const result = await response.json()
      assert.equal(result.grounded, false)
      assert.match(result.answer, kind === 'stale' ? /STALE_OBSERVATION/ : /STRUCTURED_CONFLICT/)
    })
  }
})

test('unsupported citations, fabricated verification and malformed model outputs are rejected', async () => {
  for (const content of ['bad-json', JSON.stringify({ answer: 'Test', citationIds: ['invented'], uncertainties: [] }),
    JSON.stringify({ answer: 'You are eligible.', citationIds: ['evidence-1'], uncertainties: [] }),
    JSON.stringify({ answer: 'Test', citationIds: ['evidence-1'], uncertainties: [], grounded: true })]) {
    await withApi(service({ provider: provider(content) }), async base => {
      await expectError(await post(base), 502, 'AI_INVALID_RESPONSE')
    })
  }
})

test('provider unavailable and unexpected failures are errors, never successful placeholder answers', async () => {
  for (const [injected, status, code] of [
    [{ ...provider(), async generate() { return { ok: false as const, error: { code: 'UNAVAILABLE' as const, message: 'secret private-path' } } } }, 503, 'AI_UNAVAILABLE'],
    [{ ...provider(), async generate() { throw new Error('secret private-path') } }, 502, 'AI_GENERATION_FAILED'],
  ] as const) {
    await withApi(service({ provider: injected }), async base => { await expectError(await post(base), status, code) })
  }
})

test('unavailable Ollama uses injected HTTP only', async () => {
  let calls = 0
  const ollama = new OllamaProvider({ fetch: async () => { calls++; throw new Error('ECONNREFUSED secret') } })
  await withApi(service({ provider: ollama }), async base => { await expectError(await post(base), 503, 'AI_UNAVAILABLE') })
  assert.equal(calls, 1)
})

test('evidence and provider timeouts are bounded and abort their dependencies', async () => {
  for (const stage of ['evidence', 'provider']) {
    let signal: AbortSignal | undefined
    const ask = stage === 'evidence'
      ? service({ timeoutMs: 20, evidence: async (_question, value) => { signal = value; return new Promise(() => {}) } })
      : service({ timeoutMs: 20, provider: { ...provider(), async generate(input) { signal = input.signal; return new Promise(() => {}) } } })
    await withApi(ask, async base => { await expectError(await post(base), 504, 'AI_TIMEOUT') })
    assert.equal(signal?.aborted, true)
  }
})

test('evidence failures and invalid server records return sanitized errors', async () => {
  for (const evidence of [async () => { throw new Error('private-path student-private') },
    async () => ({ records: [{}] as never[], uncertainties: [], reviewWarnings: [] })]) {
    await withApi(service({ evidence }), async base => {
      const response = await post(base)
      await expectError(response, 503, 'EVIDENCE_UNAVAILABLE')
    })
  }
})

test('client disconnect cancels generation', async () => {
  let began!: () => void
  const started = new Promise<void>(resolve => { began = resolve })
  let aborted!: () => void
  const finished = new Promise<void>(resolve => { aborted = resolve })
  const ask = service({ provider: { ...provider(), async generate(input) {
    input.signal.addEventListener('abort', aborted, { once: true }); began(); return new Promise(() => {})
  } } })
  await withApi(ask, async base => {
    const controller = new AbortController()
    const pending = fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Test' }), signal: controller.signal })
    await started
    controller.abort()
    await assert.rejects(pending)
    await finished
  })
})

test('service retains audit warnings internally and releases concurrency slots after cancellation', async () => {
  const limited = service({ evidence: async () => ({ records: [], uncertainties: ['Eligibility is unknown.'], reviewWarnings: ['Review is required.'] }) })
  const result = await limited.ask('Test')
  assert.ok(result.ok)
  assert.deepEqual(result.audit.uncertainties, ['Eligibility is unknown.'])
  assert.ok(result.audit.reviewWarnings.includes('Review is required.'))
  const controller = new AbortController()
  let began!: () => void
  const started = new Promise<void>(resolve => { began = resolve })
  let loads = 0
  const busy = service({ maxConcurrent: 1, evidence: async () => {
    loads++
    if (loads === 1) { began(); return new Promise(() => {}) }
    return { records: [], uncertainties: [], reviewWarnings: [] }
  } })
  const first = busy.ask('First', controller.signal)
  await started
  const second = await busy.ask('Second')
  assert.ok(!second.ok)
  assert.equal(second.status, 429)
  controller.abort()
  const cancelled = await first
  assert.ok(!cancelled.ok)
  assert.equal(cancelled.error.code, 'AI_CANCELLED')
  const preCancelled = await busy.ask('Third', controller.signal)
  assert.ok(!preCancelled.ok)
  assert.equal(preCancelled.error.code, 'AI_CANCELLED')
  assert.equal((await busy.ask('After cancellation')).ok, true)
})

test('provider configuration is server-only, disabled by default, and never probes Ollama on startup', async () => {
  let calls = 0
  const fetcher = async () => { calls++; throw new Error('must not call HTTP without evidence') }
  const disabled = createConfiguredAskService({}, fetcher)
  const result = await disabled.ask('Test')
  assert.ok(!result.ok)
  assert.equal(result.status, 503)
  const configured = createConfiguredAskService({ PHAROS_AI_PROVIDER: 'ollama' }, fetcher)
  const limited = await configured.ask('Test')
  assert.ok(limited.ok)
  assert.equal(limited.response.grounded, false)
  assert.equal(calls, 0)
  for (const env of [{ PHAROS_AI_PROVIDER: 'unknown' }, { PHAROS_ASK_TIMEOUT_MS: '0' },
    { PHAROS_ASK_TIMEOUT_MS: 'Infinity' }, { PHAROS_ASK_MAX_CONCURRENT: '0' },
    { PHAROS_EVIDENCE_MAX_AGE_MS: '-1' }, { PHAROS_AI_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'http://evil.example' }]) {
    assert.throws(() => createConfiguredAskService(env, fetcher))
  }
})

test('unsupported ask methods and model-management routes stay absent; existing routes work', async () => {
  await withApi(service(), async base => {
    for (const path of ['/api/ask', '/api/chat', '/api/pull']) assert.equal((await fetch(base + path)).status, 404)
    assert.equal((await fetch(`${base}/api/health`)).status, 200)
    assert.equal((await fetch(`${base}/api/opportunities`)).status, 200)
    assert.equal((await fetch(`${base}/api/opportunities/demo-scholarship`)).status, 200)
  })
})
