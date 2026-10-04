# C receiver trial — 2026-10-04

The isolated preview includes a stateless MCP receiver with expiring encrypted job and receipt tokens. The receiver accepts only an answer payload and does not search company repositories or write company documents.

Distinguish three checks: unchanged question delivery, completion of that request by the intended Notion agent, and receipt/integrity of the resulting answer. Successful MCP transport is not proof that a browser-exported answer is byte-identical. Preserve the pre-transfer source, compare tool input to received text, and compare citation targets separately. Formatting normalization must never be reported as raw equality.

A browser-driven basic-agent run and a Custom Agent API run are different execution paths. Their timing and coverage must not be conflated. A supervised trial does not establish unattended multi-user readiness or hard exclusion of private sources.

Preview authentication remains enabled. A temporary deployment-scoped share session can require a cookie header for a server-to-server MCP client; a share URL alone is not sufficient in every client. Do not use a project-wide automation bypass as a substitute without authorization. Trial connections and receipts expire and are not production credentials.

Sensitive questions, answers, source paths, identifiers, tokens, hashes and evidence screenshots are retained only in the owner's private report, not in this repository. Production and indexing databases were not changed by this trial. Do not merge this standalone lab tree into production.
