import { Router } from 'express'
import type { ApiError } from '../../shared/contract.ts'
import type { OpportunityStore } from './opportunityStore.ts'

export function createApiRoutes(store: OpportunityStore) {
  const routes = Router()
  routes.get('/health', (_request, response) => {
    response.json({ status: 'ok' })
  })
  routes.get('/opportunities', async (_request, response) => {
    response.json(await store.getAll())
  })
  routes.get('/opportunities/:id', async (request, response) => {
    const data = await store.getAll()
    const opportunity = data.items.find(item => item.id === request.params.id)
    if (!opportunity) {
      const error: ApiError = { error: { code: 'OPPORTUNITY_NOT_FOUND', message: 'Opportunity not found.' } }
      response.status(404).json(error)
      return
    }
    response.json(opportunity)
  })
  return routes
}
