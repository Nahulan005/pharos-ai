import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateWithProvider } from '../src/aiProvider.ts'
import type { AIProvider, GenerationRequest, GenerationResult } from '../src/aiProvider.ts'

const messages = [{ role: 'system' as const, content: 'Test instructions.' }, { role: 'user' as const, content: 'Test data.' }]
const success = (): GenerationResult => ({ ok: true, value: {
  providerId: 'mock', modelId: 'test-model', content: '{"answer":"Test only"}', finishReason: 'completed',
} })
const provider = (generate: AIProvider['generate'] = async () => success()): AIProvider => ({
  providerId: 'mock', modelId: 'test-model', generate,
})
function error(result: GenerationResult, code: string) {
  assert.ok(!result.ok)
  assert.equal(result.error.code, code)
  assert.doesNotMatch(result.error.message, /secret|private|password/)
}

test('provider contract carries IDs, role messages, JSON format, timeout and signal', async () => {
  let received!: GenerationRequest
  const input = structuredClone(messages)
  const result = await generateWithProvider(provider(async request => { received = request; return success() }), input, { timeoutMs: 500 })
  assert.ok(result.ok)
  assert.equal(result.value.modelId, 'test-model')
  assert.equal(received.responseFormat, 'json')
  assert.equal(received.timeoutMs, 500)
  assert.ok(received.signal instanceof AbortSignal)
  assert.equal(received.signal.aborted, true) // Cleanup after completion.
  received.messages[0].content = 'changed'
  assert.deepEqual(input, messages)
})

test('provider timeout returns promptly and aborts an uncooperative provider', async () => {
  let signal!: AbortSignal
  const result = await generateWithProvider(provider(async request => {
    signal = request.signal
    return new Promise(() => {})
  }), messages, { timeoutMs: 10 })
  error(result, 'TIMEOUT')
  assert.equal(signal.aborted, true)
})

test('pre-cancellation prevents generation and active cancellation aborts it', async () => {
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  error(await generateWithProvider(provider(async () => { calls++; return success() }), messages,
    { signal: controller.signal }), 'CANCELLED')
  assert.equal(calls, 0)
  const active = new AbortController()
  let signal!: AbortSignal
  const result = generateWithProvider(provider(async request => {
    signal = request.signal
    active.abort()
    return new Promise(() => {})
  }), messages, { signal: active.signal })
  error(await result, 'CANCELLED')
  assert.equal(signal.aborted, true)
})

test('late provider completion cannot replace a timeout or cancellation result', async () => {
  let complete!: (value: GenerationResult) => void
  const result = await generateWithProvider(provider(() => new Promise(resolve => { complete = resolve })), messages, { timeoutMs: 10 })
  error(result, 'TIMEOUT')
  complete(success())
  await new Promise(resolve => setImmediate(resolve))
  error(result, 'TIMEOUT')
})

test('provider exceptions and returned failures are sanitized', async () => {
  error(await generateWithProvider(provider(async () => { throw new Error('secret private/path password') }), messages), 'PROVIDER_ERROR')
  const result = await generateWithProvider(provider(async () => ({ ok: false,
    error: { code: 'UNAVAILABLE', message: 'secret private/path password' } })), messages)
  error(result, 'UNAVAILABLE')
  assert.deepEqual(result, { ok: false, error: { code: 'UNAVAILABLE', message: 'AI provider is unavailable.' } })
})

test('invalid timeout, messages, provider/model identity and truncated output fail closed', async () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 1.5, 300001]) {
    error(await generateWithProvider(provider(), messages, { timeoutMs }), 'INVALID_REQUEST')
  }
  error(await generateWithProvider(provider(), []), 'INVALID_REQUEST')
  for (const patch of [{ providerId: 'other' }, { modelId: 'other' }, { content: '' },
    { content: 'x'.repeat(200001) }, { finishReason: 'length' }]) {
    error(await generateWithProvider(provider(async () => {
      const result = success()
      assert.ok(result.ok)
      Object.assign(result.value, patch)
      return result
    }), messages), 'INVALID_RESPONSE')
  }
  error(await generateWithProvider(provider(async () => null as unknown as GenerationResult), messages), 'INVALID_RESPONSE')
})
