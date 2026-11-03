import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSavedProfile } from '../hooks/useSavedProfile'
import type { StudentProfile } from '../models/studentProfile'
import { AIRequestError, explainOpportunity } from '../services/aiClient'
import { presentChecks, presentExplanation } from '../lib/explanationPresentation'
import type { ExplanationBlock, ExplanationMode } from '../lib/explanationPresentation'
import { Icon } from './Icon'
import type { IconName } from './Icon'

const modeLabels: Record<ExplanationMode, string> = {
  ai: 'AI-assisted relevance', fallback: 'Deterministic fallback',
  demo: 'Deterministic · fictional demo', unknown: 'Explanation received',
}
const insightLabels: Partial<Record<ExplanationBlock['kind'], { title: string; icon: IconName }>> = {
  skill: { title: 'Skill relevance', icon: 'compass' },
  time: { title: 'Your learning time', icon: 'clock' },
  interest: { title: 'Your interests', icon: 'book' },
  limited: { title: 'No direct match established', icon: 'info' },
}

function AnswerBlock({ block }: { block: ExplanationBlock }) {
  const insight = insightLabels[block.kind]
  if (insight) return <div className={`relevance-insight insight-${block.kind}`}>
    <Icon name={insight.icon} />
    <div><h3>{insight.title}</h3><p>{block.text}</p></div>
  </div>
  if (block.kind === 'review') return <p className="relevance-review"><Icon name="shield" /><span>{block.text}</span></p>
  if (block.kind === 'checks') {
    const checks = presentChecks(block.text)
    return <section className="relevance-checks" aria-label="Next checks">
      <h3>Next checks</h3>
      {checks ? <>
        <p>Use the source link to confirm each item with the provider.</p>
        <ul>{checks.items.map(item => <li key={item}>Confirm {item}.</li>)}</ul>
        <p className="relevance-limitation"><Icon name="info" /><span>{checks.limitation}</span></p>
      </> : <p className="relevance-plain">{block.text}</p>}
    </section>
  }
  return <p className="relevance-plain">{block.text}</p>
}

export function OpportunityExplanation({ id }: { id: string }) {
  const saved = useSavedProfile()
  const profile = saved.status === 'saved' ? saved.profile : null
  return <Explanation key={`${id}:${JSON.stringify(profile)}`} id={id} profile={profile} />
}

function Explanation({ id, profile }: { id: string; profile: StudentProfile | null }) {
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const active = useRef<AbortController | null>(null)
  const requestButton = useRef<HTMLButtonElement | null>(null)
  const cancelButton = useRef<HTMLButtonElement | null>(null)
  useEffect(() => () => { active.current?.abort() }, [])
  useEffect(() => { if (loading) cancelButton.current?.focus() }, [loading])
  async function request() {
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    setLoading(true); setError(''); setAnswer(''); setCancelled(false)
    try {
      const result = await explainOpportunity(id, profile, controller.signal)
      if (!controller.signal.aborted) setAnswer(result.answer)
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof AIRequestError ? error.message : 'Could not load an explanation. Try again.')
    } finally {
      if (!controller.signal.aborted) {
        // Keep keyboard focus when the focused cancel action disappears.
        if (document.activeElement === cancelButton.current) requestButton.current?.focus()
        setLoading(false)
      }
    }
  }
  const result = answer ? presentExplanation(answer) : null
  const stateLabel = loading ? 'Preparing explanation' : error ? 'Request failed' : result ? modeLabels[result.mode] : cancelled ? 'Request cancelled' : 'Not requested'

  return <section className="opportunity-panel relevance-panel" aria-labelledby="explanation-title">
    <header className="opportunity-panel-heading">
      <span className="opportunity-panel-icon"><Icon name="compass" /></span>
      <div><h2 id="explanation-title">AI Relevance Analysis</h2><p>Explore how this opportunity relates to your learning goals.</p></div>
    </header>
    <div className="relevance-state-row">
      <span className={`explanation-state state-${loading ? 'loading' : error ? 'error' : result?.mode ?? 'initial'}`}>
        {loading ? <span className="spinner" aria-hidden="true" /> : <span className="explanation-state-dot" aria-hidden="true" />}
        {stateLabel}
      </span>
      {profile && <span className="relevance-profile-label">Saved profile available</span>}
    </div>
    <p className="relevance-grounding">This guidance is not grounded in verified evidence. See Source &amp; Verification for the record’s review status.</p>

    {!profile && <p className="relevance-profile-note"><Icon name="profile" /><span><strong>No saved profile.</strong> Explanations can use the opportunity record, but not your interests, skills or learning time. Request general guidance or <Link to="/profile">save your preferences</Link> first.</span></p>}

    <div className="relevance-result" aria-busy={loading}>
      {loading && <div className="relevance-loading"><p>Preparing your explanation…</p><p>Comparing recorded information with {profile ? 'your saved preferences' : 'the available context'}.</p><div className="relevance-loading-lines" aria-hidden="true"><span /><span /><span /></div></div>}
      {error && <div className="relevance-error" role="alert"><Icon name="info" /><div><h3>Couldn’t load the explanation</h3><p>{error}</p></div></div>}
      {!loading && !error && !result && <div className="relevance-empty"><h3>{cancelled ? 'Explanation cancelled' : 'A little context for your next step'}</h3><p>{cancelled ? 'No explanation was added. You can try again when you’re ready.' : profile ? 'Request an explanation to see which recorded details may connect with your saved learning preferences.' : 'Request general guidance on this opportunity and what to check before deciding.'}</p></div>}
      {result && <>
        {result.modeText && <p className="relevance-mode-note">{result.mode === 'ai' ? 'AI selected relevant points from the recorded information. PHAROS templates provide the wording.' : result.modeText}</p>}
        <div className="relevance-blocks">{result.blocks.map((block, index) => <AnswerBlock key={index} block={block} />)}</div>
      </>}
    </div>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{stateLabel}{result ? '. Explanation available below the analysis heading.' : ''}</p>
    <footer className="relevance-actions">
      <div className="relevance-buttons">
        <button ref={requestButton} type="button" className="button button-primary" aria-disabled={loading} onClick={() => { if (!loading) void request() }}><Icon name="compass" />{loading ? 'Preparing explanation…' : 'Explain relevance with AI'}</button>
        {loading && <button ref={cancelButton} type="button" className="button button-secondary" onClick={() => { active.current?.abort(); setLoading(false); setCancelled(true); requestButton.current?.focus() }}>Cancel</button>}
      </div>
      <p>This optional action sends your saved interests, skills and weekly learning hours to the PHAROS backend and its AI service. It does not confirm eligibility or review the opportunity.</p>
    </footer>
  </section>
}
