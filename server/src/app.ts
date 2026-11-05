import express from 'express'
import type { ErrorRequestHandler } from 'express'
import type { ApiError } from '../../shared/contract.ts'
import { createOpportunityStore, OpportunityDataError } from './opportunityStore.ts'
import type { OpportunityStore } from './opportunityStore.ts'
import { createApiRoutes } from './routes.ts'
import { createAskRoutes } from './askRoutes.ts'
import { createLimitedAnswerEngine } from './limitedAnswerEngine.ts'
import type { AnswerEngine } from './limitedAnswerEngine.ts'
import { OllamaProvider } from './ollamaProvider.ts'
import { GroqProvider } from './groqProvider.ts'
import { GeminiProvider } from './geminiProvider.ts'
import { createResearchAnswerEngine } from './researchAnswerEngine.ts'
import type { AIProvider } from './aiProvider.ts'

export function createApp(store: OpportunityStore = createOpportunityStore(),
  answerEngine?: AnswerEngine, provider: AIProvider = process.env.GROQ_API_KEY ? new GroqProvider() : new OllamaProvider()) {
  const app = express()
  app.disable('x-powered-by')
  app.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next() })
  app.use('/api', createApiRoutes(store))
  const askEngine = answerEngine ?? (process.env.GEMINI_API_KEY
    ? createResearchAnswerEngine(new GeminiProvider()) : createLimitedAnswerEngine(provider))
  app.use('/api', createAskRoutes(askEngine, { store, provider }))
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
