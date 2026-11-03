# Ollama and the limited ask API (Step 2)

The backend calls Ollama; browsers call PHAROS. There are no new dependencies.
The existing provider abstraction, opportunity APIs and verification modules are
preserved. `createApp(store?, answerEngine?)` accepts an injectable `AnswerEngine`
so a future evidence-backed implementation can replace demo mode.

## Run in PowerShell

Install Ollama separately if needed. Start it in one terminal (the Windows desktop
application may already be serving; do not start a second instance in that case):

```powershell
ollama serve
```

In another terminal, download the default model if it is not already installed:

```powershell
ollama pull qwen3:1.7b
ollama list
```

Start PHAROS from the repository root:

```powershell
Set-Location server
$env:OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
$env:OLLAMA_MODEL = 'qwen3:1.7b'
npm.cmd start
```

Those environment values are also the defaults. The base URL must be an HTTP(S)
origin without credentials, path prefixes, queries or fragments. Configure it only
on the backend, never from user input. `HOST` and `PORT` retain their existing
defaults (`127.0.0.1`, `3000`). A misconfigured/unavailable Ollama does not disable
the opportunity API. No `.env` loader is added; set environment variables in the
terminal before starting the process.

If the known Windows tsx startup error occurs, use Node 24's alternate command
from `server/`, without changing project configuration:

```powershell
node --experimental-transform-types src/index.ts
```

Test the endpoint in another terminal:

```powershell
$body = @{ question = 'How can I learn Python?' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/api/ask' `
  -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 5
```

Repeat with `What scholarships are open now?` to receive the deterministic
unavailable-information response without contacting Ollama.

## Contract and limits

Request: `{"question":"..."}`. No extra fields are accepted. Questions must be
nonblank strings of at most 4000 characters, including surrounding whitespace;
the route trims before calling the engine. JSON bodies are limited to 16 KiB.

Success: `{"answer":"...","citations":[],"grounded":false}`. This is also the
shape for conservative unavailable-information responses. Model output cannot
provide citations or set grounding. All demo answers have `grounded: false`.
`src/services/AI_API_CONTRACT.md` was absent from this checkout; this implementation
uses the supplied request contract and existing `groundedAnswer.ts` AIResponse.

Only a narrow complete-question grammar is eligible for general generation:

- `How can I learn Python?`, `How do I start learning programming?`,
  `Help me learn web development`, `Give me a study plan for data science`.
- The learning topics are Python, JavaScript, TypeScript, programming, web
  development, data science, machine learning, cybersecurity, algorithms,
  communication skills, study skills and time management.
- `Help me plan my career`, `How can I plan my career`,
  `Give me general career planning advice`.
- `How can I prepare for interviews?`, `How do I improve my resume?`,
  `How can I improve my study habits?`.

Questions outside the grammar, mixed requests, named opportunity questions and
ambiguous requests receive the same deterministic response. This intentionally
rejects many harmless paraphrases and non-English questions. Only a canonical
topic is sent to the model, never the raw user text or synthetic fixtures.

The model is asked for general advice only. A strict one-key answer schema and
additional output filters reject links, citation markers, selected opportunity
facts, assurances and reasoning markers. These checks are defence in depth, not
semantic verification or a complete hallucination defence. Free-form guidance
can still be inaccurate or drift from instructions (including naming resources).
Do not broaden this mode into current opportunity answers by adding keywords or
loosening filters; that requires the evidence-backed engine.

Errors use `{"error":{"code":"...","message":"..."}}`: invalid input/JSON
400, oversized body 413, unavailable Ollama 503, timeout 504, invalid model output
or provider failure 502, cancellation 408 if the client is still connected.
Unexpected application failures retain the existing sanitized 500 response.
No prompts, reasoning or upstream error bodies are logged.

## Transport and cancellation

`OllamaProvider` implements `AIProvider` using `POST /api/chat`, `stream: false`,
`format: 'json'` and `think: false`. It discards `message.thinking`, rejects inline
reasoning tags and returns only validated JSON content. The limited-mode prompt
also requests `/no_think`. Models/older Ollama versions that do not honour these
controls may fail validation; the adapter does not retry with thinking enabled.
The controls follow the [Ollama chat API](https://docs.ollama.com/api/chat) and
[thinking documentation](https://docs.ollama.com/capabilities/thinking).

The existing provider wrapper supplies a 60-second default deadline and external
cancellation. The adapter also uses that wrapper when called directly. Fetch
receives the abort signal; timeout covers response headers and body consumption.
Response size is capped at 256 KiB and redirects are rejected. Client disconnect
aborts generation. No retries, streaming UI, conversation history, model download
or daemon startup happens inside an API request.

## Verification and remaining work

From `server/`:

```powershell
npm.cmd run typecheck
npm.cmd test
# Alternative for the known uv_os_get_passwd ENOMEM runner failure:
node --experimental-transform-types --test --test-reporter=spec tests/*.test.ts
```

Automated tests use injected transports and loopback HTTP, not an installed model.
They cover transport success/failure, timeout/cancellation, malformed output,
reasoning-field exclusion, request validation, conservative routing, response
shape, fixture independence and disconnected clients.

Retrieval integration, claim-backed deterministic factual rendering, real
citations, full AI evaluation, frontend assistant wiring and browser proxy/CORS
remain future work. Ingestion, evidence storage and human-review ownership are
unchanged. This endpoint is a local demo without authentication or rate limiting.
