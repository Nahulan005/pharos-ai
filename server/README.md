# PHAROS API foundation

Express + TypeScript, using the repository's existing shared contract, fictional
sample JSON and runtime validator. No AI, database, authentication or scraping is
implemented. All sample opportunities remain fictional demos, not real offers.

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
Cross-origin browser integration/CORS is not configured yet. The `/api/ask`
endpoint, Ollama/Qwen3 providers, research engine, persistent storage and source
verification are future stages. Agree those API contracts before integration.
This is a local development foundation, not a production deployment setup.
