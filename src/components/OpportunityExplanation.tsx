import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSavedProfile } from '../hooks/useSavedProfile'
import type { StudentProfile } from '../models/studentProfile'
import { AIRequestError, explainOpportunity } from '../services/aiClient'

export function OpportunityExplanation({ id }: { id: string }) {
  const saved = useSavedProfile()
  const profile = saved.status === 'saved' ? saved.profile : null
  return <Explanation key={`${id}:${JSON.stringify(profile)}`} id={id} profile={profile} />
}

function Explanation({ id, profile }: { id: string; profile: StudentProfile | null }) {
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => { active.current?.abort() }, [])
  async function request() {
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    setLoading(true); setError(''); setAnswer('')
    try {
      const result = await explainOpportunity(id, profile, controller.signal)
      if (!controller.signal.aborted) setAnswer(result.answer)
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof AIRequestError ? error.message : 'Could not load an explanation. Try again.')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }
  return <section className="detail-panel" aria-labelledby="explanation-title">
    <h2 id="explanation-title">Why might this be relevant to me?</h2>
    <p>This optional action sends your saved interests, skills and weekly learning hours to the PHAROS backend and its AI service. It does not confirm eligibility or review the opportunity.</p>
    {!profile && <p>No saved profile is available. You can request a general explanation or <Link to="/profile">save your preferences</Link> first.</p>}
    <button type="button" className="button button-primary" disabled={loading} onClick={() => void request()}>{loading ? 'Preparing explanation…' : 'Explain relevance with AI'}</button>
    {loading && <button type="button" className="button button-secondary" onClick={() => { active.current?.abort(); setLoading(false) }}>Cancel</button>}
    {error && <p role="alert">{error}</p>}
    <div role="status" aria-live="polite">{answer && <><p className="small-note">Guidance from recorded information, not verified evidence grounding.</p><p style={{ whiteSpace: 'pre-wrap' }}>{answer}</p></>}</div>
  </section>
}
