import assert from 'node:assert/strict'
import { test, beforeEach, afterEach } from 'node:test'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { GeminiProvider } from '../src/geminiProvider.ts'
import { generateWithProvider } from '../src/aiProvider.ts'
import { createApp } from '../src/app.ts'

const names = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GROQ_API_KEY', 'GROQ_MODEL'] as const
let saved: (string | undefined)[]
beforeEach(() => {
  saved = names.map(name => process.env[name])
  process.env.GEMINI_API_KEY = 'test-only-secret'
  delete process.env.GEMINI_MODEL
})
afterEach(() => names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i] }))
const messages = [{ role: 'system' as const, content: 'Return JSON.' }, { role: 'user' as const, content: '{"question":"Explain loops"}' }]
const payload = () => ({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [
  { thought: true, text: 'private-thought' }, { text: '{"kind":"general","answer":"Practice with a loop."}' },
] } }] })
const json = (data: unknown = payload()) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })

test('Gemini maps roles to REST JSON, keeps key in header and excludes thoughts', async () => {
  const provider = new GeminiProvider({ fetch: async (url, init) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'test-only-secret')
    assert.equal(init?.redirect, 'error')
    assert.deepEqual(JSON.parse(String(init?.body)), { systemInstruction: { parts: [{ text: messages[0].content }] },
      contents: [{ role: 'user', parts: [{ text: messages[1].content }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4096, candidateCount: 1 } })
    assert.ok(init?.signal instanceof AbortSignal)
    return json()
  } })
  const result = await generateWithProvider(provider, messages)
  assert.ok(result.ok)
  assert.equal(result.value.content, '{"kind":"general","answer":"Practice with a loop."}')
  assert.doesNotMatch(JSON.stringify([provider, result]), /test-only-secret|private-thought/)
})

test('Gemini rejects blocked, truncated, tool, citation, malformed and oversized output', async () => {
  const base = payload()
  const cases: unknown[] = [null, {}, { error: { message: 'secret' } }, { promptFeedback: { blockReason: 'SAFETY' } },
    { ...base, candidates: [] }, { ...base, candidates: [base.candidates[0], base.candidates[0]] },
    { ...base, padding: 'x'.repeat(300_000) }]
  for (const finishReason of ['MAX_TOKENS', 'SAFETY', 'RECITATION']) cases.push({ candidates: [{ ...base.candidates[0], finishReason }] })
  for (const parts of [[{ functionCall: { name: 'tool' } }], [{ thought: true, text: 'private-thought' }],
    ...['', 'bad-json', '[]', '{"answer":"<think>private</think>"}'].map(text => [{ text }])]) {
    cases.push({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts } }] })
  }
  cases.push({ candidates: [{ ...base.candidates[0], groundingMetadata: {} }] })
  for (const data of cases) {
    const result = await generateWithProvider(new GeminiProvider({ fetch: async () => json(data) }), messages)
    assert.ok(!result.ok); assert.doesNotMatch(JSON.stringify(result), /secret|private/)
  }
})

test('Gemini config, HTTP and connection failures are sanitized and never logged', async t => {
  const warn = t.mock.method(console, 'warn', () => {})
  const log = t.mock.method(console, 'log', () => {})
  const error = t.mock.method(console, 'error', () => {})
  for (const status of [400, 401, 403, 404, 429, 500]) {
    const result = await generateWithProvider(new GeminiProvider({ fetch: async () => new Response('test-only-secret', { status }) }), messages)
    assert.ok(!result.ok); assert.equal(result.error.code, status === 429 || status >= 500 ? 'UNAVAILABLE' : 'PROVIDER_ERROR')
    assert.doesNotMatch(JSON.stringify(result), /secret/)
  }
  const offline = await generateWithProvider(new GeminiProvider({ fetch: async () => { throw new Error('secret') } }), messages)
  assert.ok(!offline.ok); assert.equal(offline.error.code, 'UNAVAILABLE')
  process.env.GEMINI_MODEL = 'gemini-3.6-flash'
  const configured = new GeminiProvider({ fetch: async url => { assert.match(String(url), /gemini-3.6-flash:generateContent$/); return json() } })
  assert.ok((await generateWithProvider(configured, messages)).ok)
  delete process.env.GEMINI_API_KEY
  const missing = await generateWithProvider(new GeminiProvider({ fetch: async () => { assert.fail('no fetch') } }), messages)
  assert.ok(!missing.ok); assert.equal(missing.error.code, 'UNAVAILABLE')
  assert.equal(warn.mock.callCount() + log.mock.callCount() + error.mock.callCount(), 0)
})

test('Gemini timeout and cancellation cover stalled headers and body', async () => {
  for (const body of [false, true]) {
    let signal: AbortSignal | null | undefined
    const provider = new GeminiProvider({ fetch: async (_url, init) => {
      signal = init?.signal
      return body ? new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { headers: { 'Content-Type': 'application/json' } })
        : new Promise(() => {})
    } })
    const result = await provider.generate({ messages, responseFormat: 'json', timeoutMs: 10, signal: new AbortController().signal })
    assert.ok(!result.ok); assert.equal(result.error.code, 'TIMEOUT'); assert.equal(signal?.aborted, true)
  }
  const controller = new AbortController(); controller.abort()
  const result = await generateWithProvider(new GeminiProvider({ fetch: async () => { assert.fail('no fetch') } }), messages, { signal: controller.signal })
  assert.ok(!result.ok); assert.equal(result.error.code, 'CANCELLED')
  const active = new AbortController()
  const cancelled = await generateWithProvider(new GeminiProvider({ fetch: async () => { active.abort(); return new Promise(() => {}) } }), messages, { signal: active.signal })
  assert.ok(!cancelled.ok); assert.equal(cancelled.error.code, 'CANCELLED')
})

test('configured app sends varied ask requests to Gemini and opportunity explanations only to Groq', async t => {
  process.env.GROQ_API_KEY = 'fake-groq-key'; delete process.env.GROQ_MODEL
  const localFetch = globalThis.fetch
  const destinations: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    destinations.push(String(url))
    if (String(url).startsWith('https://generativelanguage.googleapis.com/')) return json()
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions')
    const body = JSON.parse(String(init?.body))
    return json({ model: body.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"reasonIds":["explore"]}' } }] })
  })
  const server = createApp().listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (path: string, body: unknown) => localFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const response = await post('/api/ask', { question: 'Explain loops with a tiny Python example please' })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.deepEqual(Object.keys(result).sort(), ['answer', 'citations', 'grounded'])
    assert.equal(result.grounded, false); assert.deepEqual(result.citations, [])
    assert.match(result.answer, /no live web access/)
    const explanation = await (await post('/api/opportunities/nptel-joy-of-computing-using-python/explanation', {
      profile: { careerInterests: [], skills: [], weeklyLearningHours: null },
    })).json()
    assert.match(explanation.answer, /AI-selected/); assert.match(explanation.answer, /Unreviewed/)
    assert.equal(destinations.length, 2)
    assert.match(destinations[0], /googleapis/); assert.match(destinations[1], /groq/)
    assert.equal((await post('/api/ask', { question: ' ' })).status, 400)
    assert.equal(destinations.length, 2)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
