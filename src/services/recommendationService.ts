import type { MatchResult } from '../../shared/contract'
import { matchOpportunities } from '../lib/matching'
import { validateStudentProfile } from '../models/studentProfile'
import type { StudentProfile } from '../models/studentProfile'
import { getAll } from './opportunityService'

/** Replace this implementation with an API call later; consumers await MatchResult[]. */
export async function getRecommendations(profile: StudentProfile | null, now = new Date()): Promise<MatchResult[]> {
  if (profile === null) return []
  const validated = validateStudentProfile(profile)
  if (!validated.valid) throw new Error('A valid saved profile is required for personalized matching.')
  const opportunities = await getAll()
  return matchOpportunities(opportunities, validated.profile, now)
}
