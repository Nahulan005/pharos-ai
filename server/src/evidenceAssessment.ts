import { isDeepStrictEqual } from 'node:util'
import { SCHEMA_VERSION } from '../../shared/contract.ts'
import type { SourceType } from '../../shared/contract.ts'
import { validateOpportunities } from '../../shared/validateOpportunities.mjs'
import { getSourceById, isSourceUrl } from './sourceRegistry.ts'
import { OpportunityOrganizer } from './opportunityOrganizer.ts'
import type { OrganizedOpportunity, SourceFinding } from './sourceFinding.ts'
import type { RawEvidence } from './sourceReader.ts'

export interface FreshnessPolicy {
  /** Required application policy, not a universal definition of evidence validity. */
  maxObservationAgeMs: number
  /** Default zero: future observations are not accepted without explicit clock tolerance. */
  futureToleranceMs?: number
}
export type EvidenceInput = OrganizedOpportunity & { rawEvidence?: RawEvidence }
export type EvidenceIssueCode = 'INVALID_OPPORTUNITY' | 'INVALID_FINDING' | 'MISSING_SOURCE_ID'
  | 'UNKNOWN_SOURCE' | 'MISSING_SOURCE_URL' | 'SOURCE_URL_MISMATCH' | 'PROVENANCE_MISMATCH'
  | 'MISSING_TIMESTAMP' | 'INVALID_TIMESTAMP' | 'FUTURE_TIMESTAMP' | 'STALE_OBSERVATION'
  | 'INVALID_CHRONOLOGY' | 'MISSING_EVIDENCE' | 'INVALID_RAW_EVIDENCE' | 'SYNTHETIC_EVIDENCE'
  | 'SOURCE_CLASSIFICATION_MISMATCH' | 'THIRD_PARTY_REQUIRES_CORROBORATION'
  | 'MISSING_DETAIL' | 'UNKNOWN_DEADLINE' | 'INVALID_DEADLINE' | 'EXPIRED_DEADLINE'
  | 'STRUCTURED_CONFLICT' | 'UNSUPPORTED_CLAIM' | 'UNRECORDED_HUMAN_VERIFICATION'
  | 'FINDING_ID_MISMATCH'
export interface EvidenceIssue {
  code: EvidenceIssueCode
  severity: 'error' | 'warning'
  path: string
  message: string
}
export interface EvidenceSourceReference {
  findingId: string | null
  sourceId: string | null
  sourceUrl: string | null
  sourceType: SourceType
  retrievedAt: string | null
  ageMs: number | null
  freshness: 'fresh' | 'stale' | 'future' | 'unknown'
}
export interface EvidenceReport {
  opportunityId: string | null
  findingId: string | null
  assessedAt: string
  policy: Required<FreshnessPolicy>
  overall: 'supported' | 'needs_review' | 'insufficient_evidence'
  /** A consistent observation is recorded; this does not prove a real website was visited. */
  retrieved: boolean
  /** Known structured claims match recorded evidence; not factual truth or human verification. */
  supported: boolean
  needsReview: boolean
  humanVerified: false
  deadline: 'active' | 'expired' | 'rolling' | 'unknown' | 'invalid'
  issues: EvidenceIssue[]
  sources: EvidenceSourceReference[]
  reviewRequirements: {
    resolveIssueCodes: EvidenceIssueCode[]
    humanReview: 'separate_recorded_action_required_before_verified_status'
  }
}

const obj = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim())
const known = (value: unknown): boolean => value !== undefined && value !== null
  && !(typeof value === 'string' && (!value.trim() || value.trim().toLowerCase() === 'unknown'))
  && !(Array.isArray(value) && value.length === 0)
function validTimestamp(value: unknown): value is string {
  return validateOpportunities({ schemaVersion: SCHEMA_VERSION, generatedAt: value, items: [] }).length === 0
}
function field(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => obj(value)[key], record)
}
function equalClaim(left: unknown, right: unknown): boolean {
  // Tags, topics and state lists are sets for conflict comparison; prose is compared exactly.
  const canonical = (value: unknown) => Array.isArray(value) ? [...new Set(value)].sort() : value
  return isDeepStrictEqual(canonical(left), canonical(right))
}
const claimPaths = ['id', 'category', 'title', 'provider', 'summary', 'eligibilitySummary', 'cost',
  'deadline.type', 'deadline.date', 'deadline.note', 'applicability.scope', 'applicability.states', 'topics', 'tags']

