import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIUnavailableError, createAIClient, parseAIResponse } from './aiClient'

const answer = { answer: 'Test fixture only.', grounded: true, citations: [{ title: 'Test source', url: 'https://example.com/reference', recordId: 'test-record' }] }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
afterEach(() => vi.useRealTimers())

describe('AI client without invented answers', () => {
  it.each([undefined, '', 'bad-url', 'javascript:alert(1)', 'https://user:secret@example.com', 'https://example.com?key=secret'])('rejects absent or invalid configuration %s without a request', async base => {
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
