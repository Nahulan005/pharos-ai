import { FixtureSourceReader } from './fixtureSourceReader.ts'
import { OpportunityOrganizer } from './opportunityOrganizer.ts'
import type { OrganizedOpportunity, OrganizerError } from './sourceFinding.ts'
import type { RawEvidence, ReadRequest, ReadResult, SourceReader } from './sourceReader.ts'

export type ReadAndOrganizeResult =
  | { ok: true; value: OrganizedOpportunity & { rawEvidence: RawEvidence } }
  | { ok: false; stage: 'reader'; error: Extract<ReadResult, { ok: false }>['error'] }
  | { ok: false; stage: 'organizer'; errors: OrganizerError[] }

export async function readAndOrganize(
  request: ReadRequest, reader: SourceReader = new FixtureSourceReader(),
  organizer = new OpportunityOrganizer(),
): Promise<ReadAndOrganizeResult> {
  const read = await reader.read(request)
  if (!read.ok) return { ok: false, stage: 'reader', error: read.error }
  const organized = organizer.organize(read.finding)
  if (!organized.ok) return { ok: false, stage: 'organizer', errors: organized.errors }
  return { ok: true, value: { ...organized.value, rawEvidence: read.rawEvidence } }
}
