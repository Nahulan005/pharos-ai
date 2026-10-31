import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProfile } from '../models/studentProfile'
import { getRecommendations } from './recommendationService'
import * as opportunityService from './opportunityService'

afterEach(() => vi.restoreAllMocks())
const now = new Date('2026-11-01T12:00:00Z')

describe('async recommendation service', () => {
  it('returns no personalization and never loads opportunities for a missing profile', async () => {
    const load = vi.spyOn(opportunityService, 'getAll')
    await expect(getRecommendations(null, now)).resolves.toEqual([])
    expect(load).not.toHaveBeenCalled()
  })
  it('rejects invalid profiles rather than guessing defaults', async () => {
    await expect(getRecommendations({ ...createDefaultProfile(), weeklyLearningHours: -1 }, now)).rejects.toThrow('valid saved profile')
  })
  it('uses existing sample data and places the web course first for a web interest', async () => {
    const request = getRecommendations({ ...createDefaultProfile(), careerInterests: ['web_dev'] }, now)
    expect(request).toBeInstanceOf(Promise)
    const results = await request
    expect(results).toHaveLength(3)
    expect(results[0]).toMatchObject({ opportunityId: 'demo-free-course', relevance: 'medium' })
    expect(results.every(item => item.relevance !== 'high')).toBe(true)
    expect(results.every(item => item.uncertainties.some(message => message.includes('[DEMO]')))).toBe(true)
  })
  it('handles a saved but unspecified profile conservatively', async () => {
    const results = await getRecommendations({ ...createDefaultProfile(), state: '' }, now)
    expect(results.every(item => item.relevance === 'low')).toBe(true)
  })
  it('passes opportunity-loading errors to the UI retry boundary', async () => {
    vi.spyOn(opportunityService, 'getAll').mockRejectedValueOnce(new Error('Unavailable'))
    await expect(getRecommendations(createDefaultProfile(), now)).rejects.toThrow('Unavailable')
  })
  it('handles an empty opportunity list', async () => {
    vi.spyOn(opportunityService, 'getAll').mockResolvedValueOnce([])
    await expect(getRecommendations(createDefaultProfile(), now)).resolves.toEqual([])
  })
})
