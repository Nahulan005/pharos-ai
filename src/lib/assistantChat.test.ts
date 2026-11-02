import { expect, it, vi } from 'vitest'
import { createAssistantChat } from './assistantChat'
import { AIRequestError, AIUnavailableError } from '../services/aiClient'
import type { AIResponse } from '../models/ai'

const fixture: AIResponse = { answer: 'Test fixture, not a real AI response.', grounded: false, citations: [] }
it('shows the unavailable state when the backend cannot be reached', async () => {
  const chat = createAssistantChat({ configured: true, ask: vi.fn().mockRejectedValue(new AIRequestError('network', 'Could not reach the backend.')) })
  await chat.send('Question')
  expect(chat.getSnapshot()).toMatchObject({ status: 'unavailable', error: 'Could not reach the backend.' })
  expect(chat.getSnapshot().messages.map(item => item.role)).toEqual(['user'])
})
it('never creates assistant messages when unavailable or failed', async () => {
  const ask = vi.fn().mockRejectedValue(new AIUnavailableError())
  const offline = createAssistantChat({ configured: false, ask })
  await offline.send('Question')
  expect(ask).not.toHaveBeenCalled()
  expect(offline.getSnapshot()).toMatchObject({ status: 'unavailable', messages: [] })
  const online = createAssistantChat({ configured: true, ask })
  await online.send('Question')
  expect(online.getSnapshot().messages.map(item => item.role)).toEqual(['user'])
  expect(online.getSnapshot().status).toBe('unavailable')
})
it('adds only an actual service response and clears all chat state on reset', async () => {
  const chat = createAssistantChat({ configured: true, ask: vi.fn().mockResolvedValue(fixture) })
  const listener = vi.fn()
  const unsubscribe = chat.subscribe(listener)
  await chat.send('Question')
  expect(chat.getSnapshot().messages).toHaveLength(2)
  expect(chat.getSnapshot().messages[1]).toMatchObject({ role: 'assistant', response: fixture })
  chat.reset()
  expect(chat.getSnapshot()).toEqual({ messages: [], status: 'empty', error: null })
  expect(listener).toHaveBeenCalled()
  unsubscribe()
})
it.each(['reset', 'cancel'] as const)('%s aborts and prevents a late success from reappearing', async action => {
  let resolve!: (response: AIResponse) => void
  const ask = vi.fn().mockImplementation(() => new Promise<AIResponse>(done => { resolve = done }))
  const chat = createAssistantChat({ configured: true, ask })
  const request = chat.send('Question')
  expect(chat.getSnapshot().status).toBe('loading')
  await chat.send('Duplicate while busy')
  expect(ask).toHaveBeenCalledTimes(1)
  chat[action]()
  expect(ask.mock.calls[0][1].signal.aborted).toBe(true)
  resolve(fixture)
  await request
  expect(chat.getSnapshot().messages.some(item => item.role === 'assistant')).toBe(false)
  if (action === 'reset') expect(chat.getSnapshot().messages).toEqual([])
})
it('allows a new request after reset without stale failures replacing it', async () => {
  let reject!: (error: Error) => void
  const ask = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail })).mockResolvedValue(fixture)
  const chat = createAssistantChat({ configured: true, ask })
  const old = chat.send('Old')
  chat.reset()
  await chat.send('New')
  reject(new Error('Late failure'))
  await old
  expect(chat.getSnapshot().status).toBe('ready')
  expect(chat.getSnapshot().messages).toHaveLength(2)
  expect(chat.getSnapshot().error).toBeNull()
})
it('ignores invalid questions and clears failure state', async () => {
  const ask = vi.fn().mockRejectedValue(new Error('failure'))
  const chat = createAssistantChat({ configured: true, ask })
  await chat.send(' ')
  expect(ask).not.toHaveBeenCalled()
  await chat.send('Question')
  expect(chat.getSnapshot().status).toBe('error')
  expect(chat.getSnapshot().messages).toHaveLength(1)
  chat.reset()
  expect(chat.getSnapshot().error).toBeNull()
})
