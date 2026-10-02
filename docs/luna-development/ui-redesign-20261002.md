# LUNA UI development — 2026-10-02

Approved reference: luna-preview.html, Library version 1. Production implementation branch: codex/luna-ui-production-20261002. UI changes ported onto production main bc905d5; development search-quality changes excluded.

## Implemented
- One chat header: left history toggle, Apollon home logo, current conversation title, new conversation.
- Desktop sidebar shown initially and collapsible. Mobile drawer opens from left with backdrop, Escape, focus containment and focus return.
- Full-width mobile workspace; portal padding removed only on /luna. Composer stays in layout and follows visualViewport keyboard height; editable text is 16px without disabling pinch zoom.
- Existing Luna cat and signed-in profile greeting. No suggested question chips.
- Integrated 자료 / 이미지 / 파일·폴더 choices. Documents retain the existing engine. Explicit image and file requests use separate retrieval-only pipelines, after the existing access and conversation ownership checks, with no Notion fallback. Actual returned cards and timings are saved in conversation messages.
- Round send/stop button, AbortController on request, cancellation propagated to streamed model providers, backend cancellation checks before steps/persistence. Already-started third-party searches may finish before reaching a cancellation checkpoint; cancellation does not promise immediate termination of every external operation. Interrupted draft text remains on screen but is not newly persisted as a completed answer.
- Single current server-reported progress line and elapsed time; no invented timed stages. Existing cat is temporary; new progress cat animation remains a separate design task.
- Wider results use two source columns; narrow results use one. Notion mark follows title. Work / Rai copy controls show a check only after clipboard success. Rai respects the signed-in user's mount settings, with the existing project's Z:\Work / Z:\Partners defaults.

## Explicitly separate work
User-specific Notion OAuth/MCP, teamspace allowlisting, exclusion of all private Notion pages, Notion AI live retrieval, and eventual removal of obsolete Notion indexes are NOT implemented by this UI change. Never show the mockup's private-exclusion policy as an enforced guarantee. No indexes or DB tables were deleted or migrated.

## Verification and authorization
User explicitly authorized direct production implementation on 2026-10-02 because employees are not using the service. This supersedes the earlier preview approval gate. Notion AI mirroring remains the next separate task.

Run focused retrieval, cancellation and Rai mapping tests, TypeScript and production build against the production baseline. Mocked tests do not establish authenticated end-to-end correctness. Physical mobile keyboard and authenticated browser checks have not yet been completed; local Chromium installation failed.
