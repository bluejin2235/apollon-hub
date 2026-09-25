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
