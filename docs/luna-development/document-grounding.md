# Evidence checks for secondary document data

`document-grounding.ts` creates a separate layer-2 candidate namespace, `secondary_document_grounding_v1`. It does not change the earlier role profile or promote a legacy active edge. Each assertion has its own evidence check:

- Manual importance: exact drive and folder ancestry of a primary user mark, with mark ID/content/revision.
- Notion: deepest source folder association, preferring exact normalized document titles; exact page-parent chains with page revisions. Folder association alone is not file equality or a canonical project identity. Siblings do not inherit season membership. Cycles and conflicting season labels remain unresolved.
- Extracted body: matching drive/path, size, modified time, successful extraction and content hash; unique path ownership because chunks have no drive column; complete unique contiguous chunks. This verifies metadata consistency, not bytes read live from NAS.
- Document purpose: an explicit first-page heading can support a candidate role. A proposal heading may mention operating scope without becoming an operating manual. A role word deep in the body is insufficient.
- Coverage: a PDF page with fewer than 20 non-boilerplate alphanumeric characters is a low-text page. Fewer than 30% text-bearing pages in a document with at least three pages flags sparse text. This is a diagnostic heuristic, not OCR or proof that other documents are complete. Unknown page structure stays unassessed.

Source, mark, page, parent, chunk and policy changes invalidate the saved record. Missing evidence never proves deletion. Store source revisions plus exact chunk hashes and supporting excerpts. Keep the record candidate even when individual structural checks pass. Whole-document approval, business semantics and primary image content are not verified by these checks.

The initial bounded sample is persisted only after a durable private before/after backup and a transactional source compare. Existing memberships retain their status/confidence/human confirmation. If a primary file has no membership, a new pending membership can carry the layer-2 candidate; it must remain excluded by existing active-only search expansion.

No schema, scheduler, bulk extraction, OCR, embedding, live search reader or UI changes are included. The next consumer must use the individual check states and freshness; merely finding this namespace must never authorize a claim. Real sample contents and paths belong only in private reports, not public fixtures.
