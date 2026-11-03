import { useCallback } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { getById } from '../services/opportunityService'
import { useClock, useResource } from '../hooks/useResource'
import { applicabilityLabel, categoryLabels, costLabels, deadlineLabel, formatDate, safeSourceUrl, sourceLabels, topicLabels, verificationLabels } from '../lib/opportunities'
import { DemoNotice, ErrorState, LoadingState, NotFound } from '../components/States'
import { Icon } from '../components/Icon'
import { OpportunityExplanation } from '../components/OpportunityExplanation'
import './OpportunityDetails.css'

export default function OpportunityDetails() {
  const { id = '' } = useParams()
  return <DetailContent key={id} id={id} />
}
function DetailContent({ id }: { id: string }) {
  const load = useCallback(() => getById(id), [id])
  const { resource, retry } = useResource(load)
  const { search } = useLocation()
  const now = useClock()
  const back = <Link className="opportunity-back" to={`/explore${search}`}><Icon name="arrow" />Back to opportunities</Link>
  if (resource.status === 'loading') return <div className="opportunity-detail">{back}<LoadingState /></div>
  if (resource.status === 'error') return <div className="opportunity-detail">{back}<ErrorState retry={retry} /></div>
  const item = resource.data
  if (!item) return <NotFound opportunity search={search} />
  const url = safeSourceUrl(item.sourceUrl)
  return <div className="opportunity-detail">
    {back}
    <header className="opportunity-heading">
      <p className="opportunity-eyebrow">Opportunity overview</p>
      <h1>{item.title}</h1>
      <div className="opportunity-metadata">
        <span className="opportunity-provider"><Icon name={item.category === 'software_perk' ? 'software' : 'scholarship'} />{item.provider}</span>
        <span className="opportunity-tag opportunity-category">{categoryLabels[item.category]}</span>
        <span className="opportunity-tag">{costLabels[item.cost]}</span>
        {item.verificationStatus === 'demo' && <span className="badge badge-demo">[DEMO] · Fictional opportunity</span>}
      </div>
    </header>
    {item.verificationStatus === 'demo' && <DemoNotice />}

    <div className="opportunity-primary-grid">
      <OpportunityExplanation id={item.id} />
      <aside className="opportunity-panel opportunity-source" aria-labelledby="source-title">
        <header className="opportunity-panel-heading"><span className="opportunity-panel-icon"><Icon name="shield" /></span><div><h2 id="source-title">Source & Verification</h2><p>The record behind this opportunity.</p></div></header>
        <dl className="opportunity-source-facts">
          <div><dt>Source</dt><dd>{item.sourceName?.trim() || 'Not provided'}</dd></div>
          <div><dt>Source type</dt><dd>{sourceLabels[item.sourceType]}</dd></div>
          <div><dt>Verification</dt><dd><span className={`verification-status verification-${item.verificationStatus}`}><span aria-hidden="true" />{verificationLabels[item.verificationStatus]}</span></dd></div>
          <div><dt>Last checked</dt><dd>{formatDate(item.lastVerifiedAt)}</dd></div>
          <div><dt>Checked by</dt><dd>{item.verifiedBy?.trim() || 'Not provided'}</dd></div>
        </dl>
        <p className="opportunity-source-note"><Icon name="info" /><span>“Checked against source” means manually reviewed against a source. It does not guarantee eligibility, accuracy today or availability.</span></p>
        {url ? <a className="button button-primary opportunity-source-link" href={url} target="_blank" rel="noopener noreferrer">Visit source <Icon name="external" /><span className="sr-only"> (opens in a new tab)</span></a> : <p className="opportunity-no-source"><Icon name="info" />No valid source link available.</p>}
      </aside>
    </div>

    <div className="opportunity-context">
      <section className="opportunity-about" aria-labelledby="about-title">
        <h2 id="about-title">About this opportunity</h2>
        <p>{item.summary}</p>
        {item.topics.length > 0 && <ul className="opportunity-tags" aria-label="Topics">{item.topics.map(topic => <li className="opportunity-tag" key={topic}>{topicLabels[topic]}</li>)}</ul>}
        {item.tags.length > 0 && <div className="opportunity-record-tags"><h3>Tags</h3><ul aria-label="Tags">{item.tags.map(tag => <li key={tag}>#{tag}</li>)}</ul></div>}
      </section>
      <div className="opportunity-practical">
        <section aria-labelledby="eligibility-title"><h2 id="eligibility-title"><Icon name="profile" />Who it’s for</h2><p>{item.eligibilitySummary}</p><dl className="opportunity-practical-facts"><div><dt>Applicability</dt><dd>{applicabilityLabel(item)}</dd></div><div><dt>Cost</dt><dd>{costLabels[item.cost]}</dd></div></dl><p className="opportunity-small-note">Applicability describes the recorded scope, not a decision about your personal eligibility.</p></section>
        <section aria-labelledby="timing-title"><h2 id="timing-title"><Icon name="clock" />Dates & timing</h2><p className="opportunity-deadline">{deadlineLabel(item.deadline, now)}</p>{item.deadline.note && <p>{item.deadline.note}</p>}<p className="opportunity-small-note">Fixed deadlines are valid through the end of the stated date in India (IST). A deadline that has not passed does not guarantee applications are open. Rolling and expected annual dates must be confirmed with the provider.</p></section>
      </div>
    </div>
  </div>
}
