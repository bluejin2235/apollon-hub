# Stored report reuse and source versions

Read-only DB inspection found 21 active legacy reports, created August 2–11, 2026 (UTC). None of their source records contains last_edited_time, modified_at, or content_hash. Reports therefore exist; the gap is verified provenance/freshness, not absence of all saved secondary results.

`findSimilarReport` previously returned the closest topic/title match without source freshness checks. It now checks both the RPC result and fallback candidates. Automatic reuse requires an active report and every reference to carry matching current indexed source metadata:

- Notion: page_id and last_edited_time; archived/missing/changed pages fail.
- NAS: exact relative path, drive, modified_at and size_bytes; missing/changed/wrong-drive files fail.
- Empty, unsupported, unversioned, or more than 32 references fail. Web revalidation is not implemented, so web references do not pass.
- Lookup errors do not produce a current-source result. Fallback examines at most five similar candidates.

Existing reports remain stored. The 21 legacy reports will not be automatically injected after deployment; normal source retrieval still runs. This is an intentional behavior change. The inspected selfstudy/run POST endpoint is currently disabled, and this patch does not reactivate it or run paid report generation. A future writer must capture the source versions actually provided to generation; merely adding the latest timestamps to old reports would misrepresent provenance and must not be done.

This verifies indexed metadata, not live remote file contents, semantic correctness, per-claim entailment, or complete user authorization. Those remain separate acceptance gates. No production report status, content, or DB schema has been changed.
