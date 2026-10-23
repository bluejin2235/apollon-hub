# Notion original-answer bridge — pilot, not deployed

## Observed evidence

On 2026-10-03, ChatGPT's authenticated cloud browser opened the user's existing personal Notion AI conversation and read 1,245 characters and 8 citation URLs from the rendered answer DOM. A new personal AI run, using the UI source selector for only 아폴론 Working and disabling other sources, returned 2,123 characters, 9 citation links and 29 links overall. A second DOM read matched the first text exactly. Completion was observed after 45.693 seconds (still running) and by 54.544 seconds (finished). The input adapter accidentally duplicated the question in that run. This is not a controlled quality comparison or an average latency measurement.

The Copy response button displayed success, but the cloud clipboard returned empty. Successful extraction used the displayed answer DOM, not clipboard or an internal Notion endpoint. Browser DOM extraction preserves visible text, including whitespace; it does not establish byte-for-byte equality with Notion's internal response payload. Links are returned separately. No claim of screenshot-identical rendering is made.

A separate synthetic Custom Agent API/connector test received a 1,183-character completed answer. This is a DIFFERENT product path and must never silently substitute for personal Notion AI.

## Implemented here

- New admin-only POST `/api/luna/notion/answer`, separate from existing chat routing.
- Explicit disabled-by-default pilot gate and per-user allowlist.
- Server-owned user identity and fixed teamspace from an existing personal OAuth connection; no credentials are sent to a worker.
- Original text is returned unchanged. No LLM, snippet search, shared index, shared memory or fallback.
- Request/reply HMAC, random request ID, exact question, connection revision, account/workspace identity, completion time, text hash and scope checks.
- Recheck personal connection after completion. Reject disconnect/reconnect or account change.
- Fail on oversized replies instead of truncating. Forward cancellation/deadline to the transport.

## Missing executor — concrete integration boundary

The ChatGPT cloud browser is an interactive tool available in this conversation. It is NOT a deployed Luna browser-worker service, and the existing Notion MCP OAuth connection does NOT create a website browser session. There is currently no configured executor URL or per-user browser session binding in Luna. Do not enable this pilot until that executor exists and is verified.

`LUNA_NOTION_ANSWER_WORKER_URL` is a proposed endpoint of OUR service, not an official or discovered Notion API. Setting a URL does not implement the executor.

Required executor behavior:

1. Verify HMAC and request expiry before any action; atomically reserve request ID to prevent replay. Maintain at most one active run per bound browser profile. Never retry a potentially submitted question automatically.
2. Bind the actual logged-in Notion account to the authenticated Luna user using verified IDs. Display-name or email-text comparison is insufficient. Never use the CEO's browser for employees.
3. Operate a separate authenticated browser profile for each allowed user. Login is through Notion's own secure UI, never pasted passwords/cookies in chat or database logs.
4. Select only the fixed teamspace and disable all external sources before submitting; recheck after completion. Do not treat a prompt instruction as access control. Scope attestations from the worker are NOT a proven privacy boundary. Private-page negative tests and underlying access isolation must pass before employee release.
5. Enter the exact question once in a new personal-AI chat; read it back to prevent the duplicated-input bug seen in the exploratory test.
6. Wait for real completion controls, not stable text alone. Stop/error/captcha/login/schema changes must fail closed. Do not bypass site security challenges.
7. Capture only the final rendered answer and its citation anchors. No hidden state/network/cookie extraction. Return original text without rewriting, with SHA-256 and the verified chat URL.
8. Stop the UI run on cancellation/deadline/disconnection. Transport abort alone does not prove that browser generation stopped.

Expected reply format is `OriginalAnswer` in `lib/luna/notion-answer/protocol.ts`. Sign the exact serialized UTF-8 response using `X-Luna-Signature`. The signature authenticates our worker only; it does not prove Notion origin or confidentiality without a trustworthy executor.

## Activation gates

No environment flags or production routing were changed in this patch. The pilot requires `LUNA_NOTION_ANSWER_PILOT=1`, an explicit `LUNA_NOTION_ANSWER_PILOT_USERS` allowlist, an HTTPS executor URL and a secret key of at least 32 characters. Only configure these after the executor is built and reviewed.

Before routing normal chat here: run an actual Luna request → bound Notion browser → final answer → Luna response test, compare unchanged text/hash/citations, verify two-user isolation and Private exclusion, then verify cancellation and login expiry. Local mock transport tests cover receiver logic only. They do not satisfy those live gates.

The current production chat remains the separately documented MCP-snippet synthesis flow until that gate passes; this patch does not mislabel it as mirroring or re-enable the disconnected legacy index.
