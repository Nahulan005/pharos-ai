/** Proposed frontend contract; confirm with the backend owner before integration. */
export interface AICitation {
  title: string
  url: string
  recordId?: string
}
export interface AIResponse {
  answer: string
  citations: AICitation[]
  grounded: boolean
}
export interface AskOptions {
  signal?: AbortSignal
  timeoutMs?: number
}
export interface AIClient {
  configured: boolean
  ask(question: string, options?: AskOptions): Promise<AIResponse>
}
