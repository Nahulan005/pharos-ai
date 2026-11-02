import type { Category, SourceType } from '../../shared/contract.ts'

export type RegistrySourceType = Exclude<SourceType, 'unknown'>
export type RetrievalMethod = 'manual_review' | 'api' | 'feed' | 'web_fetch' | 'browser_automation'
export type AutomatedAccessStatus = 'not_reviewed' | 'approved' | 'denied'

export interface Source {
  readonly id: string
  readonly name: string
  readonly websiteUrl: string
  readonly sourceType: RegistrySourceType
  readonly categories: readonly Category[]
  readonly permittedRetrievalMethods: readonly RetrievalMethod[]
  readonly automatedAccessStatus: AutomatedAccessStatus
  /** Date of an actual access-policy review, not registry creation or URL discovery. */
  readonly lastReviewedAt: string | null
  readonly notes: string
}

function candidate(
  id: string, name: string, websiteUrl: string, sourceType: RegistrySourceType,
  categories: Category[], notes: string,
): Source {
  return Object.freeze({
    id, name, websiteUrl, sourceType, categories: Object.freeze(categories),
    permittedRetrievalMethods: Object.freeze(['manual_review'] as const),
    automatedAccessStatus: 'not_reviewed', lastReviewedAt: null,
    notes: `${notes} Candidate only; automated access has not been reviewed or approved.`,
  })
}

/** Metadata only: importing this module never performs network requests. */
export const sources: readonly Source[] = Object.freeze([
  candidate('national-scholarship-portal', 'National Scholarship Portal',
    'https://scholarships.gov.in/', 'official', ['scholarship'],
    'Government scholarship portal. Check each scheme for eligibility and deadlines.'),
  candidate('naan-mudhalvan', 'Naan Mudhalvan',
    'https://naanmudhalvan.tn.gov.in/', 'official', ['scholarship', 'course_cert'],
    'Tamil Nadu initiative. Applicability and benefits require programme-specific evidence.'),
  candidate('swayam', 'SWAYAM', 'https://swayam.gov.in/', 'official', ['course_cert'],
    'Course portal. Learning access and certification charges must be checked separately.'),
  candidate('nptel', 'NPTEL', 'https://nptel.ac.in/', 'official', ['course_cert'],
    'Course and certification source. Verify each course session and examination terms.'),
  candidate('buddy4study', 'Buddy4Study', 'https://www.buddy4study.com/',
    'third_party', ['scholarship'],
    'Discovery source; corroborate scholarship claims against the issuing organisation.'),
  candidate('internshala', 'Internshala', 'https://internshala.com/',
    'third_party', ['course_cert'],
    'Platform listings require issuer-specific evidence. Internship/job categories are not yet in the shared contract. Own training offers need a separately scoped provider entry.'),
  candidate('github-education', 'GitHub Education', 'https://github.com/education/students',
    'provider', ['software_perk'],
    'Specific provider: GitHub. Partner offers require their own evidence and access review; this entry grants no access to partner websites.'),
])

const byId = new Map(sources.map(source => [source.id, source]))
if (byId.size !== sources.length) throw new Error('Duplicate source IDs')

export function getSourceById(id: string): Source | undefined {
  return byId.get(id)
}

/** Offline syntax check only. Does not establish ownership, safety, availability or access permission. */
export function isValidSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim()
    || /[\s\\\u0000-\u001f\u007f]/u.test(value) || !/^https:\/\//i.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname)
      && !url.username && !url.password && !url.hash && !url.port
  } catch { return false }
}

/** Exact origin matching: subdomains and third-party/partner links are not implicitly registered. */
export function isSourceUrl(sourceId: string, value: unknown): boolean {
  const source = getSourceById(sourceId)
  return Boolean(source && isValidSourceUrl(value)
    && new URL(value).origin === new URL(source.websiteUrl).origin)
}

/** Fail closed. All current candidates return false, regardless of source reputation. */
export function isAutomatedRetrievalPermitted(
  sourceId: string, method: RetrievalMethod, targetUrl?: string,
): boolean {
  const source = getSourceById(sourceId)
  return Boolean(source
    && ['api', 'feed', 'web_fetch', 'browser_automation'].includes(method)
    && source.automatedAccessStatus === 'approved'
    && source.lastReviewedAt !== null
    && source.permittedRetrievalMethods.includes(method)
    && isSourceUrl(sourceId, targetUrl ?? source.websiteUrl))
}

/** Source provenance is context, never evidence that an individual claim was checked. */
export function getSourceTrust(sourceId: string) {
  const source = getSourceById(sourceId)
  if (!source) return undefined
  return Object.freeze({
    sourceId: source.id,
    sourceType: source.sourceType,
    requiresClaimVerification: true as const,
    verifiesIndividualClaims: false as const,
  })
}
