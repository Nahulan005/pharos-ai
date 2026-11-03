/** Internal ledger models. These do not change the public Opportunity contract. */
export type ClaimType = 'application_deadline' | 'application_url' | 'learning_cost'
  | 'assessment_fee' | 'certificate_fee' | 'eligibility_text' | 'benefit_text'
export type UnknownReason = 'not_published' | 'not_found' | 'conflicting_evidence'
  | 'ambiguous_source' | 'not_applicable'
export type UnknownValue = { kind: 'unknown'; reason: UnknownReason; detail: string }
export type DeadlineValue = { kind: 'date'; date: string; timezone: 'Asia/Kolkata' }
  | { kind: 'instant'; at: string }
export type MoneyValue = { kind: 'money'; amountMinor: number; currency: string }
export type ClaimValue = UnknownValue | DeadlineValue | MoneyValue
  | { kind: 'url'; url: string } | { kind: 'text'; text: string }
export interface Actor { kind: 'human' | 'ai' | 'script'; id: string }
export interface ClaimReference { claimId: string; version: number }

export interface Snapshot {
  snapshotId: string
  sourceId: string
  sourceUrl: string
  retrievedAt: string
  capture: 'synthetic' | 'captured'
  retrievalMethod: 'fixture' | 'manual' | 'api' | 'web_fetch'
  /** Opaque storage reference, never fetched by validation. */
  contentRef: string
  mediaType: string
  sha256: string
}
export interface Evidence {
  evidenceId: string
  snapshotId: string
  quote: {
    exact: string
    /** Offsets in the stored text representation, in UTF-16 code units; end is exclusive. */
    location: { representationRef: string; start: number; end: number }
    before: string
    after: string
  }
}
export interface HumanReview {
  reviewId: string
  claim: ClaimReference
  reviewer: { kind: 'human'; id: string }
  reviewedAt: string
  decision: 'approve' | 'reject' | 'request_changes'
  evidenceIds: readonly string[]
  /** Claim-scoped human judgment; registration alone does not establish authority. */
  authority: readonly { evidenceId: string; rationale: string }[]
  rationale: string
}
interface ClaimBase {
  opportunityId: string
  claimId: string
  version: number
  /** A cycle change starts a new claim identity, not a revision of another cycle. */
  cycle: string | null
  proposedAt: string
  proposer: Actor
  evidenceIds: readonly string[]
  supersedes: ClaimReference | null
  /** Exclusive timestamp bounds. Date-only deadline end-of-day is calculated separately. */
  validUntil: string | null
  recheckBy: string | null
  review: HumanReview | null
}
type Values = {
  application_deadline: DeadlineValue
  application_url: { kind: 'url'; url: string }
  learning_cost: MoneyValue
  assessment_fee: MoneyValue
  certificate_fee: MoneyValue
  eligibility_text: { kind: 'text'; text: string }
  benefit_text: { kind: 'text'; text: string }
}
export type Claim = { [K in ClaimType]: ClaimBase & { type: K; value: Values[K] | UnknownValue } }[ClaimType]
export type ClaimStatus = 'candidate' | 'reviewed' | 'rejected' | 'changes_requested' | 'lapsed' | 'needs_recheck'
export interface ClaimLedger {
  claims: readonly Claim[]
  evidence: readonly Evidence[]
  snapshots: readonly Snapshot[]
}
/** Trust assertions supplied by the application, never copied from model output/request JSON. */
export interface LedgerValidationContext {
  opportunityIds: readonly string[]
  registeredSourceIds: readonly string[]
  authenticatedReviewerIds: readonly string[]
}
