import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProfile } from '../models/studentProfile'
import { clearProfile, loadProfile, PROFILE_STORAGE_KEY, saveProfile } from './profileStorage'
import type { ProfileStorage } from './profileStorage'

function memoryStorage() {
  const values = new Map<string, string>()
  const storage: ProfileStorage = {
    getItem: vi.fn(key => values.get(key) ?? null),
    setItem: vi.fn((key, value) => { values.set(key, value) }),
    removeItem: vi.fn(key => { values.delete(key) }),
  }
  return { storage, values }
}
afterEach(() => vi.unstubAllGlobals())

describe('profile storage', () => {
  it('loads unsaved defaults without writing them', () => {
    const { storage } = memoryStorage()
    expect(loadProfile(storage)).toEqual({ status: 'empty', profile: createDefaultProfile() })
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('saves and reloads a typed profile using the exact versioned key', () => {
    const { storage, values } = memoryStorage()
    const profile = { ...createDefaultProfile(), degreeCourse: 'BTech', yearOfStudy: 2,
      careerInterests: ['ai_ml' as const], skills: ['Python'], weeklyLearningHours: 5, learningIntensity: 'balanced' as const }
    expect(saveProfile(profile, storage)).toEqual({ ok: true, profile })
    expect([...values.keys()]).toEqual(['pharos:profile:v1'])
    expect(loadProfile(storage)).toEqual({ status: 'saved', profile })
  })
  it('persists edits and explicit empty preferences', () => {
    const { storage } = memoryStorage()
    saveProfile(createDefaultProfile(), storage)
    const edited = { ...createDefaultProfile(), state: '', weeklyLearningHours: 0 }
    saveProfile(edited, storage)
    expect(loadProfile(storage).profile).toEqual(edited)
  })
  it('does not replace saved data when validation fails', () => {
    const { storage, values } = memoryStorage()
    saveProfile(createDefaultProfile(), storage)
    const before = values.get(PROFILE_STORAGE_KEY)
    expect(saveProfile({ ...createDefaultProfile(), weeklyLearningHours: -5 }, storage).ok).toBe(false)
    expect(values.get(PROFILE_STORAGE_KEY)).toBe(before)
  })
  it.each(['{broken', 'null', '[]', '{}', '{"state":"Kerala"}', JSON.stringify({ ...createDefaultProfile(), careerInterests: ['bad'] })])('handles corrupted data without deleting it: %s', raw => {
    const { storage, values } = memoryStorage()
    values.set(PROFILE_STORAGE_KEY, raw)
    expect(loadProfile(storage)).toEqual({ status: 'corrupt', profile: createDefaultProfile() })
    expect(values.get(PROFILE_STORAGE_KEY)).toBe(raw)
    expect(storage.removeItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('clears only the profile key and restores unsaved defaults on next load', () => {
    const { storage, values } = memoryStorage()
    values.set('unrelated', 'keep me')
    saveProfile(createDefaultProfile(), storage)
    expect(clearProfile(storage)).toEqual({ ok: true })
    expect(values.has(PROFILE_STORAGE_KEY)).toBe(false)
    expect(values.get('unrelated')).toBe('keep me')
    expect(loadProfile(storage).status).toBe('empty')
    expect(clearProfile(storage).ok).toBe(true)
  })
  it('returns fresh data on each load', () => {
    const { storage } = memoryStorage()
    saveProfile(createDefaultProfile(), storage)
    loadProfile(storage).profile.skills.push('Changed')
    expect(loadProfile(storage).profile.skills).toEqual([])
  })
  it('handles blocked reads, full storage, and failed deletes', () => {
    const blocked = () => { throw new Error('Blocked') }
    const storage: ProfileStorage = { getItem: blocked, setItem: blocked, removeItem: blocked }
    expect(loadProfile(storage).status).toBe('unavailable')
    expect(saveProfile(createDefaultProfile(), storage)).toMatchObject({ ok: false, kind: 'storage' })
    expect(clearProfile(storage).ok).toBe(false)
  })
  it('catches exceptions thrown by the localStorage getter itself', () => {
    vi.stubGlobal('window', Object.defineProperty({}, 'localStorage', { get() { throw new Error('SecurityError') } }))
    expect(loadProfile().status).toBe('unavailable')
    expect(saveProfile(createDefaultProfile()).ok).toBe(false)
    expect(clearProfile().ok).toBe(false)
  })
})
