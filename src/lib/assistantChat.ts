import type { AIClient, AIResponse } from '../models/ai'
import { AIRequestError, AIUnavailableError, MAX_QUESTION_LENGTH } from '../services/aiClient'

export type ChatMessage = { id: number; role: 'user'; text: string } | { id: number; role: 'assistant'; response: AIResponse }
export interface ChatState {
  messages: ChatMessage[]
  status: 'empty' | 'ready' | 'loading' | 'error' | 'unavailable'
  error: string | null
}

/** Ephemeral chat state. A generation token prevents late responses after reset or navigation. */
export function createAssistantChat(client: AIClient) {
  const initial = (): ChatState => ({ messages: [], status: client.configured ? 'empty' : 'unavailable', error: null })
  let state = initial()
  let generation = 0
  let id = 0
  let controller: AbortController | null = null
  const listeners = new Set<() => void>()
  const publish = (next: ChatState) => { state = next; listeners.forEach(listener => listener()) }
  const cancel = () => {
    generation++
    controller?.abort()
    controller = null
    if (state.status === 'loading') publish({ ...state, status: 'ready', error: 'Request cancelled. No new answer was added.' })
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    cancel,
    reset() { cancel(); publish(initial()) },
    async send(question: string) {
      if (state.status === 'loading') return
      if (!client.configured) { publish({ ...state, status: 'unavailable', error: null }); return }
      if (!question.trim() || question.trim().length > MAX_QUESTION_LENGTH) return
      const requestGeneration = ++generation
      controller = new AbortController()
      publish({ messages: [...state.messages, { id: ++id, role: 'user', text: question.trim() }], status: 'loading', error: null })
      try {
        const response = await client.ask(question, { signal: controller.signal })
        if (generation !== requestGeneration) return
        publish({ messages: [...state.messages, { id: ++id, role: 'assistant', response }], status: 'ready', error: null })
      } catch (error) {
        if (generation !== requestGeneration) return
        publish({ ...state, status: error instanceof AIUnavailableError || (error instanceof AIRequestError && error.code === 'network') ? 'unavailable' : 'error',
          error: error instanceof AIUnavailableError ? null : error instanceof AIRequestError ? error.message : 'The research request failed. No answer was added.' })
      } finally { if (generation === requestGeneration) controller = null }
    },
  }
}
