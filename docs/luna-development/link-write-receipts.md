# Relationship write receipts

Both normal relationship insertion and follows insertion previously counted the requested batch length despite conflict-ignore semantics. Concurrent builders could therefore report an existing relation as newly generated. They now request returning identities and count only acknowledged unique rows. Conflicts count as skipped; an absent, foreign or duplicate receipt fails explicitly.

Follows evidence enrichment previously ignored update errors. It now requires acknowledgement of the exact target ID before proceeding. This does not add transactional all-run publication, stable project identifiers or automatic stale-link reconciliation.

Unit tests cover receipt validation, conflict counts and failed evidence updates. The real PostgREST fixture additionally races two insert callers, requires counts of zero and one, checks replay preserves the existing confidence, and verifies update and database-constraint failures. No operational relationship rebuild is executed by these tests.
