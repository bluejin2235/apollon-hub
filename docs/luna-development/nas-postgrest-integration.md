# Isolated PostgREST integration

The database CI fixture now runs PostgREST v14.15 against its disposable PostgreSQL/pgvector container. It uses synthetic source rows, vectors, credentials and short-lived local JWTs only. The verifier refuses any database host/name other than the dedicated loopback CI fixture and accepts only an explicit fixture flag.

The actual installed supabase-js client sends HTTP requests to PostgREST. A transport adapter removes Supabase's gateway prefix because this fixture exposes PostgREST directly; response data is not mocked. Checks cover escaped Windows paths, source/report membership, candidate selection and revalidation, vector storage receipts, completion markers, worker ownership and denied anonymous/authenticated access. A newer snapshot must invalidate surviving old paths.

This adds real API serialization and permission coverage to the existing native SQL concurrency checks. It does not replicate the entire hosted Supabase gateway, production schema, production indexes, physical NAS or employee UI. No paid embedding provider is called.
