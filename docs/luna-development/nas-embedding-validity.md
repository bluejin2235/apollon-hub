# NAS embedding validity and billing boundary

Development only; no migration, paid provider call or operational data mutation was performed by these tests.

## Why
The earlier worker selected every null-vector chunk. A read-only audit on 2026-09-26 found 1,300 retained chunks under 15 failed sources; those could consume paid calls despite not being usable current evidence. The worker also separately counted remaining null vectors and then marked the file indexed, allowing a changed file to inherit a stale completion marker.

## Behavior
- The service-only nas_embedding_candidates RPC returns bounded eligible rows in UUID keyset order: ok metadata, complete contiguous chunks, matching latest directory size/mtime/drive, no cross-drive path ambiguity, null embedding and meaningful text beyond page delimiters. UUID order is traversal, not relevance. It returns at most 500 rows per page; selected run limit stays 5,000 maximum and default 500. Exclusions do not consume the selected-work limit.
- Each planned batch is read again immediately before a paid request. The worker compares exact ID/path/sequence/content/source revision; removed, edited, already embedded or invalidated rows are skipped without payment. Read errors fail closed.
- The original whole-run budget bounds the selected corpus before run creation/payment. Revalidation can only shrink that plan. Requests remain bounded, default dry-run, explicit --apply, no automatic paid retry.
- After payment, nas_embedding_store_batch revalidates inside the storage transaction under the same source/path locks as text publication. Changed sources receive no vector. It verifies 1,536 finite float-compatible components and refuses zero vectors; vector writes and the completed indexed_at marker roll back together on any error.
- indexed_at changes only when the complete current file has all vectors. It does not change the extracted source updated_at revision token, so later batches from the same revision remain valid.
- Unknown provider usage is explicitly recorded in the run error and warning. Recorded cost is acknowledged usage only, not a promise that an unacknowledged/timeout request was free. A store failure preserves acknowledged paid cost and is not retried automatically.

## Verification
- Disposable PGlite with its actual pgvector extension verifies source exclusion, keyset continuation, post-payment invalidation, completeness, duplicate/permission checks, real vector dimensions and transactional rollback including completion-marker failure.
- Actual CLI tests verify dry-run, budget preflight, pre-payment invalidation/read errors, acknowledged-only writes, post-payment changes, unknown usage, receipt failures and no retries/direct-write fallback.
- PostgreSQL 16 + pgvector CI verifies concurrent text publication vs vector storage, concurrent duplicate stores, reader visibility and atomic completion. Synthetic fixtures, not operational NAS files or paid vectors.

## Deployment and limits
Apply both text-publication and validated-embedding migrations before switching workers. Stop legacy direct writers first. Current missing-RPC behavior is failure; there is no legacy destructive fallback. Existing production-equivalent Supabase API, physical source, local dirty-source integration and employee relevance gates remain outstanding. Production migration/deployment and bulk embedding remain on hold.

There is still no cross-process claim before the external provider call: two simultaneous paid workers may each pay for a chunk despite only one storing it. Keep one embedding worker until a claim/lease protocol is implemented. Source checks concern indexed metadata and extracted text, not live NAS content hashes. Oversized model inputs are rejected by the existing budget client rather than silently truncated. No threshold or semantic relevance claim changed.

## Retrieval follows current drive snapshots too
The shared currentNasBodyFiles guard used by NAS keyword/vector retrieval and sample selection now reads the latest scan generation for every involved drive. It rejects a surviving old path row that is absent from that generation and rejects a relative path currently ambiguous across drives. Old disagreeing generations no longer disqualify a matching current generation. Missing/failed snapshot lookups fail closed.

This adds one latest-generation read per involved drive per helper call (cached within that call). The real Supabase-client transport fixture verifies the extra request together with Windows-path escaping. These remain indexed snapshot checks, not physical NAS hash checks or an atomic snapshot held through answer generation.
