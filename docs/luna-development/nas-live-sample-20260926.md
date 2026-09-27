# First live embedding sample and path-filter follow-up

## User-reported room 1 result

- Executed isolated commit `64fc4f8f6d6bd51188e72e05d88dd3ac1857e8ec` on TJLEE.
- Dry-run and execute both exit 0; existing Hub/scanner checkouts untouched.
- 20 candidates, 2 files, 4 chunks; 1 live request, 2,725 tokens, 1,536 dimensions.
- Reported input cost USD 0.0000545; reserved upper bound USD 0.0001248;
  configured invocation budget USD 0.01. Database writes 0.
- Source manifest `bad6782f2f3fb55eb0b1d8dc2af4170fbbd617a6f3f5f066c551f0afa835e16f`
  was identical in dry-run and execute.
- Similarities: 0.19275902093548625, 0.18678153215168952,
  0.15050842127661837, 0.033195145417375685.

This proves the tested live embedding transport and local vector ranking completed.
It does not establish relevance, production RPC performance or employee UI behavior.
The current NAS threshold is 0.30 in both code and the RPC default (read-only verified).
These four sample scores are below that cutoff; they are not accuracy percentages.
No threshold was lowered and no vectors were persisted.

## Follow-up read-only investigation

The same first 20 successful metadata rows matching 해운대 all match the indexed source
drive, size and modification time in SQL. Each has one matching directory row.
Only ordinal 2 and 3 lack parentheses in their Windows paths; those are exactly the
two files in room 1's output. The other 18 have parentheses and backslashes.

The selected three longer chunks are an old architecture reference newsletter,
not the requested project's proposal. The fourth is exactly a PDF pagination marker
with no meaningful source body. Their low scores do not diagnose embedding-model quality.

The installed supabase-js/PostgREST client wraps IN values containing parentheses or
commas in quotes but does not escape the existing backslashes. PostgREST's documented
quoted-value grammar treats backslashes as escapes:
https://docs.postgrest.org/en/stable/references/api/url_grammar.html#reserved-characters

The newly added freshness guard on the development branch used this unsafe `.in(path)`
form too. This was missed by the earlier object-level DB mocks. Tests using the real
installed HTTP client now reproduce damaged path serialization and verify preserved
identities after explicitly escaping quoted list values. The test transport/parser is
controlled; the patched live Supabase API still needs room 1's read-only confirmation.

## Changes

- Shared quoted text-list serializer escapes backslashes and quotes, and callers use
  raw `.filter(column, "in", ...)` to avoid a second `.in()` transformation.
- Freshness and NAS keyword metadata hydration use the serializer. Combined filters
  split by encoded length and count; a single long path remains intact and can still
  exceed an endpoint's URL limit. A failed freshness lookup never proves a source current.
- Sample selection now prefers recently modified matching files before path order;
  it remains a biased, bounded sample, not a recall benchmark.
- Sample reports expose matched/excluded metadata counts and marker-only/empty chunk
  exclusions. Pagination-only chunks are excluded before paid calls. Existing DB rows
  and extraction statuses are unchanged; global repair of empty extracted sources remains.
- Full unit/regression suite: 125 pass locally, including actual client URL construction,
  quoted-path round-trip, freshness, stale-source exclusion and sample marker exclusion.

## Room allocation and next check

- Room 1: Hub SSH sample API validation. Do not rerun NAS access or full PPTX extraction.
- Room 2: existing dirty Hub changes versus integration commit; read-only comparison.
- Room 3: extraction failure categories; read-only DB/code investigation.

Room 1 should use the fixed development commit in a separate temporary checkout and
run ONLY the dry-run sample first (same query and term). Report metadata_matched_files,
metadata_excluded_files, selected_files/chunks and exclusion counts. No --execute yet:
the next check concerns PostgREST path correctness, not another paid model call.
Changed ordering means the source manifest will differ; this is expected and is not
evidence of an indexing change. No production merge, migration or deployment occurred.
