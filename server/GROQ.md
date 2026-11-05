# Groq backend provider

Set `GROQ_API_KEY` in the **server process environment** before starting PHAROS.
Never use a `VITE_` variable, browser storage, source code or committed config for
this key. No dotenv loader is added. Start from `server` with `npm.cmd start`
(or `node --experimental-transform-types src/index.ts` for the known Windows tsx issue).

When the key is nonempty, `createApp` uses one GroqProvider for both `/api/ask`
and `/api/opportunities/:id/explanation`. With no key (or an empty value), it uses
the existing Ollama configuration. Restart the server after changing environment
variables. An invalid Groq key fails safely; it does not silently retry via Ollama.
Explicit provider/answer-engine injection remains available for tests.

`GROQ_MODEL` defaults to `llama-3.1-8b-instant`, documented with JSON Object Mode
by [Groq](https://console.groq.com/docs/model/llama-3.1-8b-instant).
Choose a model available to your Groq account that supports chat completions and
JSON object output. Model availability/account access can change. The fixed endpoint
is [Groq chat completions](https://console.groq.com/docs/api-reference):
`https://api.groq.com/openai/v1/chat/completions`.

The adapter uses bearer authorization, non-streaming JSON output, temperature 0,
and a 768-token completion limit. For `openai/gpt-oss-20b` only, the limit is 4096
with `reasoning_effort: "low"` and `include_reasoning: false`. This provides
headroom for reasoning and the final JSON; excluding reasoning from the response
does not disable reasoning. It mitigates possible budget pressure behind
`JSON_VALIDATION_FAILED`, but does not establish the cause of a particular failure.
The limit may increase token use; existing request timeouts still apply.
See [Groq reasoning controls](https://console.groq.com/docs/reasoning).
Responses are bounded to 256 KiB, validated as
JSON objects and checked for complete assistant output. Tool calls, refusals,
truncation and inline reasoning are rejected. Separate reasoning metadata is never
returned. Credentials, raw responses, prompts and exceptions are never logged.
Application schema and safety checks remain in the existing engines; JSON mode
does not establish factual correctness or verification.

Timeouts/cancellation reuse AIProvider: ask defaults to 60 seconds; opportunity
explanations use 30 seconds. Rate limits/server failures map to UNAVAILABLE;
authentication and other HTTP errors map to PROVIDER_ERROR. No automatic retries.
Explanations preserve their labelled deterministic fallback. Synthetic demo
opportunities are excluded from inference, and unreviewed records remain unreviewed.

With Groq enabled, permitted prompts (including the selected opportunity and the
three learning-preference fields for explanations) are sent to Groq rather than
local Ollama. The API key is sent only in the server-to-Groq authorization header.
Tests use fake keys and mocked fetch; no live paid requests are needed.
