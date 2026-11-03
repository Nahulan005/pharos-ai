import { afterEach, expect, it, vi } from 'vitest'
import { explainOpportunity } from './aiClient'
import { createDefaultProfile } from '../models/studentProfile'

afterEach(() => vi.unstubAllGlobals())
const answer = { answer: 'Unreviewed. Test explanation.', grounded: false, citations: [] }
it('sends only selected ID and saved learning preferences through the existing proxy', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(answer)))
  vi.stubGlobal('fetch', fetcher)
  const profile = { ...createDefaultProfile(), degreeCourse: 'Private study details', skills: ['Python'], weeklyLearningHours: 4 }
  expect(await explainOpportunity('python-course', profile)).toEqual(answer)
  expect(fetcher).toHaveBeenCalledWith('/api/opportunities/python-course/explanation', expect.objectContaining({
    method: 'POST', credentials: 'omit', redirect: 'error',
    body: JSON.stringify({ profile: { careerInterests: [], skills: ['Python'], weeklyLearningHours: 4 } }),
  }))
})
it('does not send unsaved profile defaults', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(answer)))
  vi.stubGlobal('fetch', fetcher)
  await explainOpportunity('python-course', null)
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ profile: { careerInterests: [], skills: [], weeklyLearningHours: null } })
})
it.each([{}, { ...answer, grounded: true }, { ...answer, citations: [{ title: 'invented', url: 'https://example.com' }] }])('rejects malformed or falsely grounded responses', async value => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(value))))
  await expect(explainOpportunity('python-course', null)).rejects.toMatchObject({ code: 'invalid-response' })
})
it('shows errors without inventing an answer when the backend fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
  await expect(explainOpportunity('python-course', null)).rejects.toMatchObject({ code: 'server' })
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private network detail')))
  await expect(explainOpportunity('python-course', null)).rejects.toMatchObject({ code: 'network' })
})
it('cancels before sending and rejects invalid IDs', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  const controller = new AbortController(); controller.abort()
  await expect(explainOpportunity('python-course', null, controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
  await expect(explainOpportunity('../bad', null)).rejects.toMatchObject({ code: 'server' })
  expect(fetcher).not.toHaveBeenCalled()
})
