# Completion recording

After a completed, verified development unit, record the change in the Hub's LUNA development note as well as GitHub. This is a user requirement, not a background automation claim.

Each entry must identify the reason, commit, completed verification with links, outstanding acceptance conditions and whether production was changed. Do not equate local/CI success with employee relevance or deployment. Keep pending verification explicitly pending.

Use existing service-note and decision records. Append idempotently using the commit or a stable entry marker; preserve existing notes and do not rewrite other authors' history. Re-read the saved record to confirm persistence. Internal operational context belongs in the internal note, not a public PR.

Updating a note does not authorize production code deployment, schema migration, worker replacement or bulk paid operations. Continue independent development while access-dependent integration tasks remain pending.
