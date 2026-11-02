import type { Claim, ClaimStatus } from './claimLedger.ts'
import { isLedgerTimestamp } from './claimLedgerValidation.ts'

/** For a validated claim version. Version selection/supersession requires ledger history. */
export function effectiveStatus(claim: Claim, now: string): ClaimStatus {
  if (!isLedgerTimestamp(now)) throw new RangeError('Expected an explicit valid timestamp for now.')
  const instant = Date.parse(now)
  if (instant < Date.parse(claim.proposedAt) || (claim.review && instant < Date.parse(claim.review.reviewedAt))) {
    throw new RangeError('Cannot evaluate a claim before its recorded events.')
  }
  if (claim.review?.decision === 'reject') return 'rejected'
  if (claim.review?.decision === 'request_changes') return 'changes_requested'
  let deadline = Infinity
  if (claim.type === 'application_deadline') {
    if (claim.value.kind === 'date') deadline = Date.parse(`${claim.value.date}T00:00:00+05:30`) + 86_400_000
    if (claim.value.kind === 'instant') deadline = Date.parse(claim.value.at)
  }
  const validUntil = claim.validUntil === null ? Infinity : Date.parse(claim.validUntil)
  if (instant >= Math.min(validUntil, deadline)) return 'lapsed'
  if (claim.recheckBy !== null && instant >= Date.parse(claim.recheckBy)) return 'needs_recheck'
  return claim.review?.decision === 'approve' ? 'reviewed' : 'candidate'
}
