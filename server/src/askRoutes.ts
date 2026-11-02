import { Router, json } from 'express'
import type { ErrorRequestHandler } from 'express'
import { AskService, validQuestion } from './askService.ts'

export function createAskRoutes(service: AskService) {
  const routes = Router()
  routes.post('/', (request, response, next) => {
    if (!request.is('application/json')) {
      response.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use application/json.' } })
      return
    }
    next()
  }, json({ limit: '32kb', strict: true, inflate: false }), async (request, response) => {
    const body: unknown = request.body
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'question')
      || !validQuestion((body as { question?: unknown }).question)) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Provide only a question containing 1–4000 characters.' } })
      return
    }
    const controller = new AbortController()
    const disconnect = () => { if (!response.writableEnded) controller.abort() }
    request.once('aborted', disconnect)
    response.once('close', disconnect)
    if (request.aborted || response.destroyed) controller.abort()
    try {
      const result = await service.ask((body as { question: string }).question.trim(), controller.signal)
      if (response.destroyed || controller.signal.aborted) return
      if (result.ok) response.json(result.response) // Audit/uncertainty metadata remains internal.
      else response.status(result.status).json({ error: result.error })
    } finally {
      request.removeListener('aborted', disconnect)
      response.removeListener('close', disconnect)
    }
  })
  const errors: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    const type = error && typeof error === 'object' && 'type' in error ? error.type : undefined
    const status = type === 'entity.too.large' ? 413
      : type === 'encoding.unsupported' || type === 'charset.unsupported' ? 415
        : ['entity.parse.failed', 'request.aborted', 'request.size.invalid'].includes(String(type)) ? 400 : undefined
    if (!status) { next(error); return }
    if (response.headersSent || response.destroyed) return
    response.status(status).json({ error: {
      code: status === 413 ? 'REQUEST_TOO_LARGE' : status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'INVALID_REQUEST',
      message: status === 413 ? 'Request body exceeds 32 KiB.' : status === 415 ? 'Use uncompressed UTF-8 JSON.' : 'Request JSON is invalid.',
    } })
  }
  routes.use(errors)
  return routes
}
