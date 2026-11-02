import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSavedProfile } from '../hooks/useSavedProfile'
import { useResource } from '../hooks/useResource'
import type { RoadmapPlan, TrackId } from '../models/roadmap'
import { roadmapTracks } from '../roadmap/tracks'
import { suggestedTrack, toggleCompleted } from '../lib/roadmap'
import { getRoadmap, getRoadmapOpportunities } from '../services/roadmapService'
import { emptyProgress, loadProgress, resetProgress, ROADMAP_STORAGE_KEY, saveProgress } from '../services/roadmapStorage'

const formatHours = (hours: number) => `${Number(hours.toFixed(2))}h`

function RelatedOpportunities({ trackId }: { trackId: TrackId }) {
  const load = useCallback(() => getRoadmapOpportunities(trackId), [trackId])
  const { resource, retry } = useResource(load)
  return <section className="roadmap-panel"><h2>Related PHAROS learning opportunities</h2>
    {resource.status === 'loading' ? <p role="status">Checking available records…</p> : resource.status === 'error' ? <><p>Opportunities could not be loaded. Your plan is still available.</p><button className="button button-secondary" onClick={retry}>Retry opportunities</button></> : resource.data.length ? <><p>Topic matches only. Confirm eligibility, costs and current availability with the provider.</p><ul>{resource.data.map(item => <li key={item.id}><Link to={`/explore/${encodeURIComponent(item.id)}`}>{item.title}</Link></li>)}</ul></> : <p>No source-checked, non-demo courses match this track in the current data. Fictional demos are not learning resources. <Link to="/explore">Browse the Explorer</Link>.</p>}
  </section>
}

