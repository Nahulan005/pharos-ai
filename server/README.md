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

## Continuing development

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
