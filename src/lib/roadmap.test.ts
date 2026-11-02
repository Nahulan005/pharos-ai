import { describe, expect, it } from 'vitest'
import { buildRoadmap, orderSteps, suggestedTrack, toggleCompleted } from './roadmap'
import { roadmapTracks } from '../roadmap/tracks'
import { createDefaultProfile } from '../models/studentProfile'

describe.each(roadmapTracks)('$title scheduling', track => {
  it('orders prerequisites even when editorial data is shuffled', () => {
    const ordered = orderSteps([...track.steps].reverse())
    ordered.forEach((step, i) => step.prerequisites.forEach(id => expect(ordered.findIndex(item => item.id === id)).toBeLessThan(i)))
  })
  it.each([1, 1.01, 2.5, 7, 12, 20])('respects %s hours and reserves at least 20% buffer', hours => {
    const plan = buildRoadmap(track, hours, null)
    for (const week of plan.weeks) {
      expect(week.learningHours + week.bufferHours).toBeLessThanOrEqual(hours + 1e-10)
      expect(week.bufferHours).toBeGreaterThanOrEqual(Math.floor(hours * 60) / 60 * .2 - 1e-10)
      expect(week.learningHours).toBeLessThanOrEqual(hours * .8 + 1e-10)
    }
    expect(plan.weeks.reduce((sum, week) => sum + week.learningHours, 0)).toBeCloseTo(track.steps.reduce((sum, step) => sum + step.hours, 0))
    const sequence = plan.weeks.flatMap(week => week.allocations.map(task => task.stepId))
    track.steps.forEach(step => step.prerequisites.forEach(id => expect(sequence.lastIndexOf(id)).toBeLessThan(sequence.indexOf(step.id))))
  })
  it('removes only completed effort and has no weeks when all steps are complete', () => {
    const complete = track.steps.map(step => step.id)
    expect(buildRoadmap(track, 5, null, complete).weeks).toEqual([])
    expect(buildRoadmap(track, 5, null, [complete[0]]).remainingHours).toBe(track.steps.slice(1).reduce((sum, step) => sum + step.hours, 0))
  })
  it('requires prerequisites and cascades undo', () => {
    expect(() => toggleCompleted(track, [], track.steps[1].id)).toThrow('prerequisites')
    expect(toggleCompleted(track, track.steps.map(step => step.id), track.steps[0].id)).toEqual([])
    expect(toggleCompleted(track, [], track.steps[0].id)).toEqual([track.steps[0].id])
  })
})
const track = roadmapTracks[0]
it.each([null, 0, -1, NaN, Infinity, 21, .5])('rejects missing or invalid weekly hours %s', hours => {
  expect(() => buildRoadmap(track, hours, null)).toThrow('hours')
})
it('handles incomplete preferences and highlights skills without skipping steps', () => {
  expect(suggestedTrack(null)).toBeNull()
  const profile = createDefaultProfile()
  expect(suggestedTrack(profile)).toBeNull()
  profile.careerInterests = ['web_dev']
  expect(suggestedTrack(profile)).toBe('full-stack')
  profile.careerInterests = ['ai_ml']
  profile.skills = [' python ']
  expect(suggestedTrack(profile)).toBe('ai-ml')
  const plan = buildRoadmap(track, 5, profile)
  expect(plan.familiarStepIds).toContain('python-foundations')
  expect(plan.remainingHours).toBe(buildRoadmap(track, 5, null).remainingHours)
})
it('rejects malformed graphs and progress without mutation', () => {
  const steps = structuredClone(track.steps)
  expect(() => orderSteps([...steps, steps[0]])).toThrow('Duplicate')
  steps[0].prerequisites = ['missing']
  expect(() => orderSteps(steps)).toThrow('Unknown')
  steps[0].prerequisites = [steps[1].id]
  expect(() => orderSteps(steps)).toThrow('Circular')
  steps[0].prerequisites = []
  steps[0].hours = -1
  expect(() => orderSteps(steps)).toThrow('effort')
  expect(() => buildRoadmap(track, 5, null, ['missing'])).toThrow('progress')
  expect(() => buildRoadmap(track, 5, null, [track.steps[1].id])).toThrow('progress')
  const before = JSON.stringify(track)
  buildRoadmap(track, 5, null)
  expect(JSON.stringify(track)).toBe(before)
})
