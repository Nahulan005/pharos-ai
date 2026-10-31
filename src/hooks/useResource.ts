import { useEffect, useState } from 'react'

type Resource<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T }

export function useResource<T>(load: () => Promise<T>) {
  const [resource, setResource] = useState<Resource<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setResource({ status: 'loading' })
    Promise.resolve().then(load).then(
      data => { if (active) setResource({ status: 'ready', data }) },
      () => { if (active) setResource({ status: 'error' }) },
    )
    return () => { active = false }
  }, [load, attempt])
  return { resource, retry: () => setAttempt(value => value + 1) }
}
export function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const update = () => setNow(new Date())
    const timer = window.setInterval(update, 1000)
    document.addEventListener('visibilitychange', update)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update) }
  }, [])
  return now
}
