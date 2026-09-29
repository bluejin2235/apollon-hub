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

## Browser validation — first preview

- Authenticated as the existing superadmin and ran the exact forest question.
  Retrieval reached 27 Notion sources and 20 images; 24 Notion sources were injected.
- This live answer failed the release gate: it classified indoor forest-themed
  content as an outdoor installation, and omitted the current Yeongtong project.
- Runtime logs exposed an additional cause: glossary aliases and generated bigrams
  were independently scored (미디어아트, Media Art, 야외미디어아트). Canonical concept
  deduplication now prevents that score inflation and is covered by SQL regression.
- Removed the contradictory instruction to describe every injected candidate.
  The answer must verify location/use from the body, group project sources, and
  distinguish directly relevant documents from adjacent references.
- Added authenticated superadmin-only single-page repair UI/API, with identity
  validation, full-run conflict checks and exclusion rules. It reads the complete
  remote body before modifying stored metadata. Non-404/400 metadata HTTP errors
  are surfaced rather than disguised as absent pages.
- 313 tests and TypeScript passed; an additional focused metadata-rate-limit test
  also passed. A new preview is required for the answer and bounded-repair checks.

## Browser validation — bounded repair and retry evidence

- The single-page repair completed on two nested-content examples: 53 blocks / 3
  new embeddings and 73 blocks / 14 new embeddings. Stored block totals increased
  by 11 and 8 respectively. No bulk reindex was started.
- The missing Review page is readable through the connected personal Notion tool,
  but the preview application's integration could not fetch it. This is an access
  discrepancy requiring verification; it is not proof of a production token's
  permissions. Personal connector content was not copied into the shared index.
- The second exact-question preview still failed the answer gate. Its retry merged
  24 initial candidates into the live-search default limit of five, and compared
  scores from different queries. Final evidence therefore lost initial sources.
- Retry merging now preserves both rounds and their order, with a separate ranking
  score, and the default merge no longer applies the five-page live-search cap.
  Explicit all-material requests skip unnecessary project clarification. Retry
  hints prefer generated search keywords over prose descriptions of missing facts.
- 316 tests passed. Live answer quality must be checked again before promotion.

## Browser validation — preserved candidates and page reading

- Retry preservation restored the current park, nightwalk and nature theme park
  materials with citations. The exact question completed in 54.3 seconds with
  48 candidates and 24 injected sources. It still failed the native answer gate:
  insufficient linked-document coverage, sparse excerpts and adjacent material
  ahead of directly relevant projects.
- The independent year-qualified lighting-test/final-proposal question returned
  the project record, test pages and final proposal path in 15.2 seconds. The
  earlier unqualified question still required a year clarification.
- Evidence tracing revealed only 83 and 206 characters were passed for two core
  pages, despite their longer indexed bodies. Broad queries now reread up to 80
  indexed sections per selected page, with independent page budgets, concurrency
  six and a 2,400-character excerpt. Small pages retain full text; long pages
  retain matching sections and adjacent constraints. Failed reads keep old evidence.
- Broad relation traversal is enabled for listing queries and can follow verified
  project membership from body evidence, not only project names in the question.
  Prompt capacity is 32 pages; retries reserve three original results per new result.
- 319 tests and TypeScript passed before the additional broad-relation assertion.
  Application promotion and bulk reindex remain pending the live quality gate.

## Browser validation — full excerpts and channel balance

- The next exact-question run read 32 page excerpts and finished in 68.7 seconds.
  It described the nightwalk design in more detail and found an additional mountain
  forest proposal. It still omitted the stream-side installation family and added
  an unrequested completed-installation-only conclusion. The gate remains failed.
- Inspection found broad chunk selection could be entirely filled by lexical
  scores, starving semantic matches on their smaller score scale. Broad retrieval
  now interleaves three lexical pages per semantic page, visits distinct pages
  before second snippets, and preserves raw scores separately from ordering.
