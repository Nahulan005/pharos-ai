import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OllamaProvider } from '../src/ollamaProvider.ts'
import { generateWithProvider } from '../src/aiProvider.ts'
import type { GenerationResult } from '../src/aiProvider.ts'

const messages = [{ role: 'system' as const, content: 'Return JSON.' }, { role: 'user' as const, content: 'Study guidance.' }]
const payload = () => ({ model: 'qwen3:1.7b', done: true, done_reason: 'stop',
  message: { role: 'assistant', content: '{"answer":"Practice a little each day."}', thinking: 'private-reasoning' } })
const response = (data: unknown = payload()) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
const provider = (fetcher: typeof fetch) => new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'qwen3:1.7b', fetch: fetcher })
function failure(result: GenerationResult, code: string) {
  assert.ok(!result.ok)
  assert.equal(result.error.code, code)
  assert.doesNotMatch(JSON.stringify(result), /private-reasoning|secret|password|11434/)
}

test('Ollama adapter sends non-streaming JSON chat, disables thinking and returns only final content', async () => {
  let signal: AbortSignal | null | undefined
  const adapter = provider(async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat')
    assert.equal(init?.method, 'POST')
    assert.equal(init?.redirect, 'error')
    const body = JSON.parse(String(init?.body))
    assert.deepEqual(body.messages, messages)
    assert.equal(body.model, 'qwen3:1.7b')
    assert.equal(body.stream, false)
    assert.equal(body.think, false)
    assert.equal(body.format, 'json')
    signal = init?.signal
    return response()
  })
  const result = await generateWithProvider(adapter, messages)
  assert.ok(result.ok)
  assert.deepEqual(result.value, { providerId: 'ollama', modelId: 'qwen3:1.7b',
    content: '{"answer":"Practice a little each day."}', finishReason: 'completed' })
  assert.doesNotMatch(JSON.stringify(result), /private-reasoning|thinking/)
  assert.equal(signal?.aborted, true)
})

test('Ollama configuration defaults and environment overrides are backend-only', async () => {
  const beforeUrl = process.env.OLLAMA_BASE_URL, beforeModel = process.env.OLLAMA_MODEL
  try {
    delete process.env.OLLAMA_BASE_URL; delete process.env.OLLAMA_MODEL
    const defaults = new OllamaProvider({ fetch: async url => { assert.equal(url, 'http://127.0.0.1:11434/api/chat'); return response() } })
    assert.equal(defaults.modelId, 'qwen3:1.7b')
    assert.ok((await generateWithProvider(defaults, messages)).ok)
    process.env.OLLAMA_BASE_URL = 'http://localhost:12345'
    process.env.OLLAMA_MODEL = 'custom-model'
    const configured = new OllamaProvider({ fetch: async (url, init) => {
      assert.equal(url, 'http://localhost:12345/api/chat')
      assert.equal(JSON.parse(String(init?.body)).model, 'custom-model')
      return response({ ...payload(), model: 'custom-model:latest' })
    } })
    assert.ok((await generateWithProvider(configured, messages)).ok)
  } finally {
    if (beforeUrl === undefined) delete process.env.OLLAMA_BASE_URL; else process.env.OLLAMA_BASE_URL = beforeUrl
    if (beforeModel === undefined) delete process.env.OLLAMA_MODEL; else process.env.OLLAMA_MODEL = beforeModel
  }
})

test('offline Ollama and model errors are sanitized', async () => {
  failure(await generateWithProvider(provider(async () => { throw new Error('secret localhost:11434 password') }), messages), 'UNAVAILABLE')
  for (const [status, code] of [[404, 'PROVIDER_ERROR'], [500, 'UNAVAILABLE'], [503, 'UNAVAILABLE']] as const) {
    failure(await generateWithProvider(provider(async () => new Response('secret model error', { status })), messages), code)
  }
  failure(await generateWithProvider(provider(async () => response({ error: 'secret model path' })), messages), 'PROVIDER_ERROR')
})

test('malformed envelopes, JSON, empty content and inline reasoning fail closed', async () => {
  const invalid: unknown[] = [null, [], {}, { ...payload(), model: 'wrong' }, { ...payload(), done: false },
    { ...payload(), done_reason: 'length' }, { ...payload(), message: null }]
  for (const content of ['', ' ', 'not-json', 'null', '[]', '<think>private-reasoning</think>{"answer":"Hi"}',
    '{"answer":"<think>private-reasoning</think>"}', '{"answer":"\\u003cthink>private-reasoning"}']) {
    invalid.push({ ...payload(), message: { role: 'assistant', content } })
  }
  invalid.push({ ...payload(), message: { ...payload().message, role: 'user' } },
    { ...payload(), message: { ...payload().message, tool_calls: [] } })
  for (const data of invalid) failure(await generateWithProvider(provider(async () => response(data)), messages), 'INVALID_RESPONSE')
  failure(await generateWithProvider(provider(async () => new Response('{secret', { headers: { 'Content-Type': 'application/json' } })), messages), 'INVALID_RESPONSE')
  failure(await generateWithProvider(provider(async () => new Response('secret', { headers: { 'Content-Type': 'text/html' } })), messages), 'INVALID_RESPONSE')
})

test('Ollama response bytes are bounded even when the extra data is reasoning', async () => {
  const data = payload(); data.message.thinking = 'x'.repeat(300_000)
  failure(await generateWithProvider(provider(async () => response(data)), messages), 'INVALID_RESPONSE')
})

test('adapter timeout covers headers and stalled response bodies even when called directly', async () => {
  for (const stage of ['headers', 'body']) {
    let signal: AbortSignal | null | undefined
    const adapter = provider(async (_url, init) => {
      signal = init?.signal
      if (stage === 'headers') return new Promise<Response>(() => {})
      return new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { headers: { 'Content-Type': 'application/json' } })
    })
    failure(await adapter.generate({ messages, responseFormat: 'json', timeoutMs: 15, signal: new AbortController().signal }), 'TIMEOUT')
    assert.equal(signal?.aborted, true)
  }
})

test('adapter cancellation prevents calls or aborts an active call and ignores late results', async () => {
  const pre = new AbortController(); pre.abort()
  let calls = 0
  failure(await generateWithProvider(provider(async () => { calls++; return response() }), messages, { signal: pre.signal }), 'CANCELLED')
  assert.equal(calls, 0)
  const active = new AbortController()
  let seen: AbortSignal | null | undefined
  let finish!: (value: Response) => void
  const result = await generateWithProvider(provider(async (_url, init) => {
    seen = init?.signal
    active.abort()
    return new Promise<Response>(resolve => { finish = resolve })
  }), messages, { signal: active.signal })
  failure(result, 'CANCELLED')
  assert.equal(seen?.aborted, true)
  finish(response())
  await new Promise(resolve => setImmediate(resolve))
  failure(result, 'CANCELLED')
})

test('invalid deployment URLs fail closed without network access', async () => {
  for (const baseUrl of ['file:///secret', 'http://user:password@localhost:11434', 'http://localhost:11434/path', 'http://localhost:11434/?key=secret']) {
    let calls = 0
    const adapter = new OllamaProvider({ baseUrl, model: 'qwen3:1.7b', fetch: async () => { calls++; return response() } })
    failure(await generateWithProvider(adapter, messages), 'UNAVAILABLE')
    assert.equal(calls, 0)
  }
})
