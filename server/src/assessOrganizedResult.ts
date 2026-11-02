import type { ReadAndOrganizeResult } from './readAndOrganize.ts'
import type { SourceFinding } from './sourceFinding.ts'
import { EvidenceAssessmentService } from './evidenceAssessment.ts'
import type { EvidenceReport } from './evidenceAssessment.ts'

export type AssessedOrganizedResult = Exclude<ReadAndOrganizeResult, { ok: true }>
  | { ok: true; value: Extract<ReadAndOrganizeResult, { ok: true }>['value'] & { evidenceReport: EvidenceReport } }

/** Preserve reader/organizer failures and never mutate or upgrade opportunity verification fields. */
export function assessOrganizedResult(
  result: ReadAndOrganizeResult, assessor: EvidenceAssessmentService,
  additionalFindings: readonly SourceFinding[] = [],
): AssessedOrganizedResult {
  if (!result.ok) return result
  return { ok: true, value: { ...result.value,
    evidenceReport: assessor.assess(result.value, additionalFindings),
  } }
}
