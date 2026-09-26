# Actual-Hub LUNA review gate

The user review takes place on the real Hub LUNA and its administrator view. A successful development deployment is only a build check. Do not represent a Preview URL or a synthetic SQL fixture as the operational result.

## Before production integration

1. Confirm that the draft PR head is green in TypeScript, foundation tests, native PostgreSQL/PostgREST checks and Vercel Preview. Read the exact commit being considered.
2. Review the original Hub worktree's pending edits, especially any administrator dashboard overlap, before replacing or incorporating them. Preserve both independently authored behaviors.
3. Record a read-only baseline in the real Hub for typo/exact project names, source cards, a follow-up, an unrelated project and genuinely absent data. Keep the source snapshot and question wording for comparison. Historical answers lacking saved metadata must be labeled unrecorded, not zero-search.
4. Review the five pending migrations in their version order. They add source-context security, a staged NAS snapshot path, atomic text/chunk publication, bounded embedding RPCs and a worker gate. The context migration marks narrowly identified test conversations and learnings; inspect the affected rows before applying it. Snapshot commit can replace a drive's directory rows atomically when the new scanner calls it; do not run that job as part of a UI release.
5. The user authorized the integration subject to the backup/recovery gates in backup-recovery-retention.md. Complete those gates and review the exact release contents; build success alone is insufficient.

## Controlled application and verification

Apply approved migrations before the corresponding code. Deploy the exact reviewed commit, confirm the actual production deployment ID and check that ordinary LUNA questions still work. Run only a bounded, explicitly selected source processing sample when its worker and budget are ready. Verify database write receipts and source freshness, then ask the same questions in the real Hub and inspect each saved conversation in the administrator view. Search candidate counts, saved cards, relation links and derived insight are separate measures.

If a check fails, stop further source jobs and restore the prior production application deployment. Additive schema changes and any data already changed by an approved migration do not automatically roll back with a Vercel deployment. Investigate those separately before claiming restoration. Do not run bulk embeddings or replace the scheduled NAS scanner during the first review without their own acceptance checks.

## Current hold

The draft PR is not merged and the five new migrations are not applied to production. The approved isolated restore database is provisioned and the migration rehearsal has run there. Production integration is already authorized conditional on backup verification. A deployment-time consistent backup remains required; do not equate an older scheduled backup with that release recovery point. Actual-Hub review follows a verified production deployment.
