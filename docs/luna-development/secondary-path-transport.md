# Relationship endpoint transport

Relationship expansion includes NAS paths among seed IDs and text project keys among membership targets. Those identifiers may contain backslashes, quotes, commas or parentheses. Direct supabase-js IN formatting can alter quoted Windows paths.

Forward, reverse and project-sibling lookups now use the shared escaped PostgREST text-list formatter. Status, confidence, relationship kinds and result limits are unchanged. The regression runs the actual installed client's request construction through a controlled transport, verifies all three endpoint filters and checks that the related source excerpts are returned.

This fixes identifier transport. It does not validate the underlying relationship, establish a stable project ID, or replace a live PostgREST and employee relevance acceptance test.
