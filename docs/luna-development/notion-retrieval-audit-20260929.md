# Notion retrieval integrity audit — 2026-09-29

## Release gate

Not approved for production promotion. Unit tests are not a search-quality pass.
The user's gate is equal or better results than native Notion search across the
forest query and independent work questions, including citations and latency.

## Observed production facts

- Index schedule is enabled at 03:20 (full) and 13:30 (incremental), Asia/Seoul.
- Recent runs occurred twice daily. One incremental run on September 27 failed.
- The September 29 full run skipped 2,879 of 2,883 pages based on edit time.
- 2,887 non-archived pages are stored; 1,102 have no search chunks. This is not
  a missing-content count: calendar, image-only and container pages are included.
- A sampled zero-chunk calendar page contains properties, a button and an image,
  rather than prose. The native fetch reports an unsupported button block, so
  this observation does not prove complete native-page coverage.
- A substantial Review page can be fetched through the connected Notion account
  but is absent from the LUNA page table. Access by the production NOTION_TOKEN
  is not yet verified. Do not label this an integration-permission failure yet.
- The failed forest query selected 19 Notion pages but injected only three.
  The fourth page was relevant outdoor installation material.
- Search stopped after one round because a keyword-derived score of 2.46 was
  compared with the 0.42 embedding-oriented recommendation threshold.
- The answer contained a valid citation marker but the missing-answer heuristic
  cleared all displayed sources.

## Confirmed implementation defects

1. Single-character subject nouns were dropped by keyword tokenization.
2. The all-materials request was treated as simple, with a three-document budget.
3. Keyword candidates were limited to 80 unordered rows per field before ranking.
4. Page-block traversal skipped children of headings, toggles, callouts and lists.
5. Full indexing skipped unchanged pages, so parser fixes could not repair them.
6. Per-page fetch failures were logged but the overall run was marked successful.
7. Answer wording could delete an otherwise valid cited source.
8. Retry hints were passed as keywords but the keyword planner read the unchanged
   original question, and evaluation did not include Notion evidence text.

## Changes prepared

- Preserve meaningful one-character nouns; reserve their keyword budget.
- Give explicit all-material requests a 24-page answer budget and a larger
  initial candidate window without changing them into a different request type.
- Add a service-role-only, SECURITY INVOKER keyword candidate function, ranking
  the full matching population by page-level term coverage before applying limits.
  Generic aliases are vocabulary only; no project-specific answer mapping exists.
- Restrict the new SQL candidate path to explicit all-material requests.
- Read nested content blocks while keeping child page/database identities separate.
- Full runs reread bodies; incremental runs retain unchanged-page optimization.
- Persist per-page failures and mark the overall run failed when they occur;
  skip orphan cleanup on an incomplete run.
- Preserve verified cited sources in mixed answers; keep explicit scope mismatch
  and absent image results excluded.
- Evaluate Notion excerpts as well as cards before deciding to retry, and pass
  an expanded query to the lexical planner.

## Verification and limits

- 309 existing/additional tests passed before the final SQL test was added.
- The focused seven-test suite, including SQL coverage/role privileges, passed.
- TypeScript noEmit passed.
- Read-only replay used 1,493 current matching chunks from 469 pages. The new
  candidate path exposes previously missed project material, but generic
  references and duplicate versions still rank too highly. This is not an
  end-to-end answer comparison or proof of superiority over native Notion.
- The additive SQL function was installed and read-tested on production; the
  existing deployed application does not call it. No application promotion or
  bulk reindex has been performed by this work.
- Full rereading will take longer than the prior metadata-only full runs. Measure
  duration, rate limits and resumed chunks on a bounded reindex before promotion.

## Required next checks

1. Read the missing Review page with the production integration and retain HTTP
   status; distinguish discovery omission from missing integration access.
2. Run a bounded reindex on nested-content examples and compare source text,
   stored blocks and chunks. Classify genuine no-body pages separately.
3. Rank direct source material above incidental mentions and generated summaries;
   verify source diversity and current-version selection with native references.
4. Run the exact live question through the preview, then independent questions.
   Record expected pages, missing/irrelevant sources, citations and latency.
5. Promote only after the native-Notion quality gate has been demonstrated.

## Follow-up — relevance and coverage

- Explicit all-material requests now always run complete lexical candidate retrieval,
  even if vector retrieval already found enough pages.
- Added bounded term frequency, document length normalization and alias-aware title
  weighting to reduce incidental matches in long proposals.
- Exact duplicate comparison uses deterministic content ordering rather than random
  chunk IDs. Distinct pages receive their first snippet before second snippets consume
  the result budget. Same-title documents with different bodies remain separate.
- 311 tests passed; TypeScript noEmit passed. Regression cases cover incidental
  mentions, copied blocks with reordered IDs, page diversity and an independent query.
- On the live database, the revised forest keyword function places forest references,
  Hanwha, Miffy and Trendy material near the top; Yeongtong is also in the first 15.
  Indoor and adjacent material still appears. This remains candidate retrieval only,
  not an end-to-end answer or native-Notion parity pass.
- The follow-up additive function revision was applied and read-tested. Existing
  production app code still does not use this broad retrieval path.
- Preview build for the preceding commit succeeded. Authenticated preview fetch is
  blocked at Vercel authentication; the production Notion overview API returns 401
  through the connector. No app credentials are available in this workspace.
- Production integration access, bounded reindex and final answers still require
  an authorized app session. No application promotion or bulk reindex performed.
