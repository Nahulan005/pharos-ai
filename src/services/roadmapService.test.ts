import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import sample from '../../shared/opportunities.sample.json'
import type { Opportunity } from '../../shared/contract'
import { getRoadmap, getRoadmapOpportunities } from './roadmapService'
import * as opportunities from './opportunityService'

afterEach(() => vi.restoreAllMocks())
beforeEach(() => vi.spyOn(opportunities, 'getAll').mockImplementation(async () => structuredClone(sample.items) as Opportunity[]))
it('provides an asynchronous plan without requiring a profile', async () => {
  const result = getRoadmap({ trackId: 'full-stack', weeklyHours: 5, profile: null, completed: [] })
  expect(result).toBeInstanceOf(Promise)
  expect((await result).weeks.length).toBeGreaterThan(0)
  await expect(getRoadmap({ trackId: 'ai-ml', weeklyHours: null, profile: null, completed: [] })).rejects.toThrow()
})
it('does not recommend unreviewed candidates as source-checked learning resources', async () => {
  expect(await getRoadmapOpportunities('full-stack')).toEqual([])
  expect(await getRoadmapOpportunities('ai-ml')).toEqual([])
})
it('requires exact topic overlap, valid sources and a non-expired learning record', async () => {
  const course = (await opportunities.getAll()).find(item => item.category === 'course_cert')!
  const eligible: Opportunity = { ...course, id: 'test-course', title: 'Synthetic test course', topics: ['web_dev'], verificationStatus: 'checked_against_source', sourceType: 'official', sourceUrl: 'https://example.com/course' }
  vi.spyOn(opportunities, 'getAll').mockResolvedValue([eligible,
    { ...eligible, id: 'unreviewed', verificationStatus: 'unreviewed' },
    { ...eligible, id: 'wrong-topic', topics: ['general'] },
    { ...eligible, id: 'bad-url', sourceUrl: 'javascript:alert(1)' },
    { ...eligible, id: 'expired', deadline: { type: 'fixed', date: '2020-01-01', note: null } },
  ])
  expect((await getRoadmapOpportunities('full-stack', new Date('2026-11-01'))).map(item => item.id)).toEqual(['test-course'])
})
