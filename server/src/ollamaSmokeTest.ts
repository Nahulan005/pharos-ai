import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { OllamaProvider } from './ollamaProvider.ts'
import { generateGroundedAnswer } from './groundedAnswer.ts'

/** Optional LIVE manual test. Never imported by the app or executed by npm test. */
async function main() {
  if (process.argv.slice(2).join(' ') !== '--run') {
    console.error('Manual test only: pass --run when Ollama is already running locally with qwen3:1.7b installed.')
    process.exitCode = 1
    return
  }
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  try {
    console.log('LIVE manual Ollama test (not a mocked test). No evidence or real opportunity data is supplied.')
    const provider = new OllamaProvider({ fetch: globalThis.fetch })
    const result = await generateGroundedAnswer(provider, {
      question: 'Briefly explain what a student should check before applying. No opportunity evidence is available.',
      evidence: [], uncertainties: [], reviewWarnings: [],
    }, { timeoutMs: 120_000, signal: controller.signal })
    if (!result.ok) {
      console.error(JSON.stringify(result.error))
      process.exitCode = 1
    } else console.log(JSON.stringify(result.response, null, 2))
  } finally { process.removeListener('SIGINT', cancel) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Manual Ollama test failed.'); process.exitCode = 1 })
}
