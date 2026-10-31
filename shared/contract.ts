/**
 * Shared opportunity contract for PHAROS clients and services.
 * Dates use YYYY-MM-DD.
 * Fixed deadlines remain valid through the end of their date in India (IST).
 * Verification means manually checked against a source, not guaranteed
 * eligibility or availability. Demo opportunities must be clearly fictional.
 * Unknown information must not be guessed; use unknown, null, or empty arrays
 * as appropriate for the field.
 */
export const SCHEMA_VERSION = 1;

export type Category = 'scholarship' | 'course_cert' | 'software_perk';

export type Topic =
  | 'ai_ml'
  | 'web_dev'
  | 'cybersecurity'
  | 'data_science'
  | 'general';

export type OpportunityCost =
  | 'free'
  | 'free_to_learn_paid_cert'
  | 'paid'
  | 'unknown';

export type DeadlineType = 'fixed' | 'rolling' | 'annual_expected' | 'unknown';

export type SourceType = 'official' | 'provider' | 'third_party' | 'unknown';

export type VerificationStatus = 'checked_against_source' | 'unreviewed' | 'demo';

export interface Opportunity {
  id: string;
  category: Category;
  title: string;
  provider: string;
  summary: string;
  cost: OpportunityCost;
  eligibilitySummary: string;
  applicability: {
    scope: 'national' | 'state' | 'unknown';
    states: string[];
  };
  deadline: {
    type: DeadlineType;
    date: string | null;
    note: string | null;
  };
  sourceName: string | null;
  sourceUrl: string | null;
  sourceType: SourceType;
  verificationStatus: VerificationStatus;
  lastVerifiedAt: string | null;
  verifiedBy: string | null;
  topics: Topic[];
  tags: string[];
}

export interface OpportunityListResponse {
  schemaVersion: number;
  generatedAt: string;
  items: Opportunity[];
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export type Relevance = 'high' | 'medium' | 'low';

export interface MatchResult {
  opportunityId: string;
  relevance: Relevance;
  reasons: string[];
  uncertainties: string[];
}
