import { describe, expect, it } from 'vitest'
import { emptyProgress, loadProgress, resetProgress, ROADMAP_STORAGE_KEY, saveProgress, validProgress } from './roadmapStorage'

function memory() {
  const data = new Map<string, string>()
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}
describe('roadmap progress storage', () => {
  it('saves, reloads and resets both tracks without touching the profile', () => {
    const storage = memory()
    storage.setItem('pharos:profile:v1', 'keep')
    expect(loadProgress(storage).status).toBe('empty')
    const progress = emptyProgress()
    progress.completed['ai-ml'] = ['python-foundations']
    progress.completed['full-stack'] = ['web-foundations']
    expect(saveProgress(progress, storage)).toBe(true)
    expect(loadProgress(storage)).toEqual({ status: 'saved', progress })
    expect(resetProgress(storage)).toBe(true)
    expect(loadProgress(storage).status).toBe('empty')
    expect(storage.getItem('pharos:profile:v1')).toBe('keep')
  })
  it.each(['{', 'null', '[]', '{}', '{"version":2,"completed":{}}'])('preserves corrupt data: %s', raw => {
    const storage = memory()
    storage.setItem(ROADMAP_STORAGE_KEY, raw)
    expect(loadProgress(storage).status).toBe('corrupt')
    expect(storage.getItem(ROADMAP_STORAGE_KEY)).toBe(raw)
  })
  it('rejects unknown IDs, duplicate IDs, skipped prerequisites and unexpected fields', () => {
    for (const ids of [['bad'], ['python-foundations', 'python-foundations'], ['classical-ml']]) {
      const progress = emptyProgress()
      progress.completed['ai-ml'] = ids
      expect(validProgress(progress)).toBe(false)
      expect(saveProgress(progress, memory())).toBe(false)
    }
    expect(validProgress({ ...emptyProgress(), extra: true })).toBe(false)
  })
  it('handles blocked reads, writes and reset', () => {
    const fail = () => { throw new Error('blocked') }
    const storage = { getItem: fail, setItem: fail, removeItem: fail }
    expect(loadProgress(storage).status).toBe('unavailable')
    expect(saveProgress(emptyProgress(), storage)).toBe(false)
    expect(resetProgress(storage)).toBe(false)
  })
})
