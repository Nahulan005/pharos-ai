import type { Opportunity } from '../../shared/contract.ts'

/** Structured observations supplied by a reader, not instructions to retrieve a URL. */
export interface SourceFinding {
  findingId: string
  sourceId: string
  sourceUrl: string
  /** Original ISO timestamp with seconds and timezone, preserved verbatim. */
  retrievedAt: string
  publishedAt?: string | null
  evidenceText?: string | null
  verificationStatus?: 'unreviewed'
  facts: {
    id: Opportunity['id']
    category: Opportunity['category']
    title: Opportunity['title']
    provider?: string | null
    summary?: string | null
    eligibilitySummary?: string | null
    cost?: Opportunity['cost'] | null
    applicability?: Opportunity['applicability'] | null
    deadline?: Opportunity['deadline'] | null
    topics?: Opportunity['topics'] | null
    tags?: Opportunity['tags'] | null
  }
}

/** Backend sidecar: never insert these fields into the shared Opportunity object. */
export interface OpportunityEvidence {
  opportunityId: string
  findingId: string
  sourceId: string
  sourceUrl: string
  retrievedAt: string
  publishedAt: string | null
  evidenceText: string | null
  /** Detached snapshot preserves supplied facts, including omitted versus null values. */
  originalFinding: SourceFinding
}

export interface OrganizedOpportunity {
  opportunity: Opportunity
  evidence: OpportunityEvidence
}

export interface OrganizerError {
  path: string
  code: 'INVALID_FINDING' | 'UNKNOWN_SOURCE' | 'SOURCE_MISMATCH'
    | 'VERIFICATION_FORBIDDEN' | 'CONFLICT' | 'INVALID_OPPORTUNITY'
  message: string
}

export type OrganizerResult<T = OrganizedOpportunity> =
  | { ok: true; value: T }
  | { ok: false; errors: OrganizerError[] }
