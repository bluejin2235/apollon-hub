# LUNA conversation requirements audit — 2026-10-02

Baseline: production commit `5b4ee05a09fc7b312d0a193b5b0feff6384f44f9` (PR #46), confirmed READY. This audit compares the requests in the current conversation with checked-in code. Implementation is not equivalent to live acceptance.

## Requirements and evidence

| Requirement | Code / disposition |
| --- | --- |
| Compact header, logo opens Hub, current room title | Implemented in LunaChat; no portal header on chat route |
| Mobile full width, left drawer; desktop sidebar visible and toggleable | Implemented in LunaShell / workspace CSS |
| New conversation controls at top | Implemented in LunaChat |
| Remove example query texts; personalized greeting | Implemented in LunaChat |
| Search purpose beside input: docs / images / files | Implemented in LunaInput; focused searches never call Notion |
| Larger controls, round send, stop while answering | Implemented in LunaInput; provider receives cancellation |
| No input focus zoom or horizontal page drift | 16px inputs and contained overflow; this patch fixes viewport listener setup after authentication. Real iPhone keyboard acceptance remains pending |
| Responsive report/source layout | Implemented in AnswerBlock / SourceGroup; narrow single column, wide two columns |
| Notion mark after document title instead of arrow | Implemented in main source rows and document list |
| Work / Rai path copy, check feedback and toast | Implemented; mount conversion tested. Actual Windows Explorer / RaiDrive acceptance pending |
| One status line, elapsed time, actual changing stages | Partial in baseline. This patch rotates only actual running stages, starts all four source stages and distinguishes partial/error/stopped outcomes |
| Keep existing cat; design new search animation separately | Existing cat retained. New character animation explicitly deferred for a separate discussion |
| User-specific OAuth with no name matching/shared-token fallback | Implemented; this patch closes refresh/reconnect revision race and checks returned identity on refresh |
| Only the allowed teamspace, regardless of connected account | Server-owned exact scope, membership checks, dropped-filter rejection. Live per-account/private negative acceptance pending |
| First Notion use prompts connection | Implemented; this patch restores the unsent question after a missing-connection response |
| Preserve intent/context across all search sources | Baseline used previous questions only for Notion. This patch supplies the same contextual query to all sources and focused modes for explicit follow-ups. This is bounded user-question context, not full conversational reasoning |
| Parallel Notion, NAS, image and selected company DB retrieval | Implemented. Other DB currently means company glossary only; not every Supabase table or private conversation memory |
| Slow/failed source must not freeze the report or claim success | This patch adds source deadlines, disclosure of glossary failure, genuine stream failure after model/save errors and cancellation propagation |
| Deduplicate returned evidence | Implemented; this patch includes drive in file deduplication keys |
| Notion chat answer mirroring | Not implemented by design: official MCP search evidence is consolidated by Luna; it does not reproduce Notion's rendered final chat answer |
| Fetch full original documents / iterative follow-up retrieval when needed | Not implemented; currently search excerpts only. Requires a separately verified scope-safe fetch strategy before enabling |
| No twice-daily Notion content index | Cron and principal entry points already disabled. This patch prevents shared image enrichment/link construction from reading the old raw Notion index and blocks reflection of user-scoped evidence |
| Remove obsolete Notion index DB after migration | Not deleted. Inventory includes raw pages/blocks/chunks/embeddings/relations and dependent summaries/links. Need successful personal OAuth + private-negative tests and provenance review before destructive cleanup |
| Development notes at each completed unit | Repo development docs plus append-only Hub decisions with verification/readback |
| Measure actual runtime / verify earlier chat simulation matches live pipeline | Not yet measured end-to-end with an authorized personal Notion connection. Earlier manually assembled reports are not proof of this production pipeline |
| Reduce the region described as “too wide” in missing screenshot | Exact region cannot be confirmed from the missing image. General header/gutter density was reduced, but exact visual acceptance remains pending |

## This patch

- Same explicit-follow-up question context for Notion, NAS and images, including focused modes. New named questions do not automatically inherit unrelated history.
- Four parallel status stages; only actual active stages rotate. Partial source failure is not reported as complete coverage.
- Source deadlines: Notion 90s, Work 30s, images 45s, glossary 15s. These are limits, not measured averages. Providers without abort support may finish an already-started request; timed-out results are never used.
- Failure after response metadata causes a stream error rather than a successful completion; unsaved answers are visibly marked failed.
- OAuth refresh uses the exact persisted token revision, not a later reconnect's revision. This prevents binding old credentials to new identity metadata.
- Shared image descriptions and link builder no longer ingest raw legacy Notion pages/chunks/relations. Previously derived data is not thereby proven clean and has not been deleted.
- Legacy admin connection test uses the current user's OAuth; status text identifies historical index counts and disabled schedules.
- Mobile viewport sizing reattaches after authentication; connection-gated queries remain in the composer for explicit resubmission.

## Acceptance still required

1. A user authorizes their own Notion connection. No consent was performed by the agent; account-level audit status is kept in the internal Hub development note.
2. Test teamspace positive results and private-page negatives with at least two differently authorized users; test reconnect, revoke and concurrent requests.
3. Validate real Notion response shapes, complete report grounding, and collect latency measurements before quoting an average.
4. Real iPhone focus/keyboard/stop and Windows Work/Rai path tests.
5. Review legacy derived data and all consumers, then remove only identified obsolete Notion data without affecting NAS/image indexes, authentication tables or user conversations.
6. Separately discuss the new cat animation; scope-safe original-page expansion remains a follow-up implementation task.

Local test/build results and production deployment status are recorded in the corresponding PR and Hub development decision. Do not interpret this document's implementation rows as successful end-to-end authorization/privacy acceptance.
