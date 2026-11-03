# Proposed PHAROS research API — pending backend-owner agreement

## Opportunity detail explanation (implemented separately from general ask)

`POST /api/opportunities/:id/explanation` uses the existing same-origin `/api`
proxy. Body: `{ "profile": { "careerInterests": [], "skills": [], "weeklyLearningHours": null } }`.
Only saved values for these three fields are sent on explicit button activation;
unsaved/default profiles send empty preferences. No other profile fields are sent.
The backend loads the selected record from its validated opportunity store.

The response uses the existing `answer`, `citations`, `grounded` shape. Ollama
selects allowed relevance-statement IDs; the backend renders deterministic wording.
Unreviewed records retain a mandatory warning. No evidence assessment is invented:
`grounded` is false and `citations` is empty. The detail page retains its source link.
Provider failure or rejected output returns a clearly labelled deterministic
explanation. Invalid requests return 400; absent records return 404; store failures
return 503. Backend inference times out after 30 seconds; the browser aborts after
35 seconds. Cancellation/navigation propagates abort and suppresses stale output.
This does not change the general `/api/ask` behavior documented below.

This is a frontend proposal, not an implemented server or a shared contract change.
The Node.js backend owner must confirm or adjust it before integration. Ollama +
Qwen3 must run behind that backend; the browser never calls Ollama directly.

## Configuration and request

The default endpoint is same-origin `/api/ask`; `VITE_API_BASE_URL` may be unset
or blank. During local development, Vite's existing `/api` proxy forwards requests
to `http://127.0.0.1:3000`. An existing `VITE_API_BASE_URL` of
`http://127.0.0.1:3000` or `http://localhost:3000` (with an optional trailing slash)
also uses that proxy in development, avoiding a cross-origin browser request.

For a separate backend, set `VITE_API_BASE_URL` to its HTTP(S) base URL, for example
`https://backend.example.com`, then restart Vite (or rebuild for production).
The client appends `/api/ask`; a path prefix is supported. Other explicit URLs are
honored in development, and all valid explicit URLs are honored in production.
A production deployment without an explicit URL must serve or reverse-proxy
`/api/ask` on the frontend origin; Vite's development proxy is not part of the build.
Do not point this setting at Ollama or include API keys or credentials. Invalid
explicit configuration still disables sending, with no fallback to another backend.

`POST /api/ask`, `Content-Type: application/json`, `Accept: application/json`:

```json
{ "question": "What should I verify before applying for a scholarship?" }
```

The trimmed question must contain 1–4000 characters. This first version is
single-turn: no chat history, profile data, account credentials, or identifiers
are sent. The server must allow the frontend origin through CORS when origins
differ. Use HTTPS in production; no browser credentials or redirects are used.

## Successful response (HTTP 200, JSON)

```typescript
interface AIResponse {
  answer: string;
  citations: { title: string; url: string; recordId?: string }[];
  grounded: boolean;
}
```

`answer` is nonempty plain text, at most 100000 characters. No raw HTML or Markdown
is rendered. `citations` is required, at most 30 entries; each has a nonempty title
(up to 500 characters) and a valid HTTP(S) URL (up to 4096 characters), without
embedded credentials. Optional `recordId` uses lowercase-kebab-case. It is metadata
only; the frontend does not invent internal links from it. Unsafe or malformed
citations invalidate the entire response rather than silently removing evidence.

`grounded: true` requires at least one citation and means the backend reports
support from retrieved sources. The UI cannot verify that claim. The backend must
cite actual retrieved evidence, exclude fictional demos from factual claims, and
never imply guaranteed eligibility or availability. Ungrounded responses are
explicitly labelled general guidance. The browser never creates fallback answers.

## Failure, timeout and cancellation

Proposed server error body: `{ "error": { "code": "AI_UNAVAILABLE", "message": "..." } }`.
Return HTTP 503 when the model/service is unavailable; do not return a successful
placeholder answer. The frontend currently treats 404/502/503/504 as unavailable,
other non-2xx responses as request failures, and network/CORS failures separately.
Server error text is not displayed verbatim. Response JSON is runtime-validated.

The default timeout is 60 seconds including response-body parsing. The typed
`ask(question, { signal?, timeoutMs? })` interface allows a 1–300000 ms timeout.
Cancel, clear chat and leaving the page abort the fetch and suppress late results.
Browser cancellation does not guarantee model computation stops; the backend
should propagate disconnect cancellation to its inference request where possible.
No streaming or automatic retries are implemented. Confirm this contract, timeout,
error codes and grounding semantics with the frontend owner before integration.
