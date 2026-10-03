# LUNA A/B/C isolated connection lab

This branch is a standalone, preview-only harness in the Luna repository. Never merge this branch into main: its tree intentionally contains only the lab, not the Hub application. It reads no production database, credentials, indexes or chat history. It has no cron configuration.

Current implementation checks dedicated server-side connection prerequisites. A Custom Agent REST session adapter is present but has not run against live credentials. It does not contain a browser executor or callback MCP server. A returned blocked record is NOT an end-to-end Notion test and MUST NOT be called one. The Custom Agent adapter additionally requires an explicit `LUNA_LAB_RUN_ENABLED=true` activation after scope review. An environment flag records operator review; it is not independent proof of Notion access restrictions.

For every method, the exact question must originate in the test UI. Step 1 needs a corresponding recorded user-message event or visible input in Notion; outbound payload hashing alone is insufficient. Step 2 depends on step 1 and requires the corresponding Notion session to finish. Step 3 depends on step 2 and needs source-side text/citations versus received text/citations comparison. Manual transfer cannot satisfy any missing bridge.

A: needs a real browser worker callable by the preview, per-user Notion browser session, and verified Working-only scope. This conversation's browser tool is not such a worker.

B: needs a Working-only read-access Custom Agent and an API credential scoped to that agent. ChatGPT connector credentials are not deployable Luna credentials. Existing briefing and calendar agents are not approved substitutes.

C: needs A's submission worker and a protected MCP callback reachable by Notion. A reverse MCP connection does not itself provide a trigger for the basic Notion Agent. Compare the callback body with the final displayed Notion answer; do not accept a separately rewritten callback as identical.

No employee rollout or privacy guarantee follows from this administrator-only feasibility test. User isolation, private-page negative tests, revocation, cancellation, timeout and repeatability remain separate required gates.
