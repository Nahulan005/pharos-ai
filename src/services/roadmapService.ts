import type { StudentProfile } from '../models/studentProfile'
import type { RoadmapPlan, TrackId } from '../models/roadmap'
import { roadmapTracks } from '../roadmap/tracks'
import { buildRoadmap } from '../lib/roadmap'
import { getAll } from './opportunityService'
import { getDeadlineStatus, safeSourceUrl } from '../lib/opportunities'

export interface RoadmapRequest {
  trackId: TrackId
  weeklyHours: number | null
  profile: StudentProfile | null
  completed: string[]
}
/** Future backend boundary: callers await a typed plan, independent of the engine implementation. */
export async function getRoadmap(request: RoadmapRequest): Promise<RoadmapPlan> {
  const track = roadmapTracks.find(item => item.id === request.trackId)
  if (!track) throw new Error('Unknown career track.')
  return buildRoadmap(structuredClone(track), request.weeklyHours, request.profile, request.completed)
}

/** Only actual, source-checked learning records with exact topic overlap; no demo resources. */
export async function getRoadmapOpportunities(trackId: TrackId, now = new Date()) {
  const track = roadmapTracks.find(item => item.id === trackId)
  if (!track) throw new Error('Unknown career track.')
  return (await getAll()).filter(item => item.category === 'course_cert'
    && item.topics.includes(track.topic) && item.verificationStatus === 'checked_against_source'
    && (item.sourceType === 'official' || item.sourceType === 'provider') && safeSourceUrl(item.sourceUrl)
    && getDeadlineStatus(item.deadline, now) !== 'expired')
}
