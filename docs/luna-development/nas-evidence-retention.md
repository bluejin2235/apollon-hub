# NAS body evidence retention

The production chat path ran filename/directory search before body keyword and vector search. Both body-result loops skipped every path already present, discarding newly retrieved snippets. This is independent of the currently empty embedding column: keyword body matches were affected too.

The two chat loops now share `mergeNasTextEvidence`. It enriches matching files, retains original file metadata and rank, bounds context, and keeps known T/P drives separate. Ambiguous paths without drive identity are not attached to either file. Existing result ranking, project filtering, and top-N limits remain in force.

Validation: three focused tests cover enrichment without mutation, drive ambiguity, and duplicate/bounded evidence. Scoped TypeScript check: 731 files, no errors. Full repository CI is required. No production data writes or deployment.

Limits: the downstream top-N pipeline can still exclude evidence. This does not unify evaluator retrieval with production, prove live answer quality, or fix the underlying drive-less chunk schema. The evaluator and production need shared retrieval before scores can be treated as comparable. NAS text source freshness, access controls, and live citation behavior remain acceptance checks.
