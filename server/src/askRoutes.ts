import { Router, json } from 'express'
import type { ErrorRequestHandler } from 'express'
import type { AnswerEngine } from './limitedAnswerEngine.ts'

export function createAskRoutes(engine: AnswerEngine) {
  const routes = Router()
  routes.post('/ask', json({ limit: '16kb', strict: true, inflate: false }), async (request, response) => {
    const body: unknown = request.body
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('question' in body)
      || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 4000) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Provide a nonblank question of at most 4000 characters.' } })
      return
    }
    const controller = new AbortController()
    const disconnected = () => { if (!response.writableEnded) controller.abort() }
    request.once('aborted', disconnected)
    response.once('close', disconnected)
    try {
      const result = await engine.answer(body.question.trim(), { signal: controller.signal })
      if (response.destroyed || controller.signal.aborted) return
      if (result.ok) {
        // Serialize only the existing public contract, never provider/audit/reasoning metadata.
        response.json({ answer: result.response.answer, citations: result.response.citations, grounded: result.response.grounded })
      } else {
        const status = result.error.code === 'TIMEOUT' ? 504 : result.error.code === 'UNAVAILABLE' ? 503
          : result.error.code === 'CANCELLED' ? 408 : 502
        response.status(status).json({ error: result.error })
      }
    } finally {
      request.removeListener('aborted', disconnected)
      response.removeListener('close', disconnected)
    }
  })
  const invalidJson: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    const type = error && typeof error === 'object' && 'type' in error ? error.type : undefined
    if (typeof type === 'string' && ['entity.parse.failed', 'entity.too.large', 'encoding.unsupported', 'charset.unsupported', 'request.aborted', 'request.size.invalid'].includes(type)) {
      response.status(type === 'entity.too.large' ? 413 : 400).json({ error: { code: 'INVALID_REQUEST', message: 'Provide a valid JSON question within the request size limit.' } })
      return
    }
    next(error)
  }
  routes.use(invalidJson)
  return routes
}
