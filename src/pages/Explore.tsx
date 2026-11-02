import { useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getAll } from '../services/opportunityService'
import { getRecommendations } from '../services/recommendationService'
import { useClock, useResource } from '../hooks/useResource'
import { useSavedProfile } from '../hooks/useSavedProfile'
import { categoryLabels, costLabels, filterOpportunities, filtersFromParams } from '../lib/opportunities'
import { OpportunityCard } from '../components/OpportunityCard'
import { DemoNotice, ErrorState, LoadingState } from '../components/States'
import { Icon } from '../components/Icon'

export default function Explore() {
  const { resource, retry } = useResource(getAll)
  const [params, setParams] = useSearchParams()
  const filters = filtersFromParams(params)
  const now = useClock()
  const savedProfile = useSavedProfile()
  const forYou = params.get('view') === 'for-you'
  // Never use loadProfile's unsaved defaults as a student's saved preferences.
  const matchingProfile = forYou && savedProfile.status === 'saved' ? savedProfile.profile : null
  const matchingDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
  const loadMatches = useCallback(async () => ({
    profile: matchingProfile,
    day: matchingDay,
    matches: matchingProfile ? await getRecommendations(matchingProfile) : [],
  }), [matchingProfile, matchingDay])
  const { resource: matching, retry: retryMatching } = useResource(loadMatches)
  // A response for an older profile must never briefly appear as the new one.
  const matchingReady = matching.status === 'ready' && matching.data.profile === matchingProfile && matching.data.day === matchingDay
  const matches = matchingReady && matchingProfile ? matching.data.matches : []
  const matchById = new Map(matches.map(match => [match.opportunityId, match]))
  const items = resource.status === 'ready' ? resource.data : []
  const itemById = new Map(items.map(item => [item.id, item]))
  const rankedItems = matchingProfile && matchingReady
    ? matches.flatMap(match => { const item = itemById.get(match.opportunityId); return item ? [item] : [] })
    : items
  const results = filterOpportunities(rankedItems, filters)
  const hasFilters = Boolean(filters.query || filters.category !== 'all' || filters.cost !== 'all' || filters.scope !== 'all')
  const search = params.size ? `?${params.toString()}` : ''
  const states = [...new Set(items.flatMap(item => item.applicability.states))].sort()
  function setView(personalized: boolean) {
    const next = new URLSearchParams(params)
    if (personalized) next.set('view', 'for-you')
    else next.delete('view')
    setParams(next, { replace: true })
  }
  function clearFilters() {
    const next = new URLSearchParams(params)
    for (const key of ['q', 'category', 'cost', 'scope', 'state']) next.delete(key)
    setParams(next, { replace: true })
  }
  function update(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (!value || (value === 'all' && key !== 'q' && key !== 'state')) next.delete(key)
    else next.set(key, value)
    if (key === 'scope') next.delete('state')
    setParams(next, { replace: true })
  }
  return <>
    <header className="page-heading"><p className="eyebrow">YOUR NEXT POSSIBILITY</p><h1>Opportunity <span>Explorer</span></h1><p>Find a little support. Learn something new. See where it takes you.</p></header>
    {items.some(item => item.verificationStatus === 'demo') && <DemoNotice />}
    <section className="personalization-panel" aria-label="Personalized opportunity matching">
      <div className="explorer-views" role="group" aria-label="Opportunity view">
        <button type="button" aria-pressed={!forYou} onClick={() => setView(false)}>All opportunities</button>
        <button type="button" aria-pressed={forYou} onClick={() => setView(true)}><Icon name="compass" />For you</button>
      </div>
      {savedProfile.status === 'saved' ? <div className="personalization-copy">
        <div><h2>{forYou ? 'A starting point, shaped by your profile' : 'Bring your interests into focus'}</h2>
          <p>{forYou ? 'Ranked by your saved interests, state and the available opportunity information. Lower relevance results are kept visible.' : 'Choose For you to see relevance and explanations based on your saved preferences. All opportunities stays available.'}</p>
          {(!savedProfile.profile.careerInterests.length || !savedProfile.profile.state) && <p className="matching-limited">Your profile is incomplete: adding interests and a state can improve relevance. Missing details are never guessed.</p>}
        </div><Link className="text-link" to="/profile">Edit profile <Icon name="arrow" /></Link>
      </div> : <div className="personalization-copy">
        <div><h2>{savedProfile.status === 'corrupt' ? 'Your saved profile needs attention' : savedProfile.status === 'unavailable' ? 'Saved preferences are unavailable' : 'Explore freely. Personalize when you’re ready.'}</h2>
          <p>{savedProfile.status === 'corrupt' ? 'Saved preferences could not be read safely. No defaults are being used to personalize these results.' : savedProfile.status === 'unavailable' ? 'Browser storage could not be read. These results are not personalized.' : 'Save optional interests and a state to see relevance explanations. A profile is never required to browse.'} {forYou && 'Showing all opportunities for now.'}</p>
        </div><Link className="text-link" to="/profile">{savedProfile.status === 'corrupt' ? 'Review profile' : 'Set preferences'} <Icon name="arrow" /></Link>
      </div>}
      {forYou && <details className="matching-method"><summary>How relevance works</summary><p>Topic overlap is the strongest signal; matching state or national applicability adds a smaller signal. Free options receive a modest boost, while paid options rank below equivalent free ones. No budget is inferred from your profile.</p><p>State mismatches and passed fixed deadlines are ranked low. Missing eligibility, cost, timing or profile details limit confidence; fictional and unreviewed records cannot receive high relevance. Recorded eligibility is shown for you to check, not interpreted as proof that you qualify. Skills, available hours and intensity are not scored because opportunities do not provide comparable requirements.</p><p>These are deterministic comparisons, not AI advice. Relevance never guarantees scholarship eligibility or availability.</p></details>}
    </section>
    <section className="filter-panel" aria-label="Search and filter opportunities">
      <label className="search-field"><Icon name="search" /><span className="sr-only">Search titles, providers and tags</span><input type="search" value={filters.query} onChange={event => update('q', event.target.value)} placeholder="Search titles, providers or tags…" /></label>
      <div className="filter-row">
        <label>Category<select value={filters.category} onChange={event => update('category', event.target.value)}><option value="all">All categories</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Cost<select value={filters.cost} onChange={event => update('cost', event.target.value)}><option value="all">Any cost</option>{Object.entries(costLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Applicability<select value={filters.scope} onChange={event => update('scope', event.target.value)}><option value="all">All locations</option><option value="national">National</option><option value="state">State-specific</option><option value="unknown">Unknown applicability</option></select></label>
        <button className="reset-filters" disabled={!hasFilters} onClick={clearFilters}>Reset filters</button>
      </div>
      {filters.scope === 'state' && <div className="state-filter"><label>State name<input list="available-states" value={filters.state} onChange={event => update('state', event.target.value)} placeholder="Enter a state name" aria-describedby="state-hint" /></label><datalist id="available-states">{states.map(state => <option key={state} value={state} />)}</datalist><p id="state-hint">Matches the full state name. National and unknown applicability records are shown separately.</p></div>}
    </section>
    {resource.status === 'loading' ? <LoadingState /> : resource.status === 'error' ? <ErrorState retry={retry} />
      : matchingProfile && matching.status === 'error' ? <div className="state-panel" role="alert"><Icon name="info" /><h2>We couldn’t compare your preferences</h2><p>You can retry or keep browsing all opportunities.</p><div className="matching-actions"><button className="button button-primary" onClick={retryMatching}>Retry matching</button><button className="button button-secondary" onClick={() => setView(false)}>View all opportunities</button></div></div>
      : matchingProfile && !matchingReady ? <div className="state-panel" role="status"><span className="spinner" /><h2>Comparing your saved preferences</h2><p>Checking the available information.</p></div>
      : <section aria-label="Opportunity results">
      <div className="results-heading"><p role="status"><strong>{results.length}</strong> {results.length === 1 ? 'opportunity' : 'opportunities'} <span>of {items.length}</span></p><span className="results-note">{matchingProfile ? 'Sorted by relevance · eligibility unconfirmed' : 'Explore with context. Decide with confidence.'}</span></div>
      {results.length ? <div className={`opportunity-grid${matchingProfile ? ' is-personalized' : ''}`}>{results.map(item => <OpportunityCard key={item.id} item={item} now={now} search={search} match={matchById.get(item.id)} />)}</div> : <div className="state-panel"><Icon name="search" /><h2>{items.length ? 'No matches just yet' : 'No opportunities available yet'}</h2><p>{items.length ? 'Try another search or loosen your filters. Unknown applicability is never treated as national or state-specific.' : 'Please check back later for new opportunities.'}</p>{hasFilters && <button className="button button-secondary" onClick={clearFilters}>Clear search & filters</button>}</div>}
    </section>}
    <p className="explorer-footnote"><Icon name="shield" />Source checks are a starting point, not a guarantee. Always confirm eligibility and availability with the provider.</p>
  </>
}
