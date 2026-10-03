# 2026-10-03 — isolated Luna connection check

Status: readiness checks completed; live Notion integration tests BLOCKED, not passed or completed.

Production main/server/database were not changed by this work. The lab branch intentionally replaces the entire tree with a standalone lab. DO NOT MERGE IT INTO MAIN.

Question: 원형보존지 관련 자료 모두 찾아줘

Requested scope: 아폴론 Working only. No source search took place.

The preview UI actually submitted three requests to its own run API. That API stopped all three before any Notion submission. The observations below are from the rendered preview; they are not Notion session events.

| Method | Request ID | Started UTC | Preflight processing only | Stages |
|---|---|---|---|---|
| A | 9fd41913-e325-4c0b-a91a-b5872ed121b9 | 2026-10-03T14:21:42.432Z | 5.04 ms | blocked / not_run / not_run |
| B | 38a477e6-8353-4400-baf8-daad5a3d2c8b | 2026-10-03T14:21:50.635Z | 0.60 ms | blocked / not_run / not_run |
| C | 4937fae9-b1a1-4729-9c33-1a1bc8e4bc77 | 2026-10-03T14:21:58.595Z | 0.58 ms | blocked / not_run / not_run |

Question SHA-256: 8c00a5295e45c94aac9295fcd7effb47f98b7168536bcdad6b5b3967a17a444a

All three: no Notion session ID, no answer, no citations, no measured generation/transfer/total latency or per-search cost. The millisecond figures are ONLY local prerequisite check processing, not search speed or a browser round trip.

A: browser executor code/service and authenticated per-user profile are not implemented/connected to the preview. ChatGPT's signed-in browser is not callable by Luna. Working-only scope remains unverified.

B: official REST adapter written but not run live. A blank dedicated Notion Custom Agent was created and saved with no page access, web access off, mention trigger off, no schedule. Agent has not been connected to the preview with a scoped API credential. Private exclusion is therefore not a tested guarantee. It is a Custom Agent, not the basic Notion AI product.

C: no browser executor and no authenticated callback MCP server are implemented/connected. An MCP callback cannot initiate basic Notion AI by itself. Callback text must later be compared against the completed Notion answer; the model may otherwise rewrite it.

Further user-dependent prerequisites: approval for specific Working page-tree read access for the dedicated test agent; secure provisioning of a scoped API connection; for A/C, a separate callable browser runtime with an authorized persistent Notion session. A service subscription or new credential is not created silently. Existing broader briefing/calendar agents are not reused.

Remaining implementation owned by developer: A executor, C callback, connection wiring, secure credential input, scope verification, and the actual identical-question end-to-end runs. User authorization alone does not complete these items.

Local build passed. Acceptance checks cover duplicated question, truncated answer/missing citations, and missing prerequisites; they are synthetic code checks, not live Notion tests.

No response-time average or per-search price can be reported from these observations. Official example pricing and cost locations are described in public/lab-report.html and must not be mistaken for measured Luna costs.
