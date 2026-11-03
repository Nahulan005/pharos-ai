import type { Topic } from '../../shared/contract'

export type TrackId = 'ai-ml' | 'full-stack'
export interface RoadmapStep {
  id: string
  title: string
  skills: string[]
  prerequisites: string[]
  hours: number
  project: string
  milestone: string
  resources: { title: string; url: string }[]
}
export interface RoadmapTrack {
  id: TrackId
  title: string
  topic: Topic
  description: string
  steps: RoadmapStep[]
}
export interface RoadmapWeek {
  number: number
  allocations: { stepId: string; hours: number }[]
  learningHours: number
  bufferHours: number
}
export interface RoadmapPlan {
  track: RoadmapTrack
  weeklyHours: number
  weeks: RoadmapWeek[]
  remainingHours: number
  familiarStepIds: string[]
}
export interface RoadmapProgress {
  version: 1
  completed: Record<TrackId, string[]>
}
