# User-scoped live Notion retrieval

The production chat now uses the official Notion remote MCP with per-Luna-user OAuth authorization code + S256 PKCE. This is retrieval of search evidence, not scraping or mirroring the rendered Notion chat answer.

## Authorization and source boundary
- Server verifies the Luna session, Luna access and conversation owner before retrieval.
- OAuth state is single-use and bound to the authenticated Luna user, an HttpOnly browser binding cookie and ten-minute expiry. Redirect destination and provider endpoints are pinned.
- Tokens are AES-256-GCM encrypted, authenticated with the Luna user ID as associated data. The key is derived using HKDF with a separate application purpose. An optional dedicated LUNA_NOTION_ENCRYPTION_KEY takes precedence over the existing server-only SUPABASE_SECRET_KEY; key rotation requires reconnecting.
- Connection and pending OAuth tables have RLS, no browser policies, and no anon/authenticated privileges. Only server service_role can access them. No raw tokens or authorization codes are returned in status/error responses or logs.
- Notion user/workspace IDs are stored from the token exchange. A unique workspace/user constraint prevents reusing one Notion identity across multiple Luna users. Display names never authorize requests.
- Token rotation uses a per-grant compare-and-swap database lease. Revoked grants require reconnection. Results are discarded if the saved grant changes while retrieval is running.
- The allowed teamspace is server-owned. Membership, exposed tools and current tool access are checked. Exact teamspace filters are sent on every search; all notices, unexpected result shapes, explicit private/mismatched results and non-Notion URLs fail closed. No Notion bodies are fetched by following arbitrary links.
- Scope enforcement relies on Notion's documented exact-filter contract. Tests are not a mathematical guarantee against upstream bugs. Real per-account authorization and a private-page negative test remain mandatory acceptance checks after the user's OAuth grant.

## Retrieval and UI
Notion, NAS, image search and the shared company glossary run in parallel. Only the user's recent questions supply context; old assistant answers, shared Notion-derived reports and indexed Notion pages are not read by the new chat pipeline. It consolidates actual source snippets with original links, file paths and image cards. Partial failures are disclosed. Image/file-only modes do not need Notion login. Automatic shared reflection of chat evidence is suspended pending provenance review. Existing owned image/PDF attachments retain direct analysis without a Notion grant.

A connection dialog is available next to the composer and opens on the first document request without a grant. Password entry happens on Notion. A popup returns to Luna; blocked popups fall back to same-tab navigation. The user can disconnect or reconnect.

## Legacy retirement
The production Notion indexing cron is removed. Shared-token search, indexed Notion search and index runner entry points are blocked. Existing index tables are retained for now: destructive cleanup is deferred until user-specific live retrieval passes acceptance and consumers of each old table are inventoried. No Notion content index was deleted in this release.

## Verification
- Fourteen focused tests passed: ownership/grant gate, parallel retrieval, scoped failure behavior, encrypted owner-bound tokens, exact scope, private/dropped-filter rejection, legacy access block, existing focused search, Rai paths and model cancellation.
- New schema exercised locally and applied to the existing production Hub project. Readback confirms RLS enabled, anon/authenticated SELECT denied and service_role SELECT allowed. The advisor's no-policy notices are deliberate for these two server-only tables.
- TypeScript and production build checked locally. No claim of live Notion search success is made before an end user completes OAuth.

References: https://developers.notion.com/guides/mcp/build-mcp-client and https://developers.notion.com/guides/mcp/mcp-supported-tools