export class EvidenceAssessmentService {
  private readonly policy: Required<FreshnessPolicy>
  constructor(policy: FreshnessPolicy, private readonly clock: () => string = () => new Date().toISOString()) {
    const tolerance = policy.futureToleranceMs ?? 0
    if (!Number.isSafeInteger(policy.maxObservationAgeMs) || policy.maxObservationAgeMs < 0
      || !Number.isSafeInteger(tolerance) || tolerance < 0) {
      throw new RangeError('Freshness thresholds must be nonnegative safe integer milliseconds.')
    }
    this.policy = { maxObservationAgeMs: policy.maxObservationAgeMs, futureToleranceMs: tolerance }
  }

  assess(input: EvidenceInput, additionalFindings: readonly SourceFinding[] = []): EvidenceReport {
    const assessedAt = this.clock() // Read once; every comparison uses this instant.
    if (!validTimestamp(assessedAt)) throw new RangeError('Assessment clock must return a valid ISO timestamp.')
    const now = Date.parse(assessedAt)
    const root = obj(input), opportunity = obj(root.opportunity), evidence = obj(root.evidence)
    const original = obj(evidence.originalFinding)
    const issues: EvidenceIssue[] = []
    const add = (code: EvidenceIssueCode, path: string, message: string, severity: 'error' | 'warning' = 'error') => {
      issues.push({ code, path, message, severity })
    }
    const timestamp = (value: unknown, path: string, required = true): number | null => {
      if (value == null || value === '') {
        if (required) add('MISSING_TIMESTAMP', path, 'Observation/retrieval timestamp is required.')
        return null
      }
      if (!validTimestamp(value)) { add('INVALID_TIMESTAMP', path, 'Expected a real ISO timestamp with timezone.'); return null }
      const instant = Date.parse(value)
      if (instant > now + this.policy.futureToleranceMs) add('FUTURE_TIMESTAMP', path, 'Timestamp is beyond the configured clock tolerance.')
      return instant
    }
    for (const detail of validateOpportunities({ schemaVersion: SCHEMA_VERSION, generatedAt: assessedAt, items: [root.opportunity] }) as string[]) {
      const split = detail.indexOf(': ')
      add('INVALID_OPPORTUNITY', detail.slice(0, split).replace('items[0]', 'opportunity'), detail.slice(split + 2))
    }

    // Validate each original finding using the actual organizer, including the registry and shared validator.
    const findings = [original, ...additionalFindings.map(obj)]
    const sources: EvidenceSourceReference[] = []
    for (const [index, finding] of findings.entries()) {
      const path = index === 0 ? 'evidence.originalFinding' : `additionalFindings[${index - 1}]`
      const source = text(finding.sourceId) ? getSourceById(finding.sourceId) : undefined
      if (!text(finding.sourceId)) add('MISSING_SOURCE_ID', `${path}.sourceId`, 'A registered source identity is required.')
      else if (!source) add('UNKNOWN_SOURCE', `${path}.sourceId`, 'Source is not registered.')
      if (!text(finding.sourceUrl)) add('MISSING_SOURCE_URL', `${path}.sourceUrl`, 'Source URL is missing.')
      else if (!source || !isSourceUrl(source.id, finding.sourceUrl)) add('SOURCE_URL_MISMATCH', `${path}.sourceUrl`, 'URL does not belong to the registered source origin.')
      const observed = timestamp(finding.retrievedAt, `${path}.retrievedAt`)
      const published = timestamp(finding.publishedAt, `${path}.publishedAt`, false)
      if (observed !== null && published !== null && published > observed) add('INVALID_CHRONOLOGY', `${path}.publishedAt`, 'Publication is later than retrieval.')
      const ageMs = observed === null ? null : now - observed
      const freshness = ageMs === null ? 'unknown' : ageMs < -this.policy.futureToleranceMs ? 'future'
        : ageMs > this.policy.maxObservationAgeMs ? 'stale' : 'fresh'
      if (freshness === 'stale') add('STALE_OBSERVATION', `${path}.retrievedAt`, 'Observation exceeds the configured maximum age.', 'warning')
      if (!text(finding.evidenceText) || !known(finding.evidenceText)) add('MISSING_EVIDENCE', `${path}.evidenceText`, 'Supporting evidence text is missing.')
      if (source?.sourceType === 'third_party') add('THIRD_PARTY_REQUIRES_CORROBORATION', `${path}.sourceId`, 'Check claims against the issuing organisation.', 'warning')
      if (obj(finding.facts).id !== opportunity.id) add('FINDING_ID_MISMATCH', `${path}.facts.id`, 'Finding belongs to a different opportunity.')
      const facts = obj(finding.facts)
      if (finding.verificationStatus !== undefined && finding.verificationStatus !== 'unreviewed'
        || finding.verifiedBy != null || finding.lastVerifiedAt != null
        || facts.verificationStatus != null || facts.verifiedBy != null || facts.lastVerifiedAt != null) {
        add('UNRECORDED_HUMAN_VERIFICATION', path, 'A source assertion cannot substitute for a separately recorded human review.')
      }
      const organized = new OpportunityOrganizer().organize(finding)
      if (!organized.ok) {
        for (const error of organized.errors) add('INVALID_FINDING', `${path}.${error.path}`, error.message)
      }
      sources.push({ findingId: text(finding.findingId) ? finding.findingId : null,
        sourceId: text(finding.sourceId) ? finding.sourceId : null,
        sourceUrl: text(finding.sourceUrl) ? finding.sourceUrl : null,
        sourceType: source?.sourceType ?? 'unknown', retrievedAt: text(finding.retrievedAt) ? finding.retrievedAt : null,
        ageMs, freshness })
    }

    if (!text(evidence.sourceId)) add('MISSING_SOURCE_ID', 'evidence.sourceId', 'Evidence source identity is missing.')
    else if (!getSourceById(evidence.sourceId)) add('UNKNOWN_SOURCE', 'evidence.sourceId', 'Evidence source is not registered.')
    if (!text(evidence.sourceUrl)) add('MISSING_SOURCE_URL', 'evidence.sourceUrl', 'Evidence source URL is missing.')
    if (!text(opportunity.sourceUrl)) add('MISSING_SOURCE_URL', 'opportunity.sourceUrl', 'Opportunity source URL is missing.')
    timestamp(evidence.retrievedAt, 'evidence.retrievedAt')
    timestamp(evidence.publishedAt, 'evidence.publishedAt', false)
    for (const key of ['sourceId', 'sourceUrl', 'findingId', 'retrievedAt', 'publishedAt', 'evidenceText']) {
      if (!isDeepStrictEqual(evidence[key] ?? null, original[key] ?? null)) {
        add('PROVENANCE_MISMATCH', `evidence.${key}`, 'Sidecar differs from the original finding.')
      }
    }
    if (evidence.opportunityId !== opportunity.id || obj(original.facts).id !== opportunity.id) {
      add('PROVENANCE_MISMATCH', 'evidence.opportunityId', 'Evidence must refer to this opportunity.')
    }
    if (opportunity.sourceUrl !== evidence.sourceUrl) add('PROVENANCE_MISMATCH', 'opportunity.sourceUrl', 'Opportunity and evidence URLs differ.')
    const registered = text(evidence.sourceId) ? getSourceById(evidence.sourceId) : undefined
    if (registered && (opportunity.sourceType !== registered.sourceType || opportunity.sourceName !== registered.name)) {
      add('SOURCE_CLASSIFICATION_MISMATCH', 'opportunity.sourceType', 'Source classification/name must match the registry.')
    }
    if (opportunity.verificationStatus === 'checked_against_source' || opportunity.verifiedBy != null || opportunity.lastVerifiedAt != null) {
      add('UNRECORDED_HUMAN_VERIFICATION', 'opportunity.verificationStatus', 'This engine cannot establish human review from opportunity fields.')
    }

    // Check provenance against the Step 4 raw formats, without executing content or interpreting prose.
    if (root.rawEvidence !== undefined) {
      const raw = obj(root.rawEvidence)
      for (const key of ['sourceId', 'sourceUrl', 'retrievedAt']) {
        if (raw[key] !== evidence[key]) add('PROVENANCE_MISMATCH', `rawEvidence.${key}`, 'Raw provenance differs from the evidence sidecar.')
      }
      timestamp(raw.retrievedAt, 'rawEvidence.retrievedAt')
      if (raw.mode === 'fixture' || raw.mode === 'mock_http' || raw.synthetic === true) {
        add('SYNTHETIC_EVIDENCE', 'rawEvidence.mode', 'Fixture/mock content is not real-world corroboration.', 'warning')
      }
      if (!text(raw.body) || raw.byteLength !== Buffer.byteLength(typeof raw.body === 'string' ? raw.body : '')
        || raw.synthetic !== true || !['fixture', 'mock_http'].includes(String(raw.mode))
        || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(raw.contentType))
        || (raw.mode === 'fixture' ? raw.method !== 'fixture' || !text(raw.fixtureId)
          : !['api', 'web_fetch'].includes(String(raw.method)) || raw.fixtureId !== null)) {
        add('INVALID_RAW_EVIDENCE', 'rawEvidence', 'Raw evidence must match the existing reader format and byte count.')
      }
      try {
        const parsed = JSON.parse(String(raw.body))
        const matches = raw.mode === 'fixture' ? isDeepStrictEqual(parsed, original)
          : isDeepStrictEqual(obj(parsed).facts, original.facts)
            && isDeepStrictEqual(obj(parsed).publishedAt ?? null, original.publishedAt ?? null)
            && raw.body === original.evidenceText
            && Object.keys(obj(parsed)).every(key => ['facts', 'publishedAt'].includes(key))
        if (!matches) add('PROVENANCE_MISMATCH', 'rawEvidence.body', 'Raw structured content differs from the original finding.')
      } catch { add('INVALID_RAW_EVIDENCE', 'rawEvidence.body', 'Raw reader evidence must be valid JSON.') }
    }
    if (opportunity.verificationStatus === 'demo') add('SYNTHETIC_EVIDENCE', 'opportunity.verificationStatus', 'Demo records are not real-world corroboration.', 'warning')