- Final broad evidence selection reserves a quarter of its budget for linked
  documents with excerpts. Retry merging retains relation statistics instead of
  showing zero after actual traversal. Instructions preserve the user's scope
  rather than interpreting all related material as completed installations only.
- 322 regression tests and TypeScript passed before the relation-statistics
  display correction. No production application promotion or full reindex yet.

## Browser validation — synthesis failure and bounded topic planning

- The balanced run still failed: 32 page excerpts reached the model, including
  the current park's 1,265-character body, but the answer omitted that project.
  The stream-side installation family was still absent. Latency was 54.6 seconds.
- An existing unconditional instruction incorrectly equated a project folder with
  actual construction. It now treats folder placement as storage classification
  and requires body evidence for roles and completion.
- Broad retries now plan two distinct related topic queries and retrieve them
  independently rather than appending every new word into one inflated query.
  Topic planning cannot invent project names. Original evidence remains retained.
- A bounded review reads every selected page excerpt, classifies direct/adjacent/
  unrelated candidates, and sends direct evidence first to synthesis. Review
  output must classify every existing candidate exactly once; malformed or empty
  positive output falls back to the original evidence. No new sources are created.
- 322 existing tests plus two focused evidence-review tests passed; TypeScript
  passed. These changes still require live validation before production promotion.

## Browser validation — preserve the requested scope

- The next broad-topic run restored the current park but still omitted useful
  nature theme park material and the stream-side installation family. The native
  answer gate remains failed. An independent office-lounge query returned its
  project record and both proposal versions with correct source links.
- Generated alternate searches inherited missing-evidence prose and added generic
  planning/analysis/operation terms. Broad planning now uses only the original
  question and a dedicated two-query instruction, without the narrow retry prompt.
- Final synthesis also inherited instructions for named-project lookup and
  provenance questions. Broad material requests now use a dedicated scope rule,
  without department, learning or named-project lookup instructions. Provenance
  instructions apply only when provenance is asked for. All relevant adjacent
  results survive review instead of being arbitrarily capped at four.
- All 324 foundation tests and TypeScript passed. Production application promotion
  and bulk reindex remain pending an acceptable live answer, not just passing tests.

## Grounded follow-up planning and reasoning

- The dedicated-prompt run still failed (56.8 seconds): the current park and
  nightwalk were detailed, but other known relevant families were omitted. The
  generated activity query was generic and did not discover the adjacent program.
- A direct lexical probe using that program's general activity name retrieved
  the omitted family near the top. Follow-up planning now reads existing document
  evidence and uses discovered activity/technique names instead of guessing only
  from the original question. Exploration and initial retrieval share equal space.
- The client had forced `reasoning_effort: none` even for multi-document review.
  Broad planning, review and synthesis now opt into `low` on the same configured
  model, with completion budgets that include reasoning. Existing callers retain
  their previous default. Provider completion/streaming tests verify parameter,
  model, visible-text and usage preservation; live latency/quality remain to verify.
- API compatibility reference: https://developers.openai.com/api/docs/models/gpt-5.6-luna

## Project-directory navigation

- The low-reasoning run recovered the nature theme park material in 55.2 seconds,
  but still omitted the stream-side installation family. The independent office
  query retained its main record and proposal versions in 37.8 seconds. The native
  comparison remains incomplete; 327 foundation tests and TypeScript passed.
- The index contains 139 active project relationship keys and 1,026 Notion-page
  memberships. Broad planning now inspects this real directory and chooses up to
  six existing project keys, then reads only their existing page memberships.
  It creates no project names or relationships and changes no primary records.
- Project navigation preserves meeting, design, test, final-report and ideation
  stages, interleaves projects, and falls back to existing retrieval on read failure.
  Selected project keys are recorded in answer evidence traces. Storage-stage
  labels and the generic stage instruction no longer dominate broad-material
  answer prompts; the answer still uses body evidence for actual status.
