import { readFile } from 'node:fs/promises'
import type { OpportunityListResponse } from '../../shared/contract.ts'
import { validateOpportunities } from '../../shared/validateOpportunities.mjs'

export class OpportunityDataError extends Error {
  constructor() { super('Opportunity data is unavailable.'); this.name = 'OpportunityDataError' }
}

export type ReadSample = () => Promise<string>
const sampleUrl = new URL('../../shared/opportunities.sample.json', import.meta.url)

/** Read and validate on every request so an invalid file cannot be served from a stale cache. */
export function createOpportunityStore(readSample: ReadSample = () => readFile(sampleUrl, 'utf8')) {
  return {
    async getAll(): Promise<OpportunityListResponse> {
      try {
        const data: unknown = JSON.parse(await readSample())
        if (validateOpportunities(data).length > 0) throw new OpportunityDataError()
        // Runtime validation precedes this assertion; the JSON is not trusted merely because of its type.
        return data as OpportunityListResponse
      } catch {
        // Do not expose paths, file contents, JSON parser errors or validation internals.
        throw new OpportunityDataError()
      }
    },
  }
}
export type OpportunityStore = ReturnType<typeof createOpportunityStore>
