# Atomic NAS text publication

Development only. No production migration, scheduler change, real extraction or embedding run is performed by this change.

## Problem and change
The previous CLI deleted old chunks, separately upserted metadata, and inserted new chunks in batches. An insertion failure could leave a partly replaced source. Its catch then overwrote metadata with failed, even if another process had published a newer result. Some outcome counters were incremented before persistence and could count one file twice.

nas_text_publish now commits metadata and the complete chunk replacement in one PostgreSQL transaction. It takes a per-path advisory lock and checks the metadata updated_at version loaded by the worker. A stale writer is rejected. The directory is held under a short SHARE lock to prevent snapshot changes during publication; normal readers remain available. Indexed source drive/path/size/mtime must still match, and cross-drive path ambiguity is rejected because the existing text primary key is path-only.

Exact ordered chunk content, hash and sequence continuity preserve existing IDs/embeddings. Equal hashes alone no longer hide missing chunks. Changed contents replace all chunks and remove obsolete vectors. Empty, skipped and failed extraction outcomes publish zero chunks atomically. A persistence failure leaves the previous transaction state intact and counts a failed attempt without a second metadata write. A network failure after server commit is uncertain; there is no automatic retry or direct-write fallback.

The CLI checks physical size/mtime before and after extraction. A different directory version, failed stat, or file changing during extraction blocks publication. These metadata comparisons are not proof against an edit that preserves size and timestamps. A missing file can be recorded as an extraction failure only if its indexed version still matches the RPC checks.

## Deployment gates
1. Validate migration and RPC permissions through a separate Supabase/PostgREST environment; fixture tests are not this acceptance.
2. Stop existing text runners before switching them: older direct table writers do not observe the new CAS contract. This change does not provide a process scheduler lock.
3. Apply the migration before deploying/running the changed worker. Missing RPC fails closed; no destructive legacy fallback.
4. Validate a bounded company-console extraction only after migration approval. Do not repeat already completed NAS access or PPTX parser checks.
5. Keep production migration, merge, scanner/worker replacement and schedules on hold pending integration approval. No bulk retry or paid embeddings are authorized by these tests.

## Verification and limits
- Disposable PGlite SQL tests inject a mid-insert failure and verify equivalent prior metadata/chunk IDs/embeddings; test repair, stale versions, directory changes, ambiguity, invalid payloads and function execute permissions.
- Actual CLI dependency tests cover one outcome per file, failed RPC without fallback, physical changes and unreadable stat.
- PostgreSQL 16 CI adds simultaneous publications: a stale writer waits, then fails after the winner commits; readers see no partial publication. An injected chunk failure rolls back metadata and chunks together.
- Fixture embedding columns are text placeholders used to verify preservation, not pgvector search tests. Existing 1536-dimensional embedding selection is unchanged.
- Historical bad rows are not repaired globally. Run-log ownership, purge-missing behavior and robust drive/path primary keys remain separate work.

## Read-only production integrity audit, 2026-09-26
The count audit found 3 ok sources with no chunks (three PDFs expecting 1, 1 and 10 chunks, with text lengths 12, 159 and 7,414). It also found 15 failed sources retaining 1,300 old chunks. No sequence gaps were found. This identifies inconsistent stored state, not its exact historical cause. No source text, filenames, credentials or operational records were changed.

The worker now calls the read-only service-only nas_text_incomplete_paths RPC while building its queue. Ok files with absent, mismatched or discontinuous chunks are retried even when their indexed size/mtime is unchanged. Its array result avoids PostgREST set-returning row caps. Failed files were already retry candidates. Actual repair still requires the approved deployment and a worker run; no historical rows have been repaired by this development work.

## Run receipt reliability
Starting a run no longer marks every other running record interrupted. Extraction and embedding may be live concurrently; starting one is not evidence that the other stopped. Progress and completion writes require the matching run ID to remain running and must return that row. Database errors, missing start receipts and completion failures propagate to the worker instead of being logged as warnings followed by a successful exit.

This is receipt integrity, not a scheduler lease. Abandoned running records still need explicit diagnosis/recovery; elapsed time or a newly started process alone does not prove interruption. The legacy interrupt helper remains available for compatibility but is not called by startNasTextRun. Existing records were not changed.
