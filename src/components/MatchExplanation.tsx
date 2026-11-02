import type { MatchResult, Relevance } from '../../shared/contract'
import { Icon } from './Icon'

const labels: Record<Relevance, string> = { high: 'High relevance', medium: 'Medium relevance', low: 'Low relevance' }

export function MatchExplanation({ match }: { match: MatchResult }) {
  return <section className="match-explanation" aria-label="Profile relevance explanation">
    <div className={`relevance-badge relevance-${match.relevance}`}><Icon name="compass" />{labels[match.relevance]}</div>
    <p className="match-caution">Relevance, not confirmed eligibility.</p>
    <details>
      <summary>Why this relevance?</summary>
      <h3>What we considered</h3>
      <ul>{match.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
      <h3>What still needs checking</h3>
      <ul>{match.uncertainties.map(uncertainty => <li key={uncertainty}>{uncertainty}</li>)}</ul>
    </details>
  </section>
}
