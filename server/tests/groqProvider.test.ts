import assert from 'node:assert/strict'
import { test, beforeEach, afterEach } from 'node:test'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { GroqProvider } from '../src/groqProvider.ts'
import { generateWithProvider } from '../src/aiProvider.ts'
import type { GenerationResult } from '../src/aiProvider.ts'
import { createApp } from '../src/app.ts'
import { createOpportunityStore } from '../src/opportunityStore.ts'
import { explainOpportunity } from '../src/opportunityExplanation.ts'
import { createLimitedAnswerEngine, UNAVAILABLE_INFORMATION } from '../src/limitedAnswerEngine.ts'

const key = 'gsk-test-only-secret'
const model = 'llama-3.1-8b-instant'
const messages = [{ role: 'system' as const, content: 'Return JSON.' }, { role: 'user' as const, content: 'Practice advice.' }]
const envNames = ['GROQ_API_KEY', 'GROQ_MODEL', 'OLLAMA_MODEL', 'OLLAMA_BASE_URL', 'GEMINI_API_KEY'] as const
let saved: (string | undefined)[]
beforeEach(() => {
  saved = envNames.map(name => process.env[name])
  process.env.GROQ_API_KEY = key
  delete process.env.GROQ_MODEL
  delete process.env.OLLAMA_MODEL
  delete process.env.OLLAMA_BASE_URL
  delete process.env.GEMINI_API_KEY
})
afterEach(() => envNames.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i] }))
const payload = (content = '{"answer":"Practice regularly."}', modelId = model) => ({ model: modelId,
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content, reasoning: 'private-reasoning' } }] })
const json = (data: unknown = payload()) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
const adapter = (fetcher: typeof fetch) => new GroqProvider({ fetch: fetcher })
function failure(result: GenerationResult, code: string) {
  assert.ok(!result.ok); assert.equal(result.error.code, code)
  assert.doesNotMatch(JSON.stringify(result), /gsk-|secret|private-reasoning/)
}