    for (const key of ['id', 'category', 'title', 'provider', 'summary', 'eligibilitySummary', 'cost', 'applicability.scope']) {
      if (!known(field(opportunity, key))) add('MISSING_DETAIL', `opportunity.${key}`, 'Required decision-making detail is unknown or missing.', 'warning')
    }
    const deadline = obj(opportunity.deadline)
    let deadlineStatus: EvidenceReport['deadline'] = 'unknown'
    if (deadline.type === 'fixed') {
      if (typeof deadline.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(deadline.date)
        || !validTimestamp(`${deadline.date}T00:00:00Z`)) {
        deadlineStatus = 'invalid'
        add('INVALID_DEADLINE', 'opportunity.deadline.date', 'Fixed deadline needs a valid calendar date.')
      } else {
        const exclusiveEnd = Date.parse(`${deadline.date}T00:00:00+05:30`) + 86_400_000
        deadlineStatus = now >= exclusiveEnd ? 'expired' : 'active'
        if (deadlineStatus === 'expired') add('EXPIRED_DEADLINE', 'opportunity.deadline.date', 'Deadline has ended in IST.', 'warning')
      }
    } else if (['rolling', 'annual_expected', 'unknown'].includes(String(deadline.type))) {
      if (deadline.date != null) {
        deadlineStatus = 'invalid'
        add('INVALID_DEADLINE', 'opportunity.deadline.date', 'Non-fixed deadlines cannot assert an exact date.')
      } else if (deadline.type === 'rolling') deadlineStatus = 'rolling'
      else add('UNKNOWN_DEADLINE', 'opportunity.deadline', 'Deadline is unknown or only an annual expectation.', 'warning')
    } else {
      deadlineStatus = 'invalid'
      add('INVALID_DEADLINE', 'opportunity.deadline', 'Deadline type is missing or invalid.')
    }

