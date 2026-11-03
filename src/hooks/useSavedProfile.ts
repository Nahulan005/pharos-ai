import { useEffect, useState } from 'react'
import { loadProfile, PROFILE_STORAGE_KEY } from '../services/profileStorage'

/** Re-read on navigation/mount, tab focus and changes from another browser tab. */
export function useSavedProfile() {
  const [saved, setSaved] = useState(() => loadProfile())
  useEffect(() => {
    const refresh = () => {
      const next = loadProfile()
      setSaved(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === PROFILE_STORAGE_KEY || event.key === null) refresh()
    }
    const onVisible = () => { if (!document.hidden) refresh() }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return saved
}
