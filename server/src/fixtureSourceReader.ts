import { sourceFixtures } from '../fixtures/sourceFindings.ts'
import { getSourceById } from './sourceRegistry.ts'
import { OpportunityOrganizer } from './opportunityOrganizer.ts'
import { readerFailure } from './sourceReader.ts'
import type { ReadRequest, ReadResult, SourceReader } from './sourceReader.ts'

export class FixtureSourceReader implements SourceReader {
  private readonly fixtures: Readonly<Record<string, string>>
  constructor(fixtures: Readonly<Record<string, string>> = sourceFixtures) {
    this.fixtures = Object.freeze({ ...fixtures })
  }

  async read(request: ReadRequest): Promise<ReadResult> {
    if (!getSourceById(request.sourceId)) return readerFailure('UNKNOWN_SOURCE')
    if (request.method !== 'fixture') return readerFailure('METHOD_NOT_SUPPORTED')
    if (!Object.hasOwn(this.fixtures, request.fixtureId)) return readerFailure('FIXTURE_NOT_FOUND')
    try {
      const body = this.fixtures[request.fixtureId]
      const input: unknown = JSON.parse(body)
      const result = new OpportunityOrganizer().organize(input)
      if (!result.ok) return readerFailure('INVALID_CONTENT')
      const finding = result.value.evidence.originalFinding
      if (finding.sourceId !== request.sourceId) return readerFailure('SOURCE_MISMATCH')
      return { ok: true, finding, rawEvidence: {
        sourceId: finding.sourceId, sourceUrl: finding.sourceUrl, retrievedAt: finding.retrievedAt,
        method: 'fixture', mode: 'fixture', synthetic: true, fixtureId: request.fixtureId,
        contentType: 'application/json', byteLength: Buffer.byteLength(body), body,
      } }
    } catch { return readerFailure('INVALID_CONTENT') }
  }
}
