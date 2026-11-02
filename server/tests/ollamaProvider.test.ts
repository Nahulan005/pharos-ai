import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OllamaProvider } from '../src/ollamaProvider.ts'
import type { OllamaFetch } from '../src/ollamaProvider.ts'
import { generateWithProvider } from '../src/aiProvider.ts'
import type { GenerationRequest, GenerationResult } from '../src/aiProvider.ts'
import { generateGroundedAnswer } from '../src/groundedAnswer.ts'
import { readAndOrganize } from '../src/readAndOrganize.ts'
import { EvidenceAssessmentService } from '../src/evidenceAssessment.ts'

// ALL HTTP is injected and in-memory. No global fetch, sockets, Ollama or model installation.
const content = JSON.stringify({ answer: 'Check the issuing organisation requirements.', citationIds: [], uncertainties: [] })
const envelope = () => ({ model: 'qwen3:1.7b', done: true, done_reason: 'stop',
  message: { role: 'assistant', content } })
function response(value: unknown = envelope(), status = 200, headers: HeadersInit = { 'content-type': 'application/json' }) {
  return new Response(JSON.stringify(value), { status, headers })
}
function request(patch: Partial<GenerationRequest> = {}): GenerationRequest {
  return { messages: [{ role: 'system', content: 'Return JSON only.' }, { role: 'user', content: 'Test question.' }],
    responseFormat: 'json', timeoutMs: 500, signal: new AbortController().signal, ...patch }
}
function error(result: GenerationResult, code: string) {
  assert.ok(!result.ok)
  assert.equal(result.error.code, code)
  assert.doesNotMatch(result.error.message, /secret|private\/|reasoning trace|token-value/)
}
function mock(fetcher: OllamaFetch = async () => response()) { return new OllamaProvider({ fetch: fetcher }) }

test('Ollama adapter maps provider requests to one bounded non-streaming JSON chat request', async () => {
  let calls = 0
  let seen!: RequestInit
  const input = request()
  const before = structuredClone(input.messages)
  const result = await mock(async (url, init) => {
    calls++; seen = init
    assert.equal(url, 'http://127.0.0.1:11434/api/chat')
    assert.equal(init.method, 'POST')
    assert.equal(init.redirect, 'error')
    assert.equal(init.credentials, 'omit')
    const body = JSON.parse(String(init.body))
    assert.deepEqual(body, { model: 'qwen3:1.7b', messages: before, stream: false,
      format: 'json', think: false, options: { temperature: 0, num_predict: 2048 } })
    assert.equal('tools' in body, false)
    return response()
  }).generate(input)
  assert.equal(calls, 1)
  assert.deepEqual(result, { ok: true, value: { providerId: 'ollama', modelId: 'qwen3:1.7b', content, finishReason: 'completed' } })
  assert.deepEqual(input.messages, before)
  assert.equal((seen.signal as AbortSignal).aborted, true)
})

test('explicit model, local endpoint and token budget can change without changing the research pipeline', async () => {
  const provider = new OllamaProvider({ baseUrl: 'http://localhost:12345', modelId: 'test-model:small', maxOutputTokens: 500,
    fetch: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:12345/api/chat')
      assert.equal(JSON.parse(String(init.body)).model, 'test-model:small')
      assert.equal(JSON.parse(String(init.body)).options.num_predict, 500)
      return response({ ...envelope(), model: 'test-model:small' })
    } })
  const result = await generateWithProvider(provider, request().messages)
  assert.ok(result.ok)
  assert.equal(result.value.modelId, 'test-model:small')
})

test('construction needs an explicit HTTP dependency and performs no requests', () => {
  let calls = 0
  new OllamaProvider({ fetch: async () => { calls++; return response() } })
  assert.equal(calls, 0)
  assert.throws(() => new OllamaProvider({} as never), TypeError)
  for (const baseUrl of ['https://example.com', 'http://192.168.1.1', 'file:///tmp/model',
    'http://127.0.0.1:11434/private', 'http://user:secret@localhost:11434',
    'http://localhost:11434?token=secret', 'http://localhost:11434/#x', ' http://localhost:11434']) {
    assert.throws(() => new OllamaProvider({ baseUrl, fetch: async () => response() }), RangeError)
  }
  for (const modelId of ['', 'bad model', 'https://evil.example/model']) {
    assert.throws(() => new OllamaProvider({ modelId, fetch: async () => response() }), RangeError)
  }
  for (const maxResponseBytes of [0, -1, Infinity, 1.5, 1048577]) {
    assert.throws(() => new OllamaProvider({ maxResponseBytes, fetch: async () => response() }), RangeError)
  }
  for (const maxOutputTokens of [0, -1, Infinity, 8193]) {
    assert.throws(() => new OllamaProvider({ maxOutputTokens, fetch: async () => response() }), RangeError)
  }
})

