import { AskService } from './askService.ts'
import { OllamaProvider } from './ollamaProvider.ts'
import type { OllamaFetch } from './ollamaProvider.ts'

function integer(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new RangeError('Invalid AI numeric configuration.')
  return Number(value)
}

/** Startup-only configuration, never populated from HTTP request fields. No I/O during construction. */
export function createConfiguredAskService(env: NodeJS.ProcessEnv = process.env, fetcher: OllamaFetch = globalThis.fetch): AskService {
  const providerName = env.PHAROS_AI_PROVIDER ?? 'disabled'
  if (!['disabled', 'ollama'].includes(providerName)) throw new RangeError('Unsupported AI provider configuration.')
  const provider = providerName === 'ollama' ? new OllamaProvider({ fetch: fetcher,
    baseUrl: env.OLLAMA_BASE_URL, modelId: env.OLLAMA_MODEL,
  }) : undefined
  return new AskService({ provider,
    // No real evidence catalog exists yet. Do not attach the demo opportunity store or fixtures.
    freshnessPolicy: { maxObservationAgeMs: integer(env.PHAROS_EVIDENCE_MAX_AGE_MS, 0) },
    timeoutMs: integer(env.PHAROS_ASK_TIMEOUT_MS, 45_000),
    maxConcurrent: integer(env.PHAROS_ASK_MAX_CONCURRENT, 2),
  })
}
