# PHAROS API foundation

Express + TypeScript, using the repository's existing shared contract, fictional
sample JSON and runtime validator. A limited Ollama-backed AI demo is available
through `POST /api/ask`; see [setup, contract and limitations](OLLAMA.md).
No database, authentication or scraping is implemented. All sample opportunities
remain fictional demos, not real offers.

## Install and run

Requires Node.js 22 or newer and npm. From the repository root:

```sh
cd server
npm ci
npm run dev
```

Use `npm.cmd` instead of `npm` if PowerShell blocks npm.ps1. Initial dependency
installation used `npm install`; the included lockfile supports `npm ci` on
subsequent checkouts. All backend dependencies are installed in `server/`.

Default URL: `http://127.0.0.1:3000`. `npm start` runs without watching; TypeScript
is executed by tsx, so no compilation step or generated dist folder is required.
Use `PORT` and `HOST` environment variables to override the listening address.
For example in PowerShell: `$env:PORT = '3001'`, then `npm.cmd start`.
Invalid ports fail startup. Ctrl+C stops the server.

## Endpoints

| Request | Successful JSON |
| --- | --- |
| `GET /api/health` | `{ "status": "ok" }` |
| `GET /api/opportunities` | The unchanged shared `OpportunityListResponse`: `{ schemaVersion, generatedAt, items }` |
| `GET /api/opportunities/:id` | One shared `Opportunity` object |
| `POST /api/ask` | `{ answer, citations: [], grounded: false }` in limited demo mode |

