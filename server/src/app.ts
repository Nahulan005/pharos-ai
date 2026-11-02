import express from 'express'
import type { ErrorRequestHandler } from 'express'
import type { ApiError } from '../../shared/contract.ts'
import { createOpportunityStore, OpportunityDataError } from './opportunityStore.ts'
import type { OpportunityStore } from './opportunityStore.ts'
import { createApiRoutes } from './routes.ts'
import { AskService } from './askService.ts'

export function createApp(store: OpportunityStore = createOpportunityStore(),
  askService = new AskService({ freshnessPolicy: { maxObservationAgeMs: 0 } })) {
  const app = express()
  app.disable('x-powered-by')
  app.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next() })
  app.use('/api', createApiRoutes(store, askService))
  app.use((_request, response) => {
    const error: ApiError = { error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } }
    response.status(404).json(error)
  })
  const errors: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (response.headersSent) { next(error); return }
    const invalidPath = error instanceof URIError
    const unavailable = error instanceof OpportunityDataError
    const body: ApiError = { error: {
      code: unavailable ? 'OPPORTUNITY_DATA_UNAVAILABLE' : invalidPath ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
      message: unavailable ? 'Opportunity data is temporarily unavailable.' : invalidPath ? 'Invalid request path.' : 'An unexpected server error occurred.',
    } }
    response.status(unavailable ? 503 : invalidPath ? 400 : 500).json(body)
  }
  app.use(errors)
  return app
}
