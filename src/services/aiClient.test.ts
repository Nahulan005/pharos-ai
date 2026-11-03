import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIUnavailableError, createAIClient, parseAIResponse } from './aiClient'

const answer = { answer: 'Test fixture only.', grounded: true, citations: [{ title: 'Test source', url: 'https://example.com/reference', recordId: 'test-record' }] }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe.each([true, false])('endpoint selection (development: %s)', development => {
  it.each([undefined, '', '  '])('defaults to the same-origin proxy for %s', async base => {
    vi.stubEnv('DEV', development)
    const fetcher = vi.fn().mockResolvedValue(json(answer))
    const client = createAIClient(base, fetcher)
    expect(client.configured).toBe(true)
    await expect(client.ask('  Question  ')).resolves.toEqual(answer)
    expect(fetcher).toHaveBeenCalledWith('/api/ask', expect.objectContaining({
      method: 'POST', body: '{"question":"Question"}', credentials: 'omit', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, signal: expect.any(AbortSignal),
    }))
  })

  it.each(['http://127.0.0.1:3000', 'http://localhost:3000/'])('uses Vite for the existing local backend only in development: %s', async base => {
    vi.stubEnv('DEV', development)
    const fetcher = vi.fn().mockResolvedValue(json(answer))
    await createAIClient(base, fetcher).ask('Question')
    expect(fetcher.mock.calls[0][0]).toBe(development ? '/api/ask' : `${base.replace(/\/$/, '')}/api/ask`)
  })

  it.each([
    ['https://backend.example.com/', 'https://backend.example.com/api/ask'],
    [' https://backend.example.com/pharos/ ', 'https://backend.example.com/pharos/api/ask'],
    ['http://127.0.0.1:4000', 'http://127.0.0.1:4000/api/ask'],
    ['http://127.0.0.1:3000/pharos', 'http://127.0.0.1:3000/pharos/api/ask'],
  ])('preserves explicit external or non-proxy endpoints: %s', async (base, endpoint) => {
    vi.stubEnv('DEV', development)
    const fetcher = vi.fn().mockResolvedValue(json(answer))
    const client = createAIClient(base, fetcher)
    expect(client.configured).toBe(true)
    await expect(client.ask('Question')).resolves.toEqual(answer)
    expect(fetcher).toHaveBeenCalledWith(endpoint, expect.objectContaining({ credentials: 'omit', redirect: 'error' }))
  })
})

describe('AI client without invented answers', () => {
  it.each(['bad-url', 'javascript:alert(1)', '//backend.example.com', 'https://user:secret@example.com', 'https://example.com?key=secret', 'http://127.0.0.1:3000/#fragment', 'http://user:secret@127.0.0.1:3000'])('rejects invalid configuration %s without a request', async base => {
    const fetcher = vi.fn()
    const client = createAIClient(base, fetcher)
    expect(client.configured).toBe(false)
    await expect(client.ask('Question')).rejects.toBeInstanceOf(AIUnavailableError)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('sends only the question to the backend and returns validated content', async () => {
    const fetcher = vi.fn().mockResolvedValue(json(answer))
    const result = await createAIClient('https://backend.example.com/', fetcher).ask('  Question  ')
    expect(result).toEqual(answer)
    expect(fetcher).toHaveBeenCalledWith('https://backend.example.com/api/ask', expect.objectContaining({ method: 'POST', body: '{"question":"Question"}', credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) }))
  })
  it('uses the same-origin default through the exported app client', async () => {
    vi.resetModules()
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:3000')
    const fetcher = vi.fn().mockResolvedValue(json({ answer: 'General guidance.', grounded: false, citations: [] }))
    vi.stubGlobal('fetch', fetcher)
    const { aiClient } = await import('./aiClient')
    expect(aiClient.configured).toBe(true)
    await expect(aiClient.ask('Question')).resolves.toEqual({ answer: 'General guidance.', grounded: false, citations: [] })
    expect(fetcher.mock.calls[0][0]).toBe('/api/ask')
  })
  it.each([404, 502, 503, 504])('reports HTTP %s as unavailable', async status => {
    await expect(createAIClient('http://localhost:3000', vi.fn().mockResolvedValue(json({}, status))).ask('Question')).rejects.toBeInstanceOf(AIUnavailableError)
  })
  it('reports network and server failures, never successful fallback text', async () => {
    await expect(createAIClient('http://localhost:3000', vi.fn().mockRejectedValue(new TypeError('network'))).ask('Question')).rejects.toMatchObject({ code: 'network' })
    await expect(createAIClient('http://localhost:3000', vi.fn().mockResolvedValue(json({}, 500))).ask('Question')).rejects.toMatchObject({ code: 'server' })
  })
  it('times out even if transport ignores abort', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}))
    const result = createAIClient('http://localhost:3000', fetcher).ask('Question', { timeoutMs: 50 })
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(50)
    await assertion
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('times out while waiting for the response body', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => {}) })
    const result = createAIClient('http://localhost:3000', fetcher).ask('Question', { timeoutMs: 20 })
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(20)
    await assertion
  })
  it('cancels in flight and does not request when already cancelled', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}))
    const client = createAIClient('http://localhost:3000', fetcher)
    const result = client.ask('Question', { signal: controller.signal })
    controller.abort()
    await expect(result).rejects.toMatchObject({ code: 'cancelled' })
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    await expect(client.ask('Question', { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['', ' ', 'x'.repeat(4001)])('rejects invalid questions before fetching', async question => {
    const fetcher = vi.fn()
    await expect(createAIClient('http://localhost:3000', fetcher).ask(question)).rejects.toMatchObject({ code: 'invalid-question' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects malformed JSON and invalid timeouts', async () => {
    const client = createAIClient('http://localhost:3000', vi.fn().mockResolvedValue(new Response('<html>')))
    await expect(client.ask('Question')).rejects.toMatchObject({ code: 'invalid-response' })
    for (const timeoutMs of [0, -1, NaN, Infinity, 300001]) await expect(client.ask('Question', { timeoutMs })).rejects.toMatchObject({ code: 'timeout' })
  })
})

describe('response validation and citations', () => {
  it.each([null, [], {}, { ...answer, answer: '' }, { ...answer, grounded: 'yes' }, { ...answer, citations: [] }, { ...answer, citations: 'url' }, { ...answer, citations: [{ title: '', url: 'https://example.com' }] }])('rejects invalid response %#', value => {
    expect(() => parseAIResponse(value)).toThrow()
  })
  it.each(['javascript:alert(1)', 'data:text/html,x', '//example.com', 'ftp://example.com', 'https://user:pass@example.com', ' https://example.com', 'https://'])('rejects unsafe citation %s', url => {
    expect(() => parseAIResponse({ ...answer, citations: [{ title: 'Test', url }] })).toThrow()
  })
  it('accepts ungrounded answers only when honestly labelled', () => {
    expect(parseAIResponse({ answer: 'Test fixture', grounded: false, citations: [] }).grounded).toBe(false)
  })
  it('does not interpret HTML or invent missing citations', () => {
    const response = parseAIResponse({ answer: '<script>test fixture</script>', grounded: false, citations: [] })
    expect(response.answer).toBe('<script>test fixture</script>')
    expect(response.citations).toEqual([])
    expect(() => parseAIResponse({ ...answer, citations: [{ ...answer.citations[0], recordId: '../made-up' }] })).toThrow()
  })
})
