import type { RoadmapProgress } from '../models/roadmap'
import { roadmapTracks } from '../roadmap/tracks'
import { validateCompleted } from '../lib/roadmap'

export const ROADMAP_STORAGE_KEY = 'pharos:roadmap:v1'
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export const emptyProgress = (): RoadmapProgress => ({ version: 1, completed: { 'ai-ml': [], 'full-stack': [] } })
export function validProgress(value: unknown): value is RoadmapProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  if (data.version !== 1 || Object.keys(data).sort().join() !== 'completed,version'
    || !data.completed || typeof data.completed !== 'object' || Array.isArray(data.completed)) return false
  const completed = data.completed as Record<string, unknown>
  return Object.keys(completed).sort().join() === 'ai-ml,full-stack' && roadmapTracks.every(track => {
    const ids = completed[track.id]
    return Array.isArray(ids) && ids.every(id => typeof id === 'string') && validateCompleted(track, ids)
  })
}
export function loadProgress(storage?: StoragePort): { status: 'saved' | 'empty' | 'corrupt' | 'unavailable'; progress: RoadmapProgress } {
  let raw: string | null
  try { raw = (storage ?? window.localStorage).getItem(ROADMAP_STORAGE_KEY) }
  catch { return { status: 'unavailable', progress: emptyProgress() } }
  if (raw === null) return { status: 'empty', progress: emptyProgress() }
  try {
    const value: unknown = JSON.parse(raw)
    if (validProgress(value)) return { status: 'saved', progress: value }
  } catch { /* Leave malformed data untouched until explicit reset. */ }
  return { status: 'corrupt', progress: emptyProgress() }
}
export function saveProgress(progress: RoadmapProgress, storage?: StoragePort): boolean {
  if (!validProgress(progress)) return false
  try { (storage ?? window.localStorage).setItem(ROADMAP_STORAGE_KEY, JSON.stringify(progress)); return true }
  catch { return false }
}
/** Reset removes roadmap progress only, across both tracks. */
export function resetProgress(storage?: StoragePort): boolean {
  try { (storage ?? window.localStorage).removeItem(ROADMAP_STORAGE_KEY); return true }
  catch { return false }
}
