import { afterEach, expect, it, vi } from 'vitest'
import { getRoadmap, getRoadmapOpportunities } from './roadmapService'
import * as opportunities from './opportunityService'

afterEach(() => vi.restoreAllMocks())
it('provides an asynchronous plan without requiring a profile', async () => {
  const result = getRoadmap({ trackId: 'full-stack', weeklyHours: 5, profile: null, completed: [] })
  expect(result).toBeInstanceOf(Promise)
  expect((await result).weeks.length).toBeGreaterThan(0)
  await expect(getRoadmap({ trackId: 'ai-ml', weeklyHours: null, profile: null, completed: [] })).rejects.toThrow()
})
it('does not recommend demo data as actual learning resources', async () => {
  expect(await getRoadmapOpportunities('full-stack')).toEqual([])
  expect(await getRoadmapOpportunities('ai-ml')).toEqual([])
})
it('requires exact topic overlap, valid sources and a non-expired learning record', async () => {
  const course = (await opportunities.getAll()).find(item => item.category === 'course_cert')!
  const eligible = { ...course, id: 'test-course', verificationStatus: 'checked_against_source' as const, sourceType: 'official' as const, sourceUrl: 'https://example.com/course' }
  vi.spyOn(opportunities, 'getAll').mockResolvedValue([eligible,
    { ...eligible, id: 'unreviewed', verificationStatus: 'unreviewed' },
    { ...eligible, id: 'wrong-topic', topics: ['general'] },
    { ...eligible, id: 'bad-url', sourceUrl: 'javascript:alert(1)' },
    { ...eligible, id: 'expired', deadline: { type: 'fixed', date: '2020-01-01', note: null } },
  ])
  expect((await getRoadmapOpportunities('full-stack', new Date('2026-11-01'))).map(item => item.id)).toEqual(['test-course'])
})
