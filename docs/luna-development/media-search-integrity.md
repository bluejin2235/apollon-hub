# Media search integrity

Image embedding matches hydrate their descriptions, project metadata and preview URLs using the shared escaped PostgREST path filter. Quoted Windows paths no longer lose identity during this lookup.

The missing-RPC fallback now accepts only complete, finite, nonzero vectors of the configured embedding dimension. It no longer removes invalid components or compares the shorter prefix of mismatched vectors. Invalid query vectors return no matches before database access. Invalid or overflowing similarity calculations cannot become image hits.

Regression tests exercise the installed Supabase client transport for metadata hydration and the actual fallback scorer with valid arrays, serialized vectors, truncated vectors, invalid components and zero vectors. The matching threshold is unchanged. This does not establish full-corpus fallback coverage, current physical file freshness, image interpretation accuracy or employee relevance acceptance.
