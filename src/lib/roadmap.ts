import type { StudentProfile } from '../models/studentProfile'
import type { RoadmapPlan, RoadmapStep, RoadmapTrack, TrackId } from '../models/roadmap'

export const MIN_WEEKLY_HOURS = 1
export const MAX_WEEKLY_HOURS = 20
export const BUFFER_FRACTION = 0.2
export function suggestedTrack(profile: StudentProfile | null): TrackId | null {
  if (profile?.careerInterests.includes('ai_ml')) return 'ai-ml'
  if (profile?.careerInterests.includes('web_dev')) return 'full-stack'
  return null
}

/** Stable topological order; invalid editorial graphs fail rather than silently skipping prerequisites. */
export function orderSteps(steps: RoadmapStep[]): RoadmapStep[] {
  const byId = new Map(steps.map(step => [step.id, step]))
  if (byId.size !== steps.length) throw new Error('Duplicate roadmap step IDs.')
  const ordered: RoadmapStep[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(id: string) {
    const step = byId.get(id)
    if (!step) throw new Error(`Unknown prerequisite: ${id}`)
    if (visiting.has(id)) throw new Error('Circular roadmap prerequisites.')
    if (visited.has(id)) return
    if (!Number.isFinite(step.hours) || step.hours <= 0) throw new Error('Invalid step effort.')
    visiting.add(id)
    step.prerequisites.forEach(visit)
    visiting.delete(id)
    visited.add(id)
    ordered.push(step)
  }
  steps.forEach(step => visit(step.id))
  return ordered
}

export function validateCompleted(track: RoadmapTrack, completed: string[]): boolean {
  return new Set(completed).size === completed.length && completed.every(id => {
    const step = track.steps.find(item => item.id === id)
    return step && step.prerequisites.every(prerequisite => completed.includes(prerequisite))
  })
}

/** Undoing a prerequisite also reopens all its dependent milestones. */
export function toggleCompleted(track: RoadmapTrack, completed: string[], id: string): string[] {
  const step = track.steps.find(item => item.id === id)
  if (!step || !validateCompleted(track, completed)) throw new Error('Invalid progress.')
  const next = new Set(completed)
  if (next.has(id)) {
    next.delete(id)
    for (const item of orderSteps(track.steps)) {
      if (item.prerequisites.some(prerequisite => !next.has(prerequisite))) next.delete(item.id)
    }
  } else {
    if (!step.prerequisites.every(prerequisite => next.has(prerequisite))) throw new Error('Complete prerequisites first.')
    next.add(id)
  }
  return [...next]
}

export function buildRoadmap(track: RoadmapTrack, weeklyHours: number | null, profile: StudentProfile | null, completed: string[] = []): RoadmapPlan {
  if (weeklyHours === null || !Number.isFinite(weeklyHours) || weeklyHours < MIN_WEEKLY_HOURS || weeklyHours > MAX_WEEKLY_HOURS) {
    throw new Error('Enter between 1 and 20 available hours per week. No weekly hours are assumed.')
  }
  if (!validateCompleted(track, completed)) throw new Error('Invalid roadmap progress.')
  // Work in minutes to avoid cumulative floating-point over-allocation.
  const budget = Math.floor(weeklyHours * 60)
  const capacity = Math.floor(budget * (1 - BUFFER_FRACTION))
  const steps = orderSteps(track.steps).filter(step => !completed.includes(step.id))
  const weeks: RoadmapPlan['weeks'] = []
  for (const step of steps) {
    let remaining = Math.ceil(step.hours * 60)
    while (remaining > 0) {
      let week = weeks.at(-1)
      if (!week || Math.round(week.learningHours * 60) >= capacity) {
        week = { number: weeks.length + 1, allocations: [], learningHours: 0, bufferHours: budget / 60 }
        weeks.push(week)
      }
      const used = Math.round(week.learningHours * 60)
      const minutes = Math.min(remaining, capacity - used)
      week.allocations.push({ stepId: step.id, hours: minutes / 60 })
      week.learningHours = (used + minutes) / 60
      week.bufferHours = (budget - used - minutes) / 60
      remaining -= minutes
    }
  }
  const skills = new Set(profile?.skills.map(skill => skill.trim().toLowerCase()) ?? [])
  return { track, weeklyHours, weeks, remainingHours: steps.reduce((sum, step) => sum + step.hours, 0),
    familiarStepIds: track.steps.filter(step => step.skills.some(skill => skills.has(skill.toLowerCase()))).map(step => step.id) }
}