    for (const path of claimPaths) {
      const stated = field(opportunity, path), recorded = field(obj(original.facts), path)
      if (known(stated) && !known(recorded)) add('UNSUPPORTED_CLAIM', `opportunity.${path}`, 'Claim has no value in the original finding.')
      else if (known(stated) && known(recorded) && !equalClaim(stated, recorded)) {
        add('STRUCTURED_CONFLICT', `opportunity.${path}`, 'Opportunity differs from its recorded structured claim.')
      }
      const comparable = findings.filter(finding => obj(finding.facts).id === opportunity.id)
        .map(finding => field(obj(finding.facts), path)).filter(known)
      if (comparable.some(value => !equalClaim(value, comparable[0]))) {
        add('STRUCTURED_CONFLICT', `findings.${path}`, 'Findings contain different explicit values; manual reconciliation is required.')
      }
    }
    const retrieved = Boolean(registered && isSourceUrl(registered.id, evidence.sourceUrl)
      && validTimestamp(evidence.retrievedAt) && text(evidence.evidenceText) && known(evidence.evidenceText)
      && !issues.some(issue => ['PROVENANCE_MISMATCH', 'INVALID_RAW_EVIDENCE', 'FUTURE_TIMESTAMP'].includes(issue.code)))
    const supported = retrieved && !issues.some(issue => issue.severity === 'error')
    const needsReview = issues.length > 0
    return {
      opportunityId: text(opportunity.id) ? opportunity.id : null,
      findingId: text(evidence.findingId) ? evidence.findingId : null, assessedAt, policy: { ...this.policy },
      overall: !retrieved ? 'insufficient_evidence' : needsReview ? 'needs_review' : 'supported',
      retrieved, supported, needsReview, humanVerified: false, deadline: deadlineStatus, issues, sources,
      reviewRequirements: { resolveIssueCodes: [...new Set(issues.map(issue => issue.code))],
        humanReview: 'separate_recorded_action_required_before_verified_status' },
    }
  }
}
