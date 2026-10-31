import { Link } from 'react-router-dom'
import type { Opportunity } from '../../shared/contract'
import { applicabilityLabel, categoryLabels, costLabels, deadlineLabel, sourceLabels, verificationLabels } from '../lib/opportunities'
import { Icon } from './Icon'
import type { IconName } from './Icon'

const categoryIcons: Record<Opportunity['category'], IconName> = { scholarship: 'scholarship', course_cert: 'book', software_perk: 'software' }

export function OpportunityCard({ item, now, search }: { item: Opportunity; now: Date; search: string }) {
  return <article className={`opportunity-card category-${item.category}`}>
    <div className="card-top"><span className="category-icon"><Icon name={categoryIcons[item.category]} /></span><span className="category-name">{categoryLabels[item.category]}</span></div>
    <div className="card-badges">{item.verificationStatus === 'demo' && <span className="badge badge-demo">[DEMO] · Fictional</span>}<span className="badge">{costLabels[item.cost]}</span></div>
    <h2><Link to={`/explore/${encodeURIComponent(item.id)}${search}`}>{item.title}</Link></h2>
    <p className="provider">{item.provider}</p>
    <p className="card-summary">{item.summary}</p>
    <div className="card-facts"><span><Icon name="pin" />{applicabilityLabel(item)}</span><span><Icon name="clock" />{deadlineLabel(item.deadline, now)}</span></div>
    <div className="source-line"><Icon name="shield" /><span>{verificationLabels[item.verificationStatus]} · {sourceLabels[item.sourceType]}</span></div>
    <Link className="card-link" to={`/explore/${encodeURIComponent(item.id)}${search}`}>View details <Icon name="arrow" /></Link>
  </article>
}