test('invalid requests and pre-cancellation never call the HTTP dependency', async () => {
  let calls = 0
  const provider = mock(async () => { calls++; return response() })
  for (const timeoutMs of [0, -1, Infinity, NaN, 300001]) error(await provider.generate(request({ timeoutMs })), 'INVALID_REQUEST')
  error(await provider.generate(request({ messages: [] })), 'INVALID_REQUEST')
  error(await provider.generate(request({ responseFormat: 'text' } as never)), 'INVALID_REQUEST')
  error(await provider.generate(request({ messages: [{ role: 'system', content: 'x' },
    { role: 'user', content: 'x'.repeat(1048577) }] })), 'INVALID_REQUEST')
  const controller = new AbortController()
  controller.abort()
  error(await provider.generate(request({ signal: controller.signal })), 'CANCELLED')
  assert.equal(calls, 0)
})

test('reasoning is discarded and never promoted to final answer', async () => {
  const result = await mock(async () => response({ ...envelope(), message: {
    ...envelope().message, thinking: 'private reasoning trace token-value',
  } })).generate(request())
  assert.ok(result.ok)
  assert.equal(result.value.content, content)
  assert.doesNotMatch(JSON.stringify(result), /reasoning trace|token-value/)
  for (const reply of ['', '<think>private reasoning trace</think>' + content, '```json\n{}\n```']) {
    error(await mock(async () => response({ ...envelope(), message: {
      ...envelope().message, content: reply, thinking: 'private reasoning trace',
    } })).generate(request()), 'INVALID_RESPONSE')
  }
})

test('incomplete, mismatched, malformed and tool-call envelopes are rejected', async () => {
  for (const value of [null, [], {}, { ...envelope(), done: false }, { ...envelope(), model: 'wrong-model' },
    { ...envelope(), done_reason: 'unknown' }, { ...envelope(), message: { role: 'user', content } },
    { ...envelope(), message: { role: 'assistant', content: 42 } },
    { ...envelope(), message: { ...envelope().message, tool_calls: [{ function: 'execute' }] } },
    { ...envelope(), message: { ...envelope().message, content: 'plain text, not JSON' } }]) {
    error(await mock(async () => response(value)).generate(request()), 'INVALID_RESPONSE')
  }
})

test('token-limit completion is normalized but never accepted by the provider wrapper', async () => {
  const provider = mock(async () => response({ ...envelope(), done_reason: 'length',
    message: { role: 'assistant', content: '{"answer":"cut off' } }))
  const result = await provider.generate(request())
  assert.ok(result.ok)
  assert.equal(result.value.finishReason, 'length')
  error(await generateWithProvider(provider, request().messages), 'INVALID_RESPONSE')
})

test('missing model, overload and unavailable service statuses are sanitized without retries', async () => {
  for (const status of [404, 429, 502, 503, 504]) {
    let calls = 0
    const result = await mock(async () => { calls++; return response({ error: 'secret private/path' }, status) }).generate(request())
    error(result, 'UNAVAILABLE')
    assert.equal(calls, 1)
  }
  for (const status of [400, 401, 403, 500]) {
    error(await mock(async () => response({ error: 'secret token-value' }, status)).generate(request()), 'PROVIDER_ERROR')
  }
  error(await mock(async () => response({ error: 'private/path token-value' })).generate(request()), 'PROVIDER_ERROR')
})

test('connection refusal, network and stream errors expose no internal details', async () => {
  error(await mock(async () => { throw new Error('ECONNREFUSED secret private/path') }).generate(request()), 'UNAVAILABLE')
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('secret token-value')) } })
  error(await mock(async () => new Response(body, { headers: { 'content-type': 'application/json' } })).generate(request()), 'UNAVAILABLE')
})

test('redirects and final URL changes are rejected', async () => {
  error(await mock(async () => response({}, 302, { location: 'https://evil.example' })).generate(request()), 'INVALID_RESPONSE')
  for (const patch of [{ redirected: true }, { url: 'https://evil.example/' }]) {
    const redirected = response()
    for (const [key, value] of Object.entries(patch)) Object.defineProperty(redirected, key, { value })
    error(await mock(async () => redirected).generate(request()), 'INVALID_RESPONSE')
  }
})

test('HTML, NDJSON, compressed, empty and malformed response bodies fail closed', async () => {
  for (const headers of [{}, { 'content-type': 'text/html' }, { 'content-type': 'application/x-ndjson' },
    { 'content-type': 'application/json', 'content-encoding': 'gzip' }] as Record<string, string>[]) {
    error(await mock(async () => response(envelope(), 200, headers)).generate(request()), 'INVALID_RESPONSE')
  }
  for (const body of ['', '{bad', JSON.stringify(envelope()) + '\n' + JSON.stringify(envelope())]) {
    error(await mock(async () => new Response(body, { headers: { 'content-type': 'application/json' } })).generate(request()), 'INVALID_RESPONSE')
  }
  error(await mock(async () => new Response(new Uint8Array([0xff]), {
    headers: { 'content-type': 'application/json' },
  })).generate(request()), 'INVALID_RESPONSE')
})

