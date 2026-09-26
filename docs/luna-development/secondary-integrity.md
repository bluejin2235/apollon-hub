# Secondary relationship integrity

## Read-only observations on 2026-09-25

- Active relations: 48,276. These are links, not 48,276 independently validated insights.
- Active NAS-to-project memberships: 30,771. Of these, 172 do not match the current NAS directory index, including after case/separator normalization.
- Missing index entries can mean moved/deleted files, stale relationships, or incomplete primary indexing. No deletion or deactivation was performed. Resolve scanner completeness and compare source paths before changing status.
- Pending links: 3, all confidence 0.6. The default expansion threshold of 0.7 currently prevents these three from entering answers. The old `status != rejected` condition nevertheless allowed pending links whenever confidence passed the configured threshold.

## Change

Both direct/reverse expansion and project sibling expansion now explicitly require active status. Confidence alone does not authorize a pending relationship. Existing confidence gates and archived-page filtering remain. Two tests exercise the actual expansion function with high-confidence pending/rejected links and active siblings.

## Remaining integration gates

1. Confirm a complete primary snapshot from the actual PC scanner version.
2. Classify the 172 unmatched memberships without assuming source deletion; retain evidence and record reconciliation decisions.
3. Add source revision/snapshot provenance and invalidate derived outputs on verified source changes. Rebuilding currently skips existing relation keys and does not itself establish freshness.
4. Validate project identity across years, duplicate names, and drives before creating saved comparison/summary insights.
5. Derived answers must preserve source identities and indicate insufficient/conflicting evidence. Do not promote relation counts or self-study misses into a quality claim.

`scripts/sql/audit-luna-link-integrity.sql` reproduces aggregate checks without writing data. This change does not implement the full reconciliation or derived insight subsystem and does not alter production DB state.

## Follow-up classification (2026-09-25)

A read-only, time-limited database query classified all 172 unmatched paths:

| Classification | Count | Interpretation |
| --- | ---: | --- |
| One same-name candidate in the same drive | 46 | Possible move; filename alone cannot establish identity |
| Multiple same-name candidates in the same drive | 107 | Ambiguous; cannot automatically relink |
| No same-name candidate in either drive | 19 | Unresolved; rename, deletion, exclusion, or incomplete indexing remain possible |
| Same name only in another drive | 0 | No cases observed |

Five inspected examples from the first group point to files now located in different reference subfolders within the same project. This supports a relocation hypothesis but is not content-hash proof. No relations were changed.

The audit must include project folder bundles as well as files. A file-only inventory incorrectly marks 198 existing folder relations as missing. The regression fixture explicitly preserves a valid folder relation.

`classify-luna-link-integrity.sql` normalizes drive case and separators, materializes the current index, and groups candidate names once. Execute within a read-only transaction with a statement timeout. The test runs the SQL against isolated PostgreSQL in a read-only transaction, checks candidate categories, and verifies that relations remain unchanged. Live file identity and scanner completeness are still required before reconciliation.

## Primary text freshness cross-check

In the same read-only investigation, all 19,558 `nas_file_text` rows matched the current directory index by drive/path and file size/modified time. Counts: ok 18,263; empty 173; failed 87; skipped 1,035. Missing index matches: 0 in every status. Metadata mismatches: 0 in every status. Therefore the 172 unmatched relationship paths do not establish missing/stale extracted text. They are a separate relationship reconciliation issue.

`audit-luna-text-freshness.sql` reproduces this comparison. These are database metadata checks, not live NAS reads or a content hash verification. The known zero-embedding backlog remains a distinct issue.

## Perspective usage isolation

The perspective builder previously read all `luna_messages` before counting user-question terms, including synthetic conversations. It now loads user messages in stable pages and verifies each parent conversation is explicitly production and is not a harness title. Missing parents are excluded; provenance/query errors abort the perspective phase before its writes.

A rebuild also resets obsolete usage counts to zero for automatically generated (`source=data`) perspectives missing from the newly computed terms. Manually owned rows are excluded from this reset, and current terms are recomputed normally. Dry runs report the proposed reset count. This fixes old counts surviving when their only inputs were test conversations. Existing stored counts have not been rebuilt in production.

Tests cover synthetic/harness/orphan/assistant exclusion, lookup failure, a 501-message page boundary, and obsolete/manual count handling. This closes the conversation contribution path; it does not claim provenance validation for every existing library document or previously persisted insight. The foundation data-context migration must precede deployment of this reader.

## Source pagination integrity

The relationship/perspective builder previously fetched source tables with offset pages but no explicit ordering. PostgreSQL does not guarantee row order without an order clause, so crossing a page boundary could miss or repeat source rows even without an intentional filter. Every shared source-table reader now orders by its actual primary key, including all three columns of the Notion relationship key. It selects those keys for validation, rejects repeated/missing identities, and surfaces absent/error pages instead of silently returning a partial corpus.

Tests cover an unsorted 1,003-row source, a composite-key boundary, repeated rows and lookup failures. This is deterministic pagination, not a transactional snapshot across concurrent changes. Concurrent source deletion can still shift an offset without producing a duplicate, and later builder phases are not an all-or-nothing transaction. Run a rebuild after source ingestion completes; cross-source snapshot/version tracking remains open. This change does not rebuild existing production relations.
