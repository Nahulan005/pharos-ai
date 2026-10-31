import type { Opportunity, OpportunityListResponse } from '../../shared/contract'
import sampleData from '../../shared/opportunities.sample.json'

// The sample is checked by shared/validateOpportunities.mjs. This assertion
// bridges JSON's widened string types; it is not runtime validation.
const sampleResponse = sampleData as OpportunityListResponse

// Keep data access here so a backend can replace the sample without changing
// the async interface consumed by UI components.
export async function getAll(): Promise<Opportunity[]> {
  return structuredClone(sampleResponse.items)
}

export async function getById(id: string): Promise<Opportunity | null> {
  const opportunity = sampleResponse.items.find(item => item.id === id)
  return opportunity ? structuredClone(opportunity) : null
}
