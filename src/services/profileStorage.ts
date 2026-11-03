import { createDefaultProfile, validateStudentProfile } from '../models/studentProfile'
import type { ProfileErrors, StudentProfile } from '../models/studentProfile'

export const PROFILE_STORAGE_KEY = 'pharos:profile:v1'
export type ProfileStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ProfileLoadResult = {
  status: 'saved' | 'empty' | 'corrupt' | 'unavailable'
  profile: StudentProfile
}
export type ProfileSaveResult =
  | { ok: true; profile: StudentProfile }
  | { ok: false; kind: 'validation'; errors: ProfileErrors }
  | { ok: false; kind: 'storage'; message: string }

// Access localStorage inside try/catch: even its getter can throw when blocked.
export function loadProfile(storage?: ProfileStorage): ProfileLoadResult {
  let raw: string | null
  try {
    raw = (storage ?? window.localStorage).getItem(PROFILE_STORAGE_KEY)
  } catch {
    return { status: 'unavailable', profile: createDefaultProfile() }
  }
  if (raw === null) return { status: 'empty', profile: createDefaultProfile() }
  try {
    const validation = validateStudentProfile(JSON.parse(raw))
    if (validation.valid) return { status: 'saved', profile: validation.profile }
  } catch {
    // Never remove or replace damaged data automatically.
  }
  return { status: 'corrupt', profile: createDefaultProfile() }
}

export function saveProfile(value: unknown, storage?: ProfileStorage): ProfileSaveResult {
  const validation = validateStudentProfile(value)
  if (!validation.valid) return { ok: false, kind: 'validation', errors: validation.errors }
  try {
    (storage ?? window.localStorage).setItem(PROFILE_STORAGE_KEY, JSON.stringify(validation.profile))
    return { ok: true, profile: validation.profile }
  } catch {
    return { ok: false, kind: 'storage', message: 'Could not save preferences. Browser storage may be blocked or full. Your edits are still here; try saving again.' }
  }
}

export function clearProfile(storage?: ProfileStorage): { ok: true } | { ok: false; message: string } {
  try {
    (storage ?? window.localStorage).removeItem(PROFILE_STORAGE_KEY)
    return { ok: true }
  } catch {
    return { ok: false, message: 'Could not clear saved preferences. Browser storage may be blocked. No changes were made to this form.' }
  }
}
