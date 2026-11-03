import { useCallback } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { getById } from '../services/opportunityService'
import { useClock, useResource } from '../hooks/useResource'
import { applicabilityLabel, categoryLabels, costLabels, deadlineLabel, formatDate, safeSourceUrl, sourceLabels, topicLabels, verificationLabels } from '../lib/opportunities'
import { DemoNotice, ErrorState, LoadingState, NotFound } from '../components/States'
import { Icon } from '../components/Icon'
import { OpportunityExplanation } from '../components/OpportunityExplanation'

export default function OpportunityDetails() {
  const { id = '' } = useParams()
  return <DetailContent key={id} id={id} />
}
function DetailContent({ id }: { id: string }) {
  const load = useCallback(() => getById(id), [id])
  const { resource, retry } = useResource(load)
  const { search } = useLocation()
  const now = useClock()
  if (resource.status === 'loading') return <LoadingState />
  if (resource.status === 'error') return <ErrorState retry={retry} />
  const item = resource.data
  if (!item) return <NotFound opportunity search={search} />
  const url = safeSourceUrl(item.sourceUrl)
  return <>
    <Link className="back-link" to={`/explore${search}`}>← Back to Explorer</Link>
    <header className="detail-heading"><p className="eyebrow">{categoryLabels[item.category]}</p><div className="card-badges">{item.verificationStatus === 'demo' && <span className="badge badge-demo">[DEMO] · Fictional opportunity</span>}<span className="badge">{costLabels[item.cost]}</span></div><h1>{item.title}</h1><p>{item.provider}</p></header>
    {item.verificationStatus === 'demo' && <DemoNotice />}
    <div className="details-grid"><div className="detail-main">
      <OpportunityExplanation id={item.id} />
      <section className="detail-panel"><h2>About this opportunity</h2><p>{item.summary}</p><div className="topic-list">{item.topics.map(topic => <span className="badge" key={topic}>{topicLabels[topic]}</span>)}</div></section>
      <section className="detail-panel"><h2>Who it’s for</h2><p>{item.eligibilitySummary}</p><dl className="facts-list"><div><dt>Applicability</dt><dd>{applicabilityLabel(item)}</dd></div><div><dt>Cost</dt><dd>{costLabels[item.cost]}</dd></div></dl><p className="small-note">Applicability describes the recorded scope, not a decision about your personal eligibility.</p></section>
      <section className="detail-panel"><h2>Dates & timing</h2><p className="deadline-detail"><Icon name="clock" />{deadlineLabel(item.deadline, now)}</p>{item.deadline.note && <p>{item.deadline.note}</p>}<p className="small-note">Fixed deadlines are valid through the end of the stated date in India (IST). A deadline that has not passed does not guarantee applications are open. Rolling and expected annual dates must be confirmed with the provider.</p></section>
      {item.tags.length > 0 && <section className="detail-panel"><h2>Tags</h2><div className="topic-list">{item.tags.map(tag => <span className="badge" key={tag}>#{tag}</span>)}</div></section>}
    </div><aside className="detail-panel source-panel" aria-labelledby="source-title"><span className="category-icon"><Icon name="shield" /></span><h2 id="source-title">Know your source</h2><dl className="facts-list"><div><dt>Verification</dt><dd>{verificationLabels[item.verificationStatus]}</dd></div><div><dt>Source type</dt><dd>{sourceLabels[item.sourceType]}</dd></div><div><dt>Source name</dt><dd>{item.sourceName ?? 'Not provided'}</dd></div><div><dt>Last checked</dt><dd>{formatDate(item.lastVerifiedAt)}</dd></div><div><dt>Checked by</dt><dd>{item.verifiedBy ?? 'Not provided'}</dd></div></dl><p className="small-note">“Checked against source” means manually reviewed against a source. It does not guarantee eligibility, accuracy today or availability.</p>{url ? <a className="button button-primary" href={url} target="_blank" rel="noopener noreferrer">Visit source <Icon name="external" /><span className="sr-only"> (opens in a new tab)</span></a> : <div className="no-source"><Icon name="info" />No valid source link available.</div>}</aside></div>
  </>
}
