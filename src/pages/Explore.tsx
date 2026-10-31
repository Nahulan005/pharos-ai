import { useSearchParams } from 'react-router-dom'
import { getAll } from '../services/opportunityService'
import { useClock, useResource } from '../hooks/useResource'
import { categoryLabels, costLabels, filterOpportunities, filtersFromParams } from '../lib/opportunities'
import { OpportunityCard } from '../components/OpportunityCard'
import { DemoNotice, ErrorState, LoadingState } from '../components/States'
import { Icon } from '../components/Icon'

export default function Explore() {
  const { resource, retry } = useResource(getAll)
  const [params, setParams] = useSearchParams()
  const filters = filtersFromParams(params)
  const now = useClock()
  const items = resource.status === 'ready' ? resource.data : []
  const results = filterOpportunities(items, filters)
  const hasFilters = Boolean(filters.query || filters.category !== 'all' || filters.cost !== 'all' || filters.scope !== 'all')
  const search = params.size ? `?${params.toString()}` : ''
  const states = [...new Set(items.flatMap(item => item.applicability.states))].sort()
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
    <section className="filter-panel" aria-label="Search and filter opportunities">
      <label className="search-field"><Icon name="search" /><span className="sr-only">Search titles, providers and tags</span><input type="search" value={filters.query} onChange={event => update('q', event.target.value)} placeholder="Search titles, providers or tags…" /></label>
      <div className="filter-row">
        <label>Category<select value={filters.category} onChange={event => update('category', event.target.value)}><option value="all">All categories</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Cost<select value={filters.cost} onChange={event => update('cost', event.target.value)}><option value="all">Any cost</option>{Object.entries(costLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Applicability<select value={filters.scope} onChange={event => update('scope', event.target.value)}><option value="all">All locations</option><option value="national">National</option><option value="state">State-specific</option><option value="unknown">Unknown applicability</option></select></label>
        <button className="reset-filters" disabled={!hasFilters} onClick={() => setParams({}, { replace: true })}>Reset filters</button>
      </div>
      {filters.scope === 'state' && <div className="state-filter"><label>State name<input list="available-states" value={filters.state} onChange={event => update('state', event.target.value)} placeholder="Enter a state name" aria-describedby="state-hint" /></label><datalist id="available-states">{states.map(state => <option key={state} value={state} />)}</datalist><p id="state-hint">Matches the full state name. National and unknown applicability records are shown separately.</p></div>}
    </section>
    {resource.status === 'loading' ? <LoadingState /> : resource.status === 'error' ? <ErrorState retry={retry} /> : <section aria-label="Opportunity results">
      <div className="results-heading"><p role="status"><strong>{results.length}</strong> {results.length === 1 ? 'opportunity' : 'opportunities'} <span>of {items.length}</span></p><span className="results-note">Explore with context. Decide with confidence.</span></div>
      {results.length ? <div className="opportunity-grid">{results.map(item => <OpportunityCard key={item.id} item={item} now={now} search={search} />)}</div> : <div className="state-panel"><Icon name="search" /><h2>{items.length ? 'No matches just yet' : 'No opportunities available yet'}</h2><p>{items.length ? 'Try another search or loosen your filters. Unknown applicability is never treated as national or state-specific.' : 'Please check back later for new opportunities.'}</p>{hasFilters && <button className="button button-secondary" onClick={() => setParams({}, { replace: true })}>Clear search & filters</button>}</div>}
    </section>}
    <p className="explorer-footnote"><Icon name="shield" />Source checks are a starting point, not a guarantee. Always confirm eligibility and availability with the provider.</p>
  </>
}
