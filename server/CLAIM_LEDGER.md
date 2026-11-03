# Claim ledger foundation (Step 1)

The ledger is internal and independent of AI providers, HTTP routes and the public
Opportunity contract. Nothing is persisted or published by these modules.

## Model and validation

`claimLedger.ts` defines discriminated claim values for seven claim types. Money is
expressed in nonnegative integer minor units (zero means free), with a three-letter
currency code. This step checks currency syntax, not an ISO currency catalogue.
Unknown values require a reason and explanation; they are not guessed facts.
Deadline claims always require a cycle, even when the deadline is unknown.

Claims reference observations through evidence IDs. Each observation binds an exact
quote, UTF-16 text offsets, surrounding context and a text representation reference
to a snapshot. Snapshot metadata records source identity, URL, retrieval time,
capture classification, method, opaque content reference and digest. A digest is
an integrity identifier, never proof of source truth. Registration establishes only
that the source ID is known; it grants neither retrieval permission nor authority.

`validateClaimLedger` checks JSON-shaped input, complete references within the supplied
ledger, registered source/opportunity references, type/value compatibility, chronology
and review records. It returns a detached copy on success and path-specific issues on
failure. The application supplies the trusted validation context; do not obtain that
context from model output or untrusted request fields.

A review binds a human identity and decision to an exact claim version and all its
evidence. Approval also records claim-scoped authority rationales referencing the
evidence. These are human judgments, not automatic authority determinations. An AI
may propose a candidate, but cannot record a review through the transition validator.
No stored `status` field is accepted: a caller cannot submit `status: 'reviewed'`.
All review decisions require real captured evidence; synthetic fixtures remain candidates.
Approval of an explicit unknown records review of that uncertainty, not a known value.

## Authentication and history boundary

`authenticatedReviewerIds` is an explicit assertion by a trusted application layer
that reviewer identities have been authenticated. It is not an authentication
mechanism. `validateClaimLedgerTransition(previous, next, context, actor)` additionally
requires the trusted actor to match the human adding a new review. Self-declaring
`kind: 'human'` does not authenticate a caller. An eventual service must derive actor
and reviewer assertions from authentication/authorization or an audited event store.
There is no such service in Step 1.

The transition validator requires the complete prior ledger. Existing evidence and
snapshots cannot be changed or deleted. Claim versions are immutable, including
time bounds and evidence links; the only allowed update is attaching the first
review to a candidate. Recorded decisions cannot be overwritten or removed. Corrections,
renewed reviews and changed values require a new version with a new review record.
Versions are contiguous and link to the immediately preceding version, preserving
claim type, opportunity and cycle. A new cycle starts a new claim identity. Supersession
is represented by the successor's reference; historical versions are retained unchanged.

A standalone ledger cannot prove that a previously reviewed value was not edited,
that prior records were not omitted, or that synthetic content was not relabelled.
Those checks require the trusted prior state and the transition validator. Concurrent
writes and completeness of that prior state require future persistence controls.

## Effective status

`effectiveStatus(claim, now)` accepts a validated claim version and an explicit ISO
timestamp. It never reads the clock, mutates data, authenticates reviews or treats
retrieval time as validity. Calls predating the claim's recorded events are rejected.

Rejected and changes-requested decisions remain those statuses. Otherwise, the
earliest deadline/validUntil bound causes `lapsed`; then recheckBy causes
`needs_recheck`; otherwise an approved review yields `reviewed` and no review yields
`candidate`. Time boundaries are exclusive and crossed at equality. Date-only
deadlines remain active through their date in IST (UTC+05:30), expiring at the next
midnight. Instant deadlines, validUntil and recheckBy use explicit timestamps.
Time-derived statuses do not overwrite the recorded human decision.

Status is scoped to one version. The function cannot infer supersession from a lone
claim; a future read layer must select the latest version from validated complete
history. It must not fall back to an older approved version when a newer candidate
exists. Review status is not a guarantee of eligibility, availability or factual truth.

## Deliberately deferred

There is no storage access, authentication service, authority policy engine, review
UI, route, crawler, model integration or publication renderer. Opaque content and
representation references are checked for presence, not dereferenced. Exact quote
offset/length consistency is checked, but quote/context membership and digests must
be verified against stored bytes/text by a future capture layer. Source-origin
ownership and capture authenticity also require that trusted layer. A coherent
fabricated capture cannot be detected from metadata alone. Public verification
semantics and existing backend behavior are unchanged.
