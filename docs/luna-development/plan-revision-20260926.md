# Revised implementation and hands-on reviews — 2026-09-26

Scope remains indexing → relationships/groups → evidence-backed derived information → business search → employee beta. Make remains deferred. Percentages below are manual estimates against implementation plus acceptance conditions, not measured search accuracy, test pass percentages or deployed feature percentages. Added work nested within a stage is not counted again in a total.

| Stage | Origin | Estimated completion | Remaining acceptance |
|---|---|---:|---|
| 1. Baseline, test isolation and permissions | Original | 80% | Operational impact and deployment validation |
| 2. Primary indexing | Original, expanded | 70% | Full real-file flow and bounded application |
| 2A. Atomic publication, source freshness and paid-worker coordination | Added inside stage 2 | 80% | Updated worker integration and real-source acceptance |
| 3. Grouping and relationships | Original, expanded | 30% | Stable project identity, stale-link reconciliation and relationship correctness |
| 4. Search-oriented summaries, comparisons and insights | Original | 10% | Implement and verify evidence-backed derived outputs; source reuse guards alone do not complete this stage |
| 5. Business search | Original | 50% | Compound conditions, follow-up narrowing and real business-question success |
| 6. Shared-path evaluation | Original, expanded | 40% | Employee UI comparison; automated/native SQL/HTTP tests are supporting evidence only |
| 6A. Actual-Hub hands-on review readiness | Added, moved to next priority | 20% | Representative baseline questions, administrator trace, integration checks, auth and application smoke test |
| 7. Employee beta | Original | 0% | Hands-on reviews, operational integration and limited release |

## Sequence change

Primary consistency, source identity, concurrency and API verification were added after investigation found concrete failure modes. These repairs took precedence over derived insights. The next priority is now the first real-Hub review path, before completing the entire grouping/insight subsystem. Applying the draft branch to production is a separate integration decision after migration and source-job review.

## Review 1: search improvements visible in the actual Hub

Target: afternoon of 2026-09-27 KST; estimate, not a confirmed appointment. Actual-Hub review depends on reviewed production integration, database changes, source-job readiness and application validation. The previous 4–8 hour estimate covered a preview, not these operational gates. Check readiness by 11:00 KST on the review day and disclose a delay immediately; do not silently move the date or replace the review with another unit-test summary.

Use the actual hub.apollonworks.com LUNA and its administrator view for the user review. Preview is an engineering preflight; a green preview build does not mean changed behavior is live. Record baseline answers before a controlled application, then compare the same questions on the actual Hub after verified integration. The user directly asks 8–10 questions covering misspellings, exact project names, document/image retrieval, cited sources, file paths and a follow-up narrowing question. Include unrelated-project and genuinely unavailable-data controls. In the administrator view, identify the source and relationship that fed each answer and the specific failure when a question fails. Do not claim operational improvement until production code, database migrations and selected source jobs have been applied and the real application was checked. A synthetic UI mock is not acceptance.

## Review 2: relationships and derived outputs

Target: 2026-09-29 to 2026-09-30 KST, after the first review; roughly 1–2 additional active working days subject to review findings and data readiness. User questions should cover a project bundle across documents/images/meeting notes, separation of similarly named projects or versions, comparison of two projects with citations, and supported conclusions versus unresolved inference.

Proceed toward beta only after the user can see useful answers with correct sources, no unrelated-project mixing, honest missing/conflicting evidence and working follow-up narrowing. Make the administrator dashboard explain the difference between raw indexed items, searchable content, relationship links, derived insight and answer evidence. The existing navigation can remain during the first review, but misleading actions and status labels must be corrected before it. Simplify the full process after observing real administrator use, so the interface reflects verified processing rather than speculative totals. Fix failed cases before calling the stage complete. No final completion date or percentage substitutes for these gates.

## Reporting and user decisions

Record completed units and verified results in the internal Hub development note. The two reviews are hands-on checkpoints; coding continues between them. Ask the user for substantive product decisions, production integration and costs expected to reach USD 50 or more. Request Cursor only for access unavailable to the agent. Do not send more ZIP handoffs or ask the user to repeat completed checks.
