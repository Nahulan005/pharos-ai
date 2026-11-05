# Gemini student assistant

Set `GEMINI_API_KEY` in the backend process environment, then restart the backend
with `npm.cmd start` from `server` (or `node --experimental-transform-types src/index.ts`
for the Windows tsx issue). No SDK, dependency, dotenv loader or frontend key is used.
Never put the key in `VITE_` variables, browser storage, logs or committed files.

`GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`, listed as stable in Google's
[model catalog](https://ai.google.dev/gemini-api/docs/models). Use an available
text model supporting generateContent and JSON output. Account access can vary.
Requests use the fixed Google HTTPS generateContent endpoint, key header, JSON
output, 4096 output tokens and no search or tools. Responses are limited to 256 KiB.
Blocked/truncated/tool responses and malformed JSON fail safely; thought parts,
signatures and raw provider errors are never exposed. No automatic retries or
silent provider switching on Gemini failure.

Provider routing:

- With `GEMINI_API_KEY`, `/api/ask` uses the conversational research engine and Gemini.
- Without it, `/api/ask` retains the previous limited Groq/Ollama demo mode.
- Opportunity explanations still use Groq when `GROQ_API_KEY` exists, otherwise Ollama.
- Explicit answer-engine injection continues to take precedence in tests.

The unchanged request is `{ "question": "Explain Python loops with an example" }`.
The server accepts 1–4000 characters, a 16 KiB JSON body, and no extra request fields.
Answers retain `{ answer, citations: [], grounded: false }`, with a fixed disclosure
that guidance is unverified and there is no live web access. The model's internal
`{kind, answer}` schema is validated and never exposed as the public API.
Responses may contain plain-text examples/code; existing frontend rendering applies.

This is single-turn conversation: no chat history or student profile is sent to
Gemini. Include needed context in each question. Example prompts: “Suggest a small
React project”, “Compare Python lists and dictionaries”, “Help me plan four weeks
of SQL practice”, “Why is the sky blue?”. Current opportunity questions receive a
verification checklist. Unknown context should lead to clarification, not invented
history. The model has no retrieval, source access or verified opportunity evidence.

The prompt, conservative opportunity guard, output checks and mandatory disclosure
reduce risk; they do not prove semantic truth or complete hallucination/prompt-
injection prevention across languages. General answers can be wrong. No citations
or verified opportunity claims may be inferred from model memory. No automated
human verification is introduced. Timeouts (60 seconds by default), client-disconnect
cancellation and sanitized route errors reuse the existing provider abstraction.

Tests use fake environment credentials and mocked transports only. No live paid API
calls are performed. For a manual demo after configuring the server, ask the example
questions in AI Research, then confirm an opportunity explanation still uses Groq.
Disable/reject the Gemini connection to check the existing service error UI.
