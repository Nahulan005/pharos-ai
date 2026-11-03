import { afterEach, expect, it, vi } from 'vitest'
import sample from '../../shared/opportunities.sample.json'
import { getAll, getById } from './opportunityService'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function mock(body: unknown = sample, status = 200) {
  const fetcher = vi.fn().mockImplementation(async () => reply(body, status))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

it('loads the backend list through the relative API URL, preserving records exactly', async () => {
  const fetcher = mock()
  await expect(getAll()).resolves.toEqual(sample.items)
  expect(fetcher).toHaveBeenCalledWith('/api/opportunities', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }))
  const first = await getAll(); first[0].title = 'changed'
  expect((await getAll())[0].title).toBe(sample.items[0].title)
})

it('loads details independently, including direct navigation without a list request', async () => {
  const item = sample.items[0], fetcher = mock(item)
  await expect(getById(item.id)).resolves.toEqual(item)
  expect(fetcher).toHaveBeenCalledWith(`/api/opportunities/${item.id}`, expect.any(Object))
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('distinguishes a missing record from backend and route failures', async () => {
  mock({ error: { code: 'OPPORTUNITY_NOT_FOUND', message: 'Not found' } }, 404)
  await expect(getById('missing')).resolves.toBeNull()
  mock({ error: { code: 'NOT_FOUND' } }, 404)
  await expect(getById('missing')).rejects.toThrow('unavailable')
  mock(sample.items[0])
  await expect(getById('different-id')).rejects.toThrow('unavailable')
  mock(null)
  await expect(getById(sample.items[0].id)).rejects.toThrow('unavailable')
})

it('handles invalid route IDs without sending arbitrary paths', async () => {
  const fetcher = mock()
  for (const id of ['', '../health', 'x?query=y', 'Bad ID']) await expect(getById(id)).resolves.toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
})

it.each([null, [], {}, { ...sample, schemaVersion: 99 }, { ...sample, generatedAt: '2026-02-30T00:00:00Z' },
  { ...sample, items: null }, { ...sample, items: [sample.items[0], sample.items[0]] },
])('rejects malformed envelopes without inventing a fallback %#', async value => {
  mock(value)
  await expect(getAll()).rejects.toThrow('unavailable')
})

it.each([{ category: 'internship' }, { title: null }, { topics: [42] }, { applicability: null },
  { applicability: { scope: 'national', states: ['Tamil Nadu'] } }, { tags: 'tag' },
  { deadline: { type: 'fixed', date: '2026-02-30', note: null } }, { verifiedBy: 'Invented reviewer' },
  { sourceUrl: 'javascript:alert(1)' }, { verificationStatus: 'verified' },
])('rejects malformed records in both list and detail responses %#', async patch => {
  const item = { ...sample.items[0], ...patch }
  mock({ ...sample, items: [item] }); await expect(getAll()).rejects.toThrow('unavailable')
  mock(item); await expect(getById(sample.items[0].id)).rejects.toThrow('unavailable')
})

it('accepts empty lists and retries after failure with a new backend request', async () => {
  const fetcher = mock()
  fetcher.mockRejectedValueOnce(new Error('secret network detail'))
  await expect(getAll()).rejects.toThrow('Opportunity data is unavailable. Please try again.')
  await expect(getAll()).resolves.toEqual(sample.items)
  mock({ ...sample, items: [] }); await expect(getAll()).resolves.toEqual([])
})

it('handles failed status, invalid JSON and HTML for list and detail', async () => {
  for (const makeResponse of [() => reply({ error: 'secret' }, 503), () => new Response('<html>'),
    () => new Response('{broken', { headers: { 'Content-Type': 'application/json' } })]) {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => makeResponse()))
    await expect(getAll()).rejects.toThrow('Opportunity data is unavailable. Please try again.')
    await expect(getById(sample.items[0].id)).rejects.toThrow('Opportunity data is unavailable. Please try again.')
  }
})

it('aborts a stalled request so the existing UI can show its retry state', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })))
  const assertion = expect(getAll()).rejects.toThrow('unavailable')
  await vi.advanceTimersByTimeAsync(15_000)
  await assertion
})