`GET /api/opportunities/` is an alias for the list. The ID lookup uses `/:id`
(the task's trailing-slash lookup was interpreted as a missing ID placeholder).
Example lookup: `/api/opportunities/demo-scholarship`.

Every list and lookup request reads and validates the whole sample file before
returning data. Its timestamp is the sample's `generatedAt`, not the request time.
`[DEMO]` titles, `verificationStatus: "demo"`, null sources and all other fields
are preserved. Requests never write to the sample file. Responses use `no-store`.
Health is process liveness only; it does not imply data or AI availability.

Errors follow shared `ApiError`:

```json
{ "error": { "code": "OPPORTUNITY_NOT_FOUND", "message": "Opportunity not found." } }
```

- `404 OPPORTUNITY_NOT_FOUND`: unknown ID in valid data.
- `503 OPPORTUNITY_DATA_UNAVAILABLE`: unreadable, malformed or invalid sample.
- `400 INVALID_REQUEST`: malformed encoded route parameter.
- `404 NOT_FOUND`: unknown endpoint or unsupported method.
- `500 INTERNAL_ERROR`: unexpected application failure.

No paths, parser details, stack traces or raw internal errors are exposed.

## Verification

From `server/`:

```sh
npm run typecheck
npm test
node ../shared/validateOpportunities.mjs
```

Tests use Node's test runner and real HTTP requests to ephemeral loopback ports,
covering health, list, trailing slash, every sample lookup, unknown IDs, invalid
data, filesystem failures, revalidation and sanitized errors. Failure scenarios
inject a reader; the original sample is never changed. No test framework or
HTTP test library dependency is needed.

With the server running, endpoint checks can also be made using:

```sh
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/opportunities
curl http://127.0.0.1:3000/api/opportunities/demo-scholarship
curl -i http://127.0.0.1:3000/api/opportunities/not-a-real-id
```

## Source registry

`src/sourceRegistry.ts` exports typed, immutable candidate metadata for National
Scholarship Portal, Naan Mudhalvan, SWAYAM, NPTEL, Buddy4Study, Internshala and
GitHub Education (a specifically identified software-benefit provider).
Categories reuse the shared contract; internship/job categories are not invented.

Every candidate permits only `manual_review`, has automated access status
`not_reviewed`, and has `lastReviewedAt: null`. A listed URL, an official source,
or discovery of a website is not scraping permission or an access-policy review.
No retrieval, scraping, scheduling, LLM integration or new API route is added.

```ts
import {
  getSourceById, isValidSourceUrl, isSourceUrl,
  isAutomatedRetrievalPermitted, getSourceTrust,
} from './src/sourceRegistry.ts'

getSourceById('swayam') // Source | undefined
isValidSourceUrl('https://swayam.gov.in/') // offline HTTPS syntax check
isSourceUrl('swayam', 'https://swayam.gov.in/course') // exact registered origin
isAutomatedRetrievalPermitted('swayam', 'web_fetch') // false
getSourceTrust('swayam') // provenance; verifiesIndividualClaims is always false
```

URL validation rejects credentials, fragments, whitespace, backslashes and
nonstandard ports. It does not check DNS, ownership, reachability or redirects.
Origin matching does not approve subdomains or partner sites. A future retriever
must separately address redirects, network safety and reviewed URL/path scope.

The permission helper requires explicit approval, a recorded review, a permitted
automated method and a matching target origin. All current entries fail closed.
Before enabling a method, perform and document a genuine terms/access-policy
review, including relevant robots rules, rate limits and allowed scope; extend
the policy model as necessary. No public API/feed availability is assumed.

`getSourceTrust` describes provenance, not factual certainty. Official/provider
status never sets an opportunity's `verificationStatus`, proves eligibility or
validates deadlines. Individual claims need their own evidence and review under
the existing shared contract. Third-party listings need issuer corroboration.
Registry tests cover disabled access, unknown IDs, URL boundaries, immutability
and the separation of source provenance from claim verification.

## Further development

### Model-independent provider contract and grounded answers (Step 6A)

No model transport or public endpoint is added. `src/aiProvider.ts` defines
`AIProvider` with `providerId`, `modelId`, and `generate(GenerationRequest)`.
Requests contain role-separated messages, JSON response format, timeout and an
AbortSignal. Responses contain provider/model identity, raw content and a finish
reason; failures use typed codes with fixed sanitized messages. There is no
default provider, network client, Ollama import or dependency on a model family.

`generateWithProvider` applies a 60-second default timeout (configurable integer
1–300000 ms), forwards cancellation, suppresses late results, cleans up timers
and listeners, and sanitizes returned failures and thrown exceptions. It rejects
wrong provider/model identity, incomplete/truncated generation and oversized or
empty output. Adapters must honor abort themselves; the wrapper can stop waiting
but cannot forcibly stop computation in an uncooperative injected implementation.
There is no streaming, automatic retry, tool execution or provider fallback.

`src/groundedPrompt.ts` defines the internal `GroundedAnswerRequest`: student
question, explicit uncertainties/review warnings, and evidence entries consisting
of a citation ID, existing `EvidenceInput`, and existing `EvidenceReport`. It does
not replace any frontend request format. The prompt builder snapshots input,
checks report/reference identity, reuses the assessment engine at the recorded
assessment instant, and cross-checks related findings for the same opportunity.
Existing reports with additional conflicts/warnings are preserved. Callers must
run a fresh assessment before generation; this builder does not refresh old
assessment timestamps or independently authenticate reports.

Instructions occupy one fixed system message. The question and evidence occupy
one JSON-encoded user message. Source text, source names, URLs and quoted prompt
instructions remain untrusted data. The system forbids invented deadlines, costs,
eligibility, availability and source claims; requires acknowledgement of missing,
stale and conflicting information; and forbids human-verification assertions.
Synthetic evidence is represented only by an exclusion marker, without its facts
or raw text. Fixture/mock citations are rejected. Input is limited to 4000 trimmed
question characters, 30 evidence entries and a 200000-character JSON context.
Oversized contexts fail rather than silently dropping evidence or caveats.

The provider's **internal** output schema is intentionally narrow:

```json
{
  "answer": "Check the recorded requirements with the issuing organisation.",
  "citationIds": ["evidence-1"],
  "uncertainties": []
}
```

`src/groundedAnswer.ts` validates this JSON and resolves citation IDs to the exact
supplied source URLs, opportunity titles and record IDs. Unknown or synthetic IDs,
duplicate IDs, malformed JSON, extra keys (including model-claimed `grounded` or
verification status), embedded links/citation markers/HTML, and common eligibility
or verification assurances are rejected. Models cannot supply citation URLs or
decide grounding. No retrieval or verification status is changed.

Grounding is deliberately conservative: at least one citation is required; every
cited record must have adequate nonsynthetic evidence; and no unresolved context
warnings or uncertainties may remain. Adequate means registered, consistent,
retrieved and supported evidence with no assessment issues or review requirement
for that record. Otherwise `grounded` is false. Missing citations also make the
answer general guidance. Required server warnings and uncertainties are retained
even if the model omits them. They are appended to the plain-text answer along
with the separate-human-review requirement, and retained in internal audit
metadata. The final answer, including these additions, must fit 100000 characters.

Frontend compatibility was inspected read-only from the locally cached
`origin/feature/pharos-frontend` at commit
`25a0153d205246758004a2a41d7e0537a751ed3c`, specifically
`src/models/ai.ts`, `src/services/AI_API_CONTRACT.md`, and `src/services/aiClient.ts`.
That proposal expects `POST /api/ask` with `{ question }` and:

```ts
interface AIResponse {
  answer: string
  citations: { title: string; url: string; recordId?: string }[]
  grounded: boolean
}
```

The backend response type follows that shape and its limits. Internal audit data
and provider result envelopes are not a new public API. The frontend has no
warning fields, which is why essential caveats are also included in `answer`.
No frontend files were modified, no remote fetch was performed, and the proposed
route remains unimplemented. Reconfirm the proposal when API integration begins.

Internal composition (requires a separately supplied provider):

```ts
import { generateGroundedAnswer } from './src/groundedAnswer.ts'
import type { AIProvider } from './src/aiProvider.ts'
import type { GroundedAnswerRequest } from './src/groundedPrompt.ts'

async function answer(provider: AIProvider, request: GroundedAnswerRequest, signal?: AbortSignal) {
  const result = await generateGroundedAnswer(provider, request, { signal, timeoutMs: 60000 })
  // A future route may serialize result.response only after agreeing API/error behavior.
  return result
}
```

Limitations: citation membership and deterministic evidence checks do not prove
that every generated sentence follows from the cited source, or that it answers
the question. `grounded` is a backend evidence/citation assessment, not semantic
entailment or human verification. Instruction/data separation is not a proof of
prompt-injection immunity. Assurance filtering is conservative and may reject
benign negations while missing paraphrases or other languages. No model was run,
so tests verify prompt structure, filtering, mapping and mock behavior, not model
obedience. No raw text is executed. Trusted server code must supply assessments
and context; do not accept client-supplied grounding reports as authoritative.

Step 6B should add an Ollama adapter implementing `AIProvider`, with local service
configuration and the intended Qwen3 1.7B model selected outside the pipeline.
Map role messages and JSON output, propagate AbortSignal, enforce transport/body
limits, normalize provider failures, and isolate any reasoning output from the
final answer. Test with mock Ollama responses before separately authorized live
local inference. Reassess evidence immediately before generation. Any future
`/api/ask` route, CORS, disconnect cancellation, availability behavior and public
error mapping must preserve the inspected frontend contract. Live source access,
human verification and database storage remain separate; none is enabled here.

### Deterministic evidence assessment (Step 5)

`src/evidenceAssessment.ts` exports `EvidenceAssessmentService`, configurable
`FreshnessPolicy`, and a separate `EvidenceReport`. Input reuses
`OrganizedOpportunity` plus optional existing `RawEvidence`; additional findings
reuse `SourceFinding`. `src/assessOrganizedResult.ts` accepts the actual
`readAndOrganize()` result, preserves failures, and adds a report to successful
results. Public endpoints, source approvals, the shared contract, and original
opportunity/evidence records are unchanged.

```ts
import { EvidenceAssessmentService } from './src/evidenceAssessment.ts'
import { assessOrganizedResult } from './src/assessOrganizedResult.ts'
import { readAndOrganize } from './src/readAndOrganize.ts'

const assessor = new EvidenceAssessmentService(
  // Example application policy only: choose an appropriate age for your use case.
  { maxObservationAgeMs: 24 * 60 * 60 * 1000, futureToleranceMs: 0 },
  () => new Date().toISOString(), // Tests inject a fixed ISO timestamp.
)
const read = await readAndOrganize({
  sourceId: 'swayam', method: 'fixture', fixtureId: 'course-v1',
})
const result = assessOrganizedResult(read, assessor)
if (result.ok) console.log(result.value.evidenceReport)
```

The report separates four concepts:

- `retrieved`: consistent provenance, evidence text and an observation timestamp
  are recorded. This does not independently prove that a website was visited;
  fixture retrieval also counts as recorded acquisition.
- `supported`: known structured claims match recorded evidence with no assessment
  errors. This means structural support, not factual truth, eligibility, current
  availability, or semantic proof from arbitrary prose.
- `needsReview`: one or more errors/warnings exist, including stale or synthetic
  evidence, missing details, expired/unknown deadlines and third-party sources.
  Evidence can be structurally supported and still need review.
- `humanVerified`: always false. No code path records human review or upgrades
  `Opportunity.verificationStatus`. Claimed reviewer names/dates/statuses trigger
  `UNRECORDED_HUMAN_VERIFICATION`. A separate authenticated, recorded human-review
  workflow is required; this engine does not validate or create such actions.

Overall assessment is `insufficient_evidence` if acquisition/provenance is not
established, otherwise `needs_review` when issues exist, otherwise `supported`.
Reports contain opportunity/finding IDs, assessment timestamp, the exact policy,
source references and registry classification, observation ages, deadline state,
issue codes/paths/severity/messages and review requirements. They remain separate
from the shared Opportunity contract. No evidence is silently discarded or edited.

Checks reuse `sourceRegistry.ts`, `OpportunityOrganizer`, and the existing shared
validator. They cover registered identity and URL origin; agreement among the
opportunity, sidecar, original finding and raw reader provenance; required fields;
raw byte count, JSON content and original facts; source classification; missing
eligibility, cost, provider, summary and applicability; and verification assertions.
Official/provider provenance never proves a claim. Third-party sources always
receive an issuer-corroboration warning. Fixture/mock raw evidence always receives
`SYNTHETIC_EVIDENCE`, even if complete. No real offer data was added in this step.

Freshness has **no universal default maximum age**: callers must supply
`maxObservationAgeMs`. Values must be nonnegative safe integer milliseconds.
An observation is stale only when its age exceeds the threshold; equality is
fresh. `futureToleranceMs` defaults to zero and must be explicitly increased to
permit clock skew. Missing/invalid retrieval times cannot establish acquisition.
Publication timestamps are optional; when supplied they must be real ISO times,
not after retrieval or beyond the configured future tolerance. They do not replace
observation time. The injected clock is read once per assessment; a malformed
clock or policy throws an explicit configuration error rather than fabricating a
timestamp. Assessment timestamps never replace original observation timestamps.

Fixed deadlines use real calendar validation and the project's IST convention:
the entire YYYY-MM-DD date remains valid, expiring at the following midnight in
UTC+05:30. At exactly that instant the report is `expired`. Unknown and expected
annual deadlines require review; a rolling deadline is not an availability
guarantee. No missing dates, fees or eligibility requirements are inferred.

Conflict detection compares explicit structured values in the opportunity and
its original finding, and among optional additional findings for the same
opportunity ID. Costs, eligibility text, deadlines, categories, providers and
other claim fields are compared exactly; states/topics/tags compare as unordered
sets. Unknown/missing values do not contradict known values. Competing values
produce `STRUCTURED_CONFLICT`; adding a value absent from the original produces
`UNSUPPORTED_CLAIM`. No newest-wins rule or automated reconciliation is applied.
Findings for different opportunity IDs are rejected as mismatches. Differences
in wording may need manual reconciliation; prose contradictions and entity
matching across different IDs are not solved by this engine.

Limitations: source registration and internally consistent snapshots do not
authenticate external content, prove causal support for prose claims, or prove
that supplied evidence has not been fabricated. Sidecars are in-memory, not an
audit database or cryptographic attestation. No LLM is used. Content is never
executed or treated as instructions. Live retrieval remains disabled. Before
Ollama integration, separately scope authenticated human review and audit storage,
approved real evidence acquisition, evidence retention/conflict resolution, and
model-provider contracts that preserve citations and keep deterministic assessment
authoritative over any generated wording. None of those later stages is activated.

### Safe Source Reader (Step 4)

`src/sourceReader.ts` defines `SourceReader.read`, the request union, sanitized
error codes, and raw evidence. It supports local `fixture` mode and future HTTP
`web_fetch`/`api` methods. Retrieval is never verification. No endpoint is changed;
the API continues to serve the existing fictional demo dataset.

`FixtureSourceReader` reads an explicit in-memory manifest from
`fixtures/sourceFindings.ts`. Fixture IDs are lookup keys, never filesystem paths.
The included course observation is clearly synthetic, not a real offer or a
record of a website visit. It has a fixed finding ID, URL and timestamp. Every
read parses a fresh copy and validates it with the existing organizer. Unknown
sources, missing fixture IDs, source mismatches and malformed findings return
structured errors. Fixture mode does not grant automated website access.

```ts
import { readAndOrganize } from './src/readAndOrganize.ts'

const result = await readAndOrganize({
  sourceId: 'swayam', method: 'fixture', fixtureId: 'course-v1',
})
if (result.ok) {
  // In-memory only. This synthetic record must not be published as a real offer.
  console.log(result.value.opportunity)
  console.log(result.value.evidence, result.value.rawEvidence)
} else {
  console.log(result.stage) // reader or organizer
}
```

`readAndOrganize` accepts an injected reader, passes its finding to
`OpportunityOrganizer`, and returns the organized opportunity together with both
evidence structures. Original source IDs, URLs and timestamps are retained.
Raw evidence also records mode, method, fixture ID (if applicable), media type,
byte count and exact text. All Step 4 raw evidence has `synthetic: true`, including
mock HTTP output. These records remain `unreviewed`, with null human-verification
fields. The existing shared contract cannot hold the additional provenance, so
it remains in backend sidecars.

`HttpSourceReader` is a restricted **mock-only foundation**, not a live fetcher.
There is no default transport, no `fetch` fallback, and no production DNS/HTTP
implementation. Existing registry entries are unchanged and all deny access
before DNS or transport calls. Even simulated future access requires both:

- A matching registered source with `approved` status, valid review date, and
  permission for the requested method.
- A source-specific `HttpApproval` containing the method, exact hostname and
  exact URL (including path/query); the URL must also match the registry origin.

Additional enforced checks:

- HTTPS only; no credentials, fragments, nonstandard ports, local hostnames or
  IP-literal URLs. No implicit subdomain approval or URL wildcards.
- Resolve once through the mock adapter; reject the entire answer set if any
  address is private, loopback, link-local, shared, reserved, or otherwise outside
  the conservative public-IPv4 policy. IPv6 is entirely disabled.
- Require the `pinned-ip-tls-no-redirects-v1` mock transport contract, pass a single
  validated address and TLS server name, and reject peer-address mismatches.
  Missing binding support fails closed. No second resolution is requested.
- Reject all 3xx responses, Location headers and changed final URLs. No redirects
  are followed, including same-host redirects.
- Accept only UTF-8 JSON (`application/json`, optional `charset=utf-8`), with no
  compression. Enforce declared and streamed byte limits: default 256 KiB, hard
  configuration cap 1 MiB. Reject mismatched lengths, invalid UTF-8 and invalid JSON.
- One deadline covers DNS, response headers and streamed body: default 5 seconds,
  maximum configuration 30 seconds. Abort on timeout and completion/failure;
  delayed DNS completion cannot initiate a connection after timeout.
- Return fixed error messages; internal exceptions, addresses, paths and raw
  transport errors are not exposed through error results.

The mock JSON format accepts only `{ facts, publishedAt? }`. Facts use the
existing SourceFinding shape; no metadata or verification overrides are accepted.
The reader captures retrieval time through an injectable clock, computes a stable
SHA-256 finding ID from source/method/URL/body, retains raw text, and validates the
finding with the organizer. Content is parsed as data, never executed or treated
as instructions. HTML extraction and arbitrary website parsing are not implemented.

**Security boundary and limitations:** injected registry lookups, approvals,
clocks and transports are trusted application/test dependencies, not API inputs.
A mock capability declaration and response peer metadata cannot prove real socket
security. For that reason only `kind: 'mock'` is accepted, and no live adapter is
shipped. Before live access, implement and audit socket binding to the validated
IP, TLS hostname/certificate verification, proxy avoidance, redirect suppression,
stream limits and cancellation/resource cleanup. Do not substitute ordinary fetch
after a separate DNS check: that would reopen DNS-rebinding risk. Aborting an
uncooperative injected mock cannot forcibly stop its internals. Tests prove policy
and mock interactions, not production TLS or network-stack behavior.

All reader tests use local fixtures or injected in-memory DNS/HTTP mocks. Existing
API regression tests use ephemeral loopback HTTP only. No external site is read.
Step 5 remains separately scoped: source-policy review and approval, an audited
live transport, source-specific structured parsers, and any requested persistence
or API wiring. No scraping, LLM integration, database, or source approval is added.

### Information Organizer

`src/sourceFinding.ts` defines `SourceFinding`, `OpportunityEvidence`, and the
typed success/error result. `src/opportunityOrganizer.ts` exports
`OpportunityOrganizer`. It is a pure, offline transformation; existing endpoints
continue serving the unchanged sample data. No dependencies were added.

```ts
import { OpportunityOrganizer } from './src/opportunityOrganizer.ts'
import type { SourceFinding } from './src/sourceFinding.ts'

// Illustration only, not a real course or a retrieved website finding.
const finding: SourceFinding = {
  findingId: 'example-observation',
  sourceId: 'swayam',
  sourceUrl: 'https://swayam.gov.in/example',
  retrievedAt: '2026-11-02T10:00:00+05:30',
  facts: { id: 'example-course', category: 'course_cert', title: 'Example course' },
}
const result = new OpportunityOrganizer().organize(finding)
if (result.ok) {
  console.log(result.value.opportunity, result.value.evidence)
} else {
  console.log(result.errors) // field path, stable error code, useful message
}
```

Required input: finding ID, registered source ID, source URL, retrieval timestamp,
and facts containing opportunity ID, category and title. Optional facts use the
existing Opportunity types. Optional `publishedAt` is a complete ISO timestamp;
`evidenceText` retains supplied supporting text. The organizer does not extract
facts from that text or decide whether its claims are true.

The organizer checks source ID, exact URL origin and registered category scope,
then maps facts to an Opportunity. Source name/type come from the registry, never
from caller assertions. Missing/null cost becomes `unknown`; absent deadline and
applicability become unknown objects; missing topics/tags become empty arrays.
Provider, summary and eligibility are required strings in the shared contract,
so missing values use the literal `unknown`. Required identity/title/category
cannot be guessed. Supplied malformed values are rejected, not coerced.

Every output is checked by the existing shared runtime validator. Its timestamp
validation is also reused for original retrieval/publication timestamps. Fixed
deadlines require real calendar dates; past dates remain unchanged. Non-fixed
deadlines cannot carry exact dates (annual expectations belong in the note).
Publication after retrieval and inconsistent geographic scope are rejected.
Only omitted or explicit `unreviewed` verification status is accepted. Human
verification assertions and metadata overrides are errors; output always has
`verificationStatus: 'unreviewed'`, `verifiedBy: null`, `lastVerifiedAt: null`.

`organizeMany` validates a batch atomically. Repeated opportunity IDs or finding
IDs are conflicts, including identical duplicates: no silent overwrite or
automatic reconciliation. Failures return errors without partial records.
Conflicts are checked structurally; detecting contradictions within prose or
recognizing the same opportunity under different IDs requires later work.

The shared contract has no source ID, finding ID, retrieval/publication timestamp,
raw evidence, or multi-source provenance fields. A detached evidence sidecar
stores these alongside `opportunityId` and an original finding snapshot. Original
URLs/timestamps are preserved verbatim. This is in-memory output, not persistent
storage. Do not drop the evidence when persisting or reconciling records later.

The future Source Reader must obtain findings through explicitly reviewed,
permitted methods, enforce registry access policies and redirect/scope/network
restrictions, capture actual URLs/timestamps/evidence, and supply stable IDs and
explicit facts. Organizer acceptance is not retrieval permission or factual
verification. All automated retrieval remains disabled. Storage, reconciliation,
human verification, API integration and LLM providers remain separate stages.

Continue on `feature/pharos-functions`. Preserve existing work and coordinate
changes to the shared contract with the frontend owner. `src/app.ts` builds the
application without opening a port; `src/index.ts` starts it; `src/routes.ts`
owns endpoints; `src/opportunityStore.ts` owns reading and validation. The store
is injectable for tests and can be replaced with another validated data source
later. Reuse the shared validator rather than duplicating its enum rules.

The frontend still uses its existing service; this step does not connect it.
Cross-origin browser integration/CORS is not configured yet. The limited `/api/ask`
endpoint and Ollama/Qwen3 adapter are described in [OLLAMA.md](OLLAMA.md).
The research engine, persistent storage and source verification remain future stages.
This is a local development foundation, not a production deployment setup.
