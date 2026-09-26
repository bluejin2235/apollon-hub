# Production backup, recovery and retention gate

Decision date: 2026-09-26. This policy supplements actual-hub-review-gate.md.
The user authorized preparing code/database backups and removing temporary backups after acceptance and stabilization. This is NOT authorization to merge, migrate, promote or restore production.

## Release prerequisites

- Pin the actual production Git commit and Vercel deployment ID immediately before release. Preserve a named pre-release Git ref; keep Git history. Record configuration revision identifiers without exposing secret values.
- Obtain a consistent database backup immediately before the first approved migration. Verify its completion, timestamp, recoverable scope and private durable location. A successful SELECT or row count is not a backup.
- Confirm the project's actual managed-backup/PITR availability rather than assuming a plan includes it. If a separate logical export is needed, use a supported database backup client and encrypted, access-restricted storage outside the production database.
- Never upload database exports, private paths, employee records or credentials to this public repository. Never use transient scratch storage as the only backup.
- Include schema, data, functions, policies, triggers and grants needed by the affected application. Record exclusions such as Storage object bodies, role passwords and external NAS files. Database backups do not contain Storage object bodies.
- For the context/classification migration, preserve original values of each affected row with its stable identity and migration receipt. Record post-change values so a selective reverse update cannot overwrite later user edits silently.
- Restore the backup into an isolated compatible environment and verify critical objects, representative counts, permissions and old-application compatibility. Record restore start/end times and errors; do not promise an unmeasured recovery time.
- Existing company-PC uncommitted changes remain independently preserved and are not covered by a remote Git commit. Do not replace that worktree.

## Recovery

1. Stop or hold only newly introduced writers that could worsen the issue.
2. Restore the previous application deployment if it is compatible with the current schema. Additive database objects may remain if safe.
3. Prefer targeted repairs/reversal of release effects, preserving conversations and business data created after deployment. Compare current values with migration receipts before restoring old values.
4. If full database restoration is necessary, first preserve post-release data, identify downtime/data-loss consequences and obtain the decision for that recovery scope. Never overwrite production from an old snapshot merely because app rollback failed.
5. Verify real login, LUNA questions, source cards, administrator traces and relevant database integrity before declaring recovery complete.

## Retention and cleanup

- Do not delete the pre-release recovery point before user acceptance of the changed LUNA/admin experience.
- Proposed default: retain the manual pre-release database backup through at least seven consecutive stable days AFTER acceptance. Reset the interval for a material unresolved incident.
- Before cleanup, require no unresolved recovery incident and a newer successful normal backup with verified recoverability.
- Remove only inventoried temporary exports and disposable validation environments created for this release. Record artifact identifier, size, creation time, validation evidence and deletion receipt.
- Keep Git history/pre-release references and the small release/restore manifest. Do not rewrite Git history to save backup space.
- Do not disable or delete the platform's routine backup policy as part of manual-export cleanup.
- A cleanup schedule is not enabled by this document. Schedule cleanup only once acceptance/stabilization dates and exact artifact identifiers exist. Do not delete merely because an estimated date arrived.
- Notify the user before any task expected to incur USD 50 or more.

## Evidence manifest (private operational record)

release_id; production_commit; production_deployment_id; migration_versions_and_hashes;
backup_id_or_private_location; backup_started_at; backup_completed_at; size_bytes;
scope_and_exclusions; checksum_if_exported; restore_test_environment; restore_result;
user_acceptance_at; stability_start; unresolved_incidents; replacement_backup_id;
cleanup_eligible_at; deleted_artifacts_and_receipts.

Status at policy creation: policy prepared; production backup capture and restore rehearsal
not yet verified. Production integration remains pending a separate decision.

References:
- https://supabase.com/docs/guides/platform/backups