test('Groq sends authenticated JSON chat to fixed HTTPS endpoint and exposes only validated content', async () => {
  const provider = adapter(async (url, init) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions')
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error')
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${key}`)
    assert.ok(init?.signal instanceof AbortSignal)
    assert.deepEqual(JSON.parse(String(init?.body)), { model, messages, stream: false,
      response_format: { type: 'json_object' }, temperature: 0, max_completion_tokens: 768 })
    assert.ok(!String(init?.body).includes(key))
    return json()
  })
  const result = await generateWithProvider(provider, messages)
  assert.deepEqual(result, { ok: true, value: { providerId: 'groq', modelId: model,
    content: '{"answer":"Practice regularly."}', finishReason: 'completed' } })
  assert.ok(!JSON.stringify(provider).includes(key))
})

test('model environment overrides default; missing or malformed credentials/config fail before fetch', async () => {
  process.env.GROQ_MODEL = 'llama-3.3-70b-versatile'
  const configured = adapter(async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).model, process.env.GROQ_MODEL)
    return json(payload(undefined, process.env.GROQ_MODEL))
  })
  assert.ok((await generateWithProvider(configured, messages)).ok)
  for (const value of ['', ' ', 'secret\nheader']) {
    process.env.GROQ_API_KEY = value
    failure(await generateWithProvider(adapter(async () => { assert.fail('no request'); }), messages), 'UNAVAILABLE')
  }
  delete process.env.GROQ_API_KEY
  failure(await generateWithProvider(adapter(async () => { assert.fail('no request'); }), messages), 'UNAVAILABLE')
  process.env.GROQ_API_KEY = key; process.env.GROQ_MODEL = 'invalid model'
  failure(await generateWithProvider(adapter(async () => { assert.fail('no request'); }), messages), 'UNAVAILABLE')
})

test('transport, auth, rate limit and model errors are sanitized without logging secrets', async t => {
  const warn = t.mock.method(console, 'warn', () => {})
  const log = t.mock.method(console, 'log', () => {})
  const error = t.mock.method(console, 'error', () => {})
  failure(await generateWithProvider(adapter(async () => { throw new Error(key) }), messages), 'UNAVAILABLE')
  for (const [status, code] of [[401, 'PROVIDER_ERROR'], [403, 'PROVIDER_ERROR'], [404, 'PROVIDER_ERROR'],
    [429, 'UNAVAILABLE'], [500, 'UNAVAILABLE'], [503, 'UNAVAILABLE']] as const) {
    failure(await generateWithProvider(adapter(async () => new Response(key, { status })), messages), code)
  }
  failure(await generateWithProvider(adapter(async () => json({ error: { message: key } })), messages), 'PROVIDER_ERROR')
  assert.deepEqual(warn.mock.calls.map(call => call.arguments),
    [401, 403, 404, 429, 500, 503].map(status => ['[PHAROS Groq] HTTP_FAILURE', status]))
  assert.equal(log.mock.callCount() + error.mock.callCount(), 0)
})

test('malformed envelopes, truncation, tool calls, refusals and invalid JSON fail closed', async () => {
  const invalid: unknown[] = [null, [], {}, { ...payload(), model: 'wrong' }, { ...payload(), choices: [] },
    { ...payload(), choices: [...payload().choices, ...payload().choices] }]
  for (const finish_reason of ['length', 'tool_calls', null]) invalid.push({ model, choices: [{ ...payload().choices[0], finish_reason }] })
  for (const patch of [{ role: 'user' }, { tool_calls: [] }, { function_call: {} }, { refusal: 'no' },
    ...['', ' ', 'not-json', 'null', '[]', '<think>secret</think>{}', '{"answer":"<think>secret</think>"}'].map(content => ({ content }))]) {
    invalid.push({ model, choices: [{ finish_reason: 'stop', message: { ...payload().choices[0].message, ...patch } }] })
  }
  for (const data of invalid) failure(await generateWithProvider(adapter(async () => json(data)), messages), 'INVALID_RESPONSE')
  failure(await generateWithProvider(adapter(async () => new Response('{secret', { headers: { 'Content-Type': 'application/json' } })), messages), 'INVALID_RESPONSE')
  failure(await generateWithProvider(adapter(async () => new Response('secret')), messages), 'INVALID_RESPONSE')
  failure(await generateWithProvider(adapter(async () => json({ ...payload(), padding: 'x'.repeat(300_000) })), messages), 'INVALID_RESPONSE')
})

test('direct adapter timeout includes stalled headers and body and aborts transport', async () => {
  for (const stage of ['headers', 'body']) {
    let signal: AbortSignal | null | undefined
    const provider = adapter(async (_url, init) => {
      signal = init?.signal
      if (stage === 'headers') return new Promise(() => {})
      return new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { headers: { 'Content-Type': 'application/json' } })
    })
    failure(await provider.generate({ messages, responseFormat: 'json', timeoutMs: 10, signal: new AbortController().signal }), 'TIMEOUT')
    assert.equal(signal?.aborted, true)
  }
})

test('pre-cancellation prevents fetch and active cancellation ignores late responses', async () => {
  const pre = new AbortController(); pre.abort()
  failure(await generateWithProvider(adapter(async () => { assert.fail('no request') }), messages, { signal: pre.signal }), 'CANCELLED')
  const active = new AbortController()
  let signal: AbortSignal | null | undefined
  let finish!: (response: Response) => void
  const result = await generateWithProvider(adapter(async (_url, init) => {
    signal = init?.signal; active.abort()
    return new Promise(resolve => { finish = resolve })
  }), messages, { signal: active.signal })
  failure(result, 'CANCELLED'); assert.equal(signal?.aborted, true)
  finish(json()); await new Promise(resolve => setImmediate(resolve))
  failure(result, 'CANCELLED')
})

test('createApp chooses Groq for BOTH routes with key, and Ollama without key; restrictions remain', async t => {
  const localFetch = globalThis.fetch
  for (const useGroq of [true, false]) {
    if (useGroq) process.env.GROQ_API_KEY = key; else delete process.env.GROQ_API_KEY
    let calls = 0
    let bad = false
    let offline = false
    const mock = t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
      calls++
      assert.equal(url, useGroq ? 'https://api.groq.com/openai/v1/chat/completions' : 'http://127.0.0.1:11434/api/chat')
      if (offline) throw new Error(key)
      const request = JSON.parse(String(init?.body))
      const context = JSON.parse(request.messages[1].content)
      const content = context.candidates ? JSON.stringify({ reasonIds: bad ? [1, 2] : Object.keys(context.candidates) })
        : JSON.stringify({ answer: bad ? 'You are eligible.' : 'Practice regularly.' })
      return useGroq ? json(payload(content)) : json({ model: 'qwen3:1.7b', done: true, done_reason: 'stop', message: { role: 'assistant', content } })
    })
    const server = createApp().listen(0, '127.0.0.1'); await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const post = (path: string, body: unknown) => localFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const explainPath = '/api/opportunities/nptel-joy-of-computing-using-python/explanation'
    const profile = { careerInterests: [], skills: [], weeklyLearningHours: null }
    try {
      const guidance = await (await post('/api/ask', { question: 'How can I learn Python?' })).json()
      assert.match(guidance.answer, /Practice regularly/); assert.equal(guidance.grounded, false)
      const explanation = await (await post(explainPath, { profile })).json()
      assert.match(explanation.answer, /AI-selected/); assert.match(explanation.answer, /Unreviewed/)
      assert.deepEqual(explanation.citations, []); assert.equal(explanation.grounded, false)
      assert.equal(calls, 2)
      await post('/api/ask', { question: 'Which scholarships are open?' })
      assert.equal(calls, 2)
      bad = true
      assert.match((await (await post(explainPath, { profile })).json()).answer, /Deterministic explanation/)
      assert.doesNotMatch((await (await post('/api/ask', { question: 'How can I learn Python?' })).json()).answer, /You are eligible/)
      offline = true
      assert.equal((await post('/api/ask', { question: 'How can I learn Python?' })).status, 503)
      assert.match((await (await post(explainPath, { profile })).json()).answer, /Deterministic explanation/)
    } finally {
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
      mock.mock.restore()
    }
  }
})

test('synthetic demo opportunity is excluded before Groq inference', async () => {
  const item = (await createOpportunityStore().getAll()).items[0]
  const result = await explainOpportunity(adapter(async () => { assert.fail('synthetic record must not be sent') }),
    { ...item, verificationStatus: 'demo', title: '[DEMO] Fictional test' },
    { careerInterests: [], skills: [], weeklyLearningHours: null })
  assert.match(result.answer, /fictional demo/); assert.equal(result.grounded, false); assert.deepEqual(result.citations, [])
})

test('GPT-OSS uses low reasoning and completion headroom while retaining JSON mode and hiding reasoning', async () => {
  const modelId = 'openai/gpt-oss-20b'
  const provider = new GroqProvider({ model: modelId, fetch: async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { model: modelId, messages, stream: false,
      response_format: { type: 'json_object' }, temperature: 0, max_completion_tokens: 4096,
      reasoning_effort: 'low', include_reasoning: false })
    return json(payload(undefined, modelId))
  } })
  const result = await generateWithProvider(provider, messages)
  assert.ok(result.ok)
  assert.equal(result.value.content, '{"answer":"Practice regularly."}')
  assert.doesNotMatch(JSON.stringify(result), /private-reasoning/)
})

test('GPT-OSS configuration preserves both engine schemas and safe fallbacks without retries', async () => {
  const modelId = 'openai/gpt-oss-20b'
  const item = (await createOpportunityStore().getAll()).items[0]
  const profile = { careerInterests: [], skills: [], weeklyLearningHours: null }
  let mode: 'valid' | 'schema-invalid' | 'http-error' | 'truncated' = 'valid'
  let calls = 0
  const provider = new GroqProvider({ model: modelId, fetch: async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    assert.equal(body.max_completion_tokens, 4096)
    assert.equal(body.reasoning_effort, 'low')
    assert.equal(body.include_reasoning, false)
    assert.deepEqual(body.response_format, { type: 'json_object' })
    const context = JSON.parse(body.messages[1].content)
    assert.match(body.messages[0].content, /JSON object/)
    if (mode === 'http-error') return new Response(JSON.stringify({ error: {
      code: 'json_validate_failed', failed_generation: 'private-reasoning', message: key,
    } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    const content = context.candidates
      ? JSON.stringify({ reasonIds: mode === 'schema-invalid' ? [1, 2] : ['explore'] })
      : JSON.stringify(mode === 'schema-invalid' ? { answer: 'You are eligible.', grounded: true } : { answer: 'Practice regularly.' })
    const data = payload(content, modelId)
    if (mode === 'truncated') data.choices[0].finish_reason = 'length'
    return json(data)
  } })
  const engine = createLimitedAnswerEngine(provider)
  const answer = await engine.answer('How can I learn Python?')
  assert.ok(answer.ok); assert.match(answer.response.answer, /Practice regularly/)
  assert.equal(answer.response.grounded, false)
  assert.match((await explainOpportunity(provider, item, profile)).answer, /AI-selected/)
  mode = 'schema-invalid'
  const rejected = await engine.answer('How can I learn Python?')
  assert.ok(rejected.ok); assert.equal(rejected.response.answer, UNAVAILABLE_INFORMATION)
  assert.match((await explainOpportunity(provider, item, profile)).answer, /Deterministic explanation/)
  for (const next of ['http-error', 'truncated'] as const) {
    mode = next
    const failed = await engine.answer('How can I learn Python?')
    assert.ok(!failed.ok)
    assert.equal(failed.error.code, next === 'http-error' ? 'PROVIDER_ERROR' : 'INVALID_RESPONSE')
    const fallback = await explainOpportunity(provider, item, profile)
    assert.match(fallback.answer, /Deterministic explanation/)
    assert.equal(fallback.grounded, false); assert.deepEqual(fallback.citations, [])
    assert.doesNotMatch(JSON.stringify(fallback), /private-reasoning|gsk-/)
  }
  assert.equal(calls, 8)
})

test('HTTP 400 diagnostics allowlist categories and never log error messages, failed generations or unknown codes', async t => {
  const warn = t.mock.method(console, 'warn', () => {})
  const log = t.mock.method(console, 'log', () => {})
  const error = t.mock.method(console, 'error', () => {})
  for (const [code, category] of [
    ['json_validate_failed', 'JSON_VALIDATION_FAILED'], ['context_length_exceeded', 'CONTEXT_LENGTH_EXCEEDED'],
    ['model_not_found', 'MODEL_NOT_FOUND'], ['unsupported_parameter', 'UNSUPPORTED_PARAMETER'],
    ['invalid_parameter', 'INVALID_PARAMETER'], [key, 'UNCLASSIFIED'], ['__proto__', 'UNCLASSIFIED'],
  ]) {
    const provider = adapter(async () => new Response(JSON.stringify({ error: { code, type: key,
      message: key, failed_generation: 'PRIVATE_STUDENT_CONTENT', headers: { Authorization: key } } }),
    { status: 400, headers: { 'Content-Type': 'application/json' } }))
    failure(await generateWithProvider(provider, messages), 'PROVIDER_ERROR')
    assert.deepEqual(warn.mock.calls.slice(-2).map(call => call.arguments), [
      ['[PHAROS Groq] HTTP_FAILURE', 400], ['[PHAROS Groq] BAD_REQUEST_CATEGORY', category],
    ])
  }
  failure(await generateWithProvider(adapter(async () => new Response(JSON.stringify({ error: {
    type: 'invalid_request_error', code: key, message: key,
  } }), { status: 400, headers: { 'Content-Type': 'application/json' } })), messages), 'PROVIDER_ERROR')
  assert.deepEqual(warn.mock.calls.at(-1)!.arguments, ['[PHAROS Groq] BAD_REQUEST_CATEGORY', 'INVALID_REQUEST'])
  assert.doesNotMatch(JSON.stringify(warn.mock.calls.map(call => call.arguments)), /gsk-|PRIVATE_STUDENT_CONTENT/)
  assert.equal(log.mock.callCount() + error.mock.callCount(), 0)
})

test('HTTP 400 malformed, oversized and stalled diagnostic bodies preserve the safe provider failure', async t => {
  const warn = t.mock.method(console, 'warn', () => {})
  for (const [body, category] of [
    ['{secret', 'UNCLASSIFIED'], ['x'.repeat(16 * 1024 + 1), 'ERROR_BODY_TOO_LARGE'],
  ]) {
    failure(await generateWithProvider(adapter(async () => new Response(body,
      { status: 400, headers: { 'Content-Type': 'application/json' } })), messages), 'PROVIDER_ERROR')
    assert.deepEqual(warn.mock.calls.at(-1)!.arguments, ['[PHAROS Groq] BAD_REQUEST_CATEGORY', category])
  }
  const stalled = () => new Response(new ReadableStream({ pull: () => new Promise(() => {}) }),
    { status: 400, headers: { 'Content-Type': 'application/json' } })
  failure(await generateWithProvider(adapter(async () => stalled()), messages, { timeoutMs: 2000 }), 'PROVIDER_ERROR')
  assert.deepEqual(warn.mock.calls.at(-1)!.arguments, ['[PHAROS Groq] BAD_REQUEST_CATEGORY', 'ERROR_BODY_TIMEOUT'])
  // The caller's shorter deadline still wins over the diagnostic read budget.
  failure(await generateWithProvider(adapter(async () => stalled()), messages, { timeoutMs: 10 }), 'TIMEOUT')
})