function WeeklyPlan({ plan }: { plan: RoadmapPlan }) {
  const [page, setPage] = useState(0)
  const count = Math.ceil(plan.weeks.length / 8)
  const titles = new Map(plan.track.steps.map(step => [step.id, step.title]))
  return <section className="roadmap-panel"><h2>Weekly plan from your next study week</h2><p>Follow tasks in the listed order. Keep at least one day free; spread learning across the other days. Unused time stays available for rest or catch-up.</p>
    <div className="roadmap-weeks">{plan.weeks.slice(page * 8, page * 8 + 8).map(week => <article key={week.number}><h3>Week {week.number}</h3><ul>{week.allocations.map(task => <li key={task.stepId}>{titles.get(task.stepId)} <strong>{formatHours(task.hours)}</strong></li>)}</ul><p>{formatHours(week.learningHours)} learning · {formatHours(week.bufferHours)} buffer / rest</p></article>)}</div>
    {count > 1 && <div className="roadmap-pagination"><button className="button button-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous weeks</button><span role="status">Page {page + 1} of {count}</span><button className="button button-secondary" disabled={page === count - 1} onClick={() => setPage(page + 1)}>Next weeks</button></div>}
  </section>
}

export default function Roadmap() {
  const saved = useSavedProfile()
  const profile = saved.status === 'saved' ? saved.profile : null
  const [trackOverride, setTrackOverride] = useState<TrackId | '' | null>(null)
  const [hoursOverride, setHoursOverride] = useState<string | null>(null)
  const trackId = trackOverride ?? suggestedTrack(profile) ?? ''
  const hours = hoursOverride ?? (profile?.weeklyLearningHours?.toString() ?? '')
  const weeklyHours = hours.trim() ? Number(hours) : null
  const hoursValid = weeklyHours !== null && Number.isFinite(weeklyHours) && weeklyHours >= 1 && weeklyHours <= 20
  const [stored, setStored] = useState(loadProgress)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const refresh = () => setStored(loadProgress())
    const changed = (event: StorageEvent) => { if (event.key === ROADMAP_STORAGE_KEY || event.key === null) refresh() }
    window.addEventListener('storage', changed)
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('storage', changed); window.removeEventListener('focus', refresh) }
  }, [])
  const progress = stored.progress
  const completed = trackId ? progress.completed[trackId] : []
  const planKey = JSON.stringify([trackId, weeklyHours, profile, completed])
  const request = useMemo(() => trackId && hoursValid ? { trackId, weeklyHours, profile, completed: progress.completed[trackId] } : null, [trackId, hoursValid, weeklyHours, profile, progress])
  const load = useCallback(async () => ({ key: planKey, plan: request ? await getRoadmap(request) : null }), [planKey, request])
  const { resource, retry } = useResource(load)
  const plan = resource.status === 'ready' && resource.data.key === planKey ? resource.data.plan : null
  const track = roadmapTracks.find(item => item.id === trackId)
  function toggle(id: string) {
    if (!track || stored.status === 'corrupt' || stored.status === 'unavailable') return
    const next = { ...progress, completed: { ...progress.completed, [track.id]: toggleCompleted(track, completed, id) } }
    if (saveProgress(next)) { setStored({ status: 'saved', progress: next }); setMessage('Progress saved in this browser. Your remaining plan has been updated.') }
    else setMessage('Could not save progress. Browser storage may be blocked or full. No progress was changed; try again.')
  }
  function reset() {
    if (!window.confirm('Reset roadmap progress for both tracks? Your student profile will stay unchanged.')) return
    if (resetProgress()) { setStored({ status: 'empty', progress: emptyProgress() }); setMessage('Roadmap progress reset for both tracks.') }
    else setMessage('Could not reset progress. Browser storage may be blocked. Your progress was kept.')
  }
  return <>
    <header className="page-heading"><p className="eyebrow">ONE MILESTONE AT A TIME</p><h1>Career <span>Roadmap</span></h1><p>A practical starting plan, shaped by your interests, skills and available time.</p></header>
    <div className="notice"><p>Curated tracks with deterministic scheduling, not AI-generated advice. All effort and duration estimates are approximate; they do not guarantee mastery, employment or certification.</p></div>
    <section className="roadmap-panel"><h2>Make room for learning</h2><p>{profile ? 'Saved profile preferences are used as a starting point.' : saved.status === 'empty' ? 'No saved profile is required. Choose a track and enter your available hours.' : 'Your saved profile could not be read safely. Choose your preferences here instead.'} Changes here never automatically update your <Link to="/profile">Student Profile</Link>.</p>
      <div className="roadmap-controls"><label>Career track<select value={trackId} onChange={event => setTrackOverride(event.target.value as TrackId | '')}><option value="">Choose a track</option>{roadmapTracks.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label>Available hours per week<input type="number" min="1" max="20" step="any" value={hours} onChange={event => setHoursOverride(event.target.value)} aria-describedby="roadmap-hours-hint" aria-invalid={hours !== '' && !hoursValid} /></label></div>
      <p id="roadmap-hours-hint">Enter 1–20 hours. At least 20% is reserved for buffer / rest. The 20-hour planning cap leaves room for study and other commitments; it is not a recommendation to study that much.</p>
      {!hoursValid && <p role="status">{hours === '' ? 'Enter your available weekly hours to generate a plan. No hours are assumed.' : 'Use a weekly budget between 1 and 20 hours. Your saved profile will not be changed.'}</p>}
      {profile && <p>Saved skills: {profile.skills.length ? profile.skills.join(', ') : 'not specified'}. Exact skill matches highlight milestones to review; they never skip prerequisites or prove proficiency.</p>}
      {profile && <button className="button button-secondary" onClick={() => { setTrackOverride(null); setHoursOverride(null) }}>Use saved profile preferences</button>}
    </section>
    <section className="roadmap-panel"><div className="roadmap-progress-heading"><div><h2>Your progress</h2><p>Stored only in this browser under pharos:roadmap:v1. Both tracks are saved separately. Unchecking a prerequisite reopens dependent steps.</p></div><button className="button button-secondary" onClick={reset}>Reset all roadmap progress</button></div>
      {(stored.status === 'corrupt' || stored.status === 'unavailable') && <p role="alert">{stored.status === 'corrupt' ? 'Saved progress is invalid. It has not been overwritten. Reset it explicitly to enable saving.' : 'Browser storage is unavailable. You can view a plan, but cannot save progress. Enable storage and reload.'}</p>}
      <p role="status">{message}</p>{track && <><progress max={track.steps.length} value={completed.length} aria-label="Completed milestones" /><p>{completed.length} of {track.steps.length} milestones completed</p></>}
    </section>
    {trackId && hoursValid && (resource.status === 'error' ? <div className="state-panel" role="alert"><h2>Could not build your plan</h2><button className="button button-primary" onClick={retry}>Retry plan</button></div> : !plan ? <p role="status">Preparing your roadmap…</p> : <>
      <section className="roadmap-panel"><h2>{plan.track.title}</h2><p>{plan.track.description}</p><p><strong>{plan.weeks.length ? `Approximately ${plan.weeks.length} weeks · ${formatHours(plan.remainingHours)} remaining learning effort` : 'All milestones complete — revisit any step to keep practising.'}</strong></p><p>Weeks are relative, not calendar deadlines. The full effort remains until you mark a milestone complete. Documentation links are references, not promises of complete courses or credentials; use additional help where foundations are unfamiliar.</p></section>
      <ol className="roadmap-timeline">{plan.track.steps.map((step, index) => {
        const done = completed.includes(step.id)
        const locked = step.prerequisites.some(id => !completed.includes(id))
        return <li key={step.id} className={done ? 'is-complete' : ''}><span className="roadmap-number" aria-hidden="true">{done ? '✓' : index + 1}</span><article><p className="eyebrow">{step.prerequisites.length ? `After: ${step.prerequisites.map(id => plan.track.steps.find(item => item.id === id)?.title).join(', ')}` : 'START HERE · FOUNDATIONS'}</p><h2>{step.title}</h2><p>Approximate effort: {step.hours} hours · Skills: {step.skills.join(', ')}</p>
          {plan.familiarStepIds.includes(step.id) && <p className="roadmap-familiar">Matches a saved skill. Review the milestone and demonstrate it before marking complete.</p>}
          <h3>Practice project</h3><p>{step.project}</p><h3>Milestone</h3><p>{step.milestone}</p><h3>Suggested references</h3><ul>{step.resources.map(resource => <li key={resource.url}><a href={resource.url} target="_blank" rel="noopener noreferrer">{resource.title} ↗</a></li>)}</ul>
          <label className="roadmap-complete"><input type="checkbox" checked={done} disabled={locked || stored.status === 'corrupt' || stored.status === 'unavailable'} onChange={() => toggle(step.id)} />Mark {step.title} completed</label>{locked && <p>Complete the prerequisite milestone first.</p>}
        </article></li>
      })}</ol>
      {plan.weeks.length > 0 && <WeeklyPlan key={planKey} plan={plan} />}
    </>)}
    {trackId && <RelatedOpportunities key={trackId} trackId={trackId} />}
  </>
}
