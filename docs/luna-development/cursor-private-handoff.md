# One-time private GitHub handoff for company-PC-only source

The existing bluejin2235/apollon-hub repository was verified public on 2026-09-26. Do not publish unreviewed company-PC snapshots there. The connected agent tools cannot create repositories. This first setup therefore belongs in Cursor; later source transfer uses GitHub rather than user-carried ZIP attachments. A new repository may require one-time connector access authorization. This is file/result exchange, not a claim that ChatGPT controls or keeps Cursor running continuously.

## Cursor instruction (room 2 only)

Project: apollon-hub. Room: 2. SSH: TJLEE / 100.65.8.52. Original D:\Dev\apollon-hub is read-only for this handoff.

1. Use the existing authenticated GitHub context; verify the account is bluejin2235 without printing credentials. Discover CLI commands via --help. Do not install persistent services, change authentication, or request/paste secrets. If access is unavailable, report the specific access needed.
2. Create bluejin2235/luna-handoff-private as a PRIVATE repository if absent; if present, verify that it is private. Never fall back to the public Hub repository. Do not change any existing repository's visibility. Do not connect the handoff repository to deployments or add collaborators.
3. In a separate temporary directory, use the already prepared Desktop/luna-hub-local-changes.zip and its MANIFEST.json. Before extraction, reject archive entries with absolute paths, parent traversal or links. Verify included source hashes, recorded base HEAD and included/excluded lists. Do not execute archived scripts. The prior report says 72 included files, 6 exclusions, base 66dcb3fd49301089f75ebcf2804ea4cae77bf8eb; reconcile any mismatch explicitly rather than silently dropping files.
4. Keep .env files, keys, tokens, credentials, runtime state, logs, business data, dependencies and Git internals excluded. Preserve the exclusions of media-index.STOP and the five account/session probe scripts. Recheck included source for secrets; exclude any newly discovered secret-bearing file and report only path/reason, never its value.
5. Commit individual UTF-8 source files under snapshots/20260926-hub-local/source/<original-relative-path> plus MANIFEST.json and a short README with base HEAD/counts/hashes. Do not commit the ZIP; the receiving connector reads text blobs directly. Treat the handoff snapshot as inert source, with no root .github workflows or root executable hooks.
6. Push only a new branch handoff/hub-local-20260926 using the temporary repository. If that branch exists with a different snapshot, create a numbered new handoff branch and record the name; never force-push or overwrite someone else's work. Leave the original repository, dirty files, branch/index, DB, NAS, schedules and deployment untouched.
7. Return repository URL, branch, commit and manifest counts. No source bodies or credentials in the chat. The receiving agent can fetch the fixed repository/branch directly once connector access is allowed; the user does not need to attach the ZIP.

## Follow-up protocol
- Only company-PC-dependent requests go into this handoff: NAS reads, local dirty-file snapshots, and explicitly bounded use of existing authorized local keys.
- Each result identifies request, code commit, execution context, exit status, costs and side effects. Data-bearing logs are not automatically uploaded.
- Agent-accessible code/DB/GitHub work stays with the agent. Do not idle the whole development plan while a handoff is pending.
- A private repository alone does not schedule tasks or run commands. Continuous execution would require a separately configured, authorized runner; none is installed by this handoff.