test('declared and actual response bytes are bounded and mismatched lengths rejected', async () => {
  const size = Buffer.byteLength(JSON.stringify(envelope()))
  const exact = new OllamaProvider({ maxResponseBytes: size, fetch: async () => response() })
  assert.ok((await exact.generate(request())).ok)
  error(await new OllamaProvider({ maxResponseBytes: size - 1, fetch: async () => response() }).generate(request()), 'INVALID_RESPONSE')
  for (const length of ['-1', 'invalid', '9999999999', '1']) {
    error(await mock(async () => response(envelope(), 200, {
      'content-type': 'application/json', 'content-length': length,
    })).generate(request()), 'INVALID_RESPONSE')
  }
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(Buffer.from('€€€€'))
  }, cancel() { cancelled = true } })
  error(await new OllamaProvider({ maxResponseBytes: 10, fetch: async () => new Response(stream, {
    headers: { 'content-type': 'application/json' },
  }) }).generate(request()), 'INVALID_RESPONSE')
  assert.equal(cancelled, true)
})

test('timeout includes both stalled response headers and stalled body consumption', async () => {
  for (const stage of ['headers', 'body']) {
    let signal!: AbortSignal
    let bodyCancelled = false
    const provider = mock(async (_, init) => {
      signal = init.signal as AbortSignal
      if (stage === 'headers') return new Promise(() => {})
      return new Response(new ReadableStream({ cancel() { bodyCancelled = true } }), {
        headers: { 'content-type': 'application/json' },
      })
    })
    error(await provider.generate(request({ timeoutMs: 10 })), 'TIMEOUT')
    assert.equal(signal.aborted, true)
    if (stage === 'body') assert.equal(bodyCancelled, true)
  }
})

test('active cancellation propagates and suppresses late HTTP results', async () => {
  const controller = new AbortController()
  let signal!: AbortSignal
  let complete!: (value: Response) => void
  const provider = mock(async (_, init) => {
    signal = init.signal as AbortSignal
    queueMicrotask(() => controller.abort())
    return new Promise(resolve => { complete = resolve })
  })
  const result = await provider.generate(request({ signal: controller.signal }))
  error(result, 'CANCELLED')
  assert.equal(signal.aborted, true)
  let bodyCancelled = false
  complete(new Response(new ReadableStream({ cancel() { bodyCancelled = true } })))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(bodyCancelled, true)
  error(result, 'CANCELLED')
})

test('grounded pipeline keeps frontend response shape and synthetic findings ungrounded with mocked Ollama', async () => {
  const read = await readAndOrganize({ sourceId: 'swayam', method: 'fixture', fixtureId: 'course-v1' })
  assert.ok(read.ok)
  const assessment = new EvidenceAssessmentService({ maxObservationAgeMs: 86400000 }, () => '2026-11-02T12:00:00Z').assess(read.value)
  const result = await generateGroundedAnswer(mock(), { question: 'What should I check?', evidence: [
    { citationId: 'fixture-1', record: read.value, assessment },
  ], uncertainties: [], reviewWarnings: [] })
  assert.ok(result.ok)
  assert.deepEqual(Object.keys(result.response).sort(), ['answer', 'citations', 'grounded'])
  assert.equal(result.response.grounded, false)
  assert.match(result.response.answer, /SYNTHETIC_EVIDENCE/)
  assert.equal(result.audit.humanVerified, false)
  assert.equal(read.value.opportunity.verificationStatus, 'unreviewed')
})

test('Ollama output still passes through existing malformed-output and citation checks', async () => {
  for (const [reply, expected] of [
    [JSON.stringify({ answer: 'Test', citationIds: ['invented'], uncertainties: [] }), 'UNKNOWN_CITATION'],
    [JSON.stringify({ answer: 'Test', citationIds: [], uncertainties: [], grounded: true }), 'MALFORMED_OUTPUT'],
    [JSON.stringify({ answer: 'You are eligible.', citationIds: [], uncertainties: [] }), 'UNSUPPORTED_ASSURANCE'],
  ]) {
    const provider = mock(async () => response({ ...envelope(), message: { role: 'assistant', content: reply } }))
    const result = await generateGroundedAnswer(provider, { question: 'Test?', evidence: [], uncertainties: [], reviewWarnings: [] })
    assert.ok(!result.ok)
    assert.equal(result.error.code, expected)
  }
})
