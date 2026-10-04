# Full-scope retest status — 2026-10-04 KST

This is an isolated preview branch. Never merge the lab tree into production main.

## Verified configuration

The logged-in Notion source picker offers three teamspaces: 아폴론 Working, WORKING, APOLLOG. All three were selected and external sources switched off. This is UI filter evidence only, not proof of access-control isolation or exhaustive search.

The previous A validator only accepted Working. It now rejects a missing teamspace, duplicates, and enabled external sources. B also requires explicit full-scope review; checking a box is operator attestation, not independent permission verification.

## Actual remaining blockers

- Preview build is separate from functional success. Its browser requires Vercel authentication.
- Automated approval review rejected creation of a temporary authentication-bypassing share URL. Do not retry without explicit approval or use an indirect bypass. Normal authenticated access is the safer alternative.
- The existing B agent currently has only three page roots: 주요DB 보관소, 영업 및 사업개발, 프로젝트. No permission expansion has been performed. Its former request-local API credential is not stored in the lab.
- A standalone Notion full-scope baseline was started. It is not an A/B/C end-to-end run and must not be counted as Luna receipt.
- The existing C connection surfaced an authentication error during that baseline; expiry is plausible given the historical 30-minute job token, but not independently proven.

## Next gates

Authenticate the protected preview; use a new A job before submitting a new question. For B, confirm expanded read access at action time and safely supply the agent credential. Renew C's job-bound connection without widening its destination or reading hidden browser credentials. Preserve raw replies and compare exact text and citations.
