import { Link } from 'react-router-dom'
import { Icon } from './Icon'

export function LoadingState() {
  return <div className="state-panel" role="status"><span className="spinner" /><h2>Loading opportunities</h2><p>Getting the details together.</p></div>
}
export function ErrorState({ retry }: { retry: () => void }) {
  return <div className="state-panel" role="alert"><Icon name="info" /><h2>We couldn’t load the opportunities</h2><p>Please try again. If this continues, come back a little later.</p><button className="button button-primary" onClick={retry}>Try again</button></div>
}
export function NotFound({ opportunity = false, search = '' }: { opportunity?: boolean; search?: string }) {
  return <div className="state-panel"><Icon name="compass" /><p className="eyebrow">NOT FOUND</p><h1>{opportunity ? 'Opportunity not found' : 'This page is off the map'}</h1><p>{opportunity ? 'This ID doesn’t match an available opportunity.' : 'Follow the link below to get back to exploring.'}</p><Link className="button button-primary" to={`/explore${search}`}>Back to Explorer <Icon name="arrow" /></Link></div>
}
export function DemoNotice() {
  return <div className="notice"><Icon name="info" /><p><strong>You’re exploring fictional demos.</strong> These examples are for previewing PHAROS. They are not real offers or open applications.</p></div>
}
