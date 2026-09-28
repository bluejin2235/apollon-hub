# LUNA code and data boundary

User direction, 2026-09-29 KST: changes to general logic belong in versioned source code. Additional information derived from primary sources belongs in separately identified secondary or tertiary data.

| Layer | Contents | Location / lifecycle |
| --- | --- | --- |
| Code | Shared retrieval, identity, document-purpose and importance policies | Git, tests, commit and rule version; no private project-specific answer overrides |
| Primary | NAS/Notion originals and faithfully extracted text/index metadata; direct user important-folder marks | Existing primary stores; a manual mark remains a primary user assertion |
| Secondary (2) | Derived folder membership, document role, season and inherited importance, with evidence and conflicts | `luna_links.evidence.secondary_document_profile_v1`; candidate state is independent of the legacy edge's active status |
| Tertiary (3) | Summaries, comparisons and recommendations synthesized from versioned evidence | Separate insight identity, layer=3, exact layer-2 input revisions; storage/generation not implemented by this patch |

Extraction, chunking and embeddings are technical representations of primary sources, not independently verified business knowledge. A classification rule is code; the classification it produces for a file is layer 2. “Manual important folders boost relevant descendants” is code; the user's mark is primary; the derived inherited importance is layer 2; a recommended project reading list is layer 3 if persisted. Ordinary search responses/logs do not automatically become reusable layer-3 knowledge.

## Initial secondary profile

`secondary-document-profile.ts` builds metadata-only candidates using the same document-role policy as search. It records primary ID, drive/path, modified time, size, scan batch, matching manual mark IDs/content, policy versions, exact generator commit, deterministic revision, generation time, claims and conflicts. It does not treat confidence=1 or active legacy membership as verification.

Folder identity includes drive, year and full root. It is not a unified business project ID across proposal/execution phases. Explicit path season labels are inferences; absent labels are unknown. No year-to-season inference. Body purpose and final approval require separate evidence. Filename purpose takes priority over incidental folder words; reference context remains reference. Interview/receipt purpose cannot inherit a design role.

## Bounded persistence and freshness

For the initial sample only: retain a private exact before/after backup before adding the namespace to specified existing memberships. Compare the full captured row before update, validate the current primary/mark inputs in the same transaction, require exactly the expected receipt count, and roll back on any mismatch. Preserve edge identity, source, confidence, status, human confirmation and all pre-existing evidence. Do not publish actual samples or DB exports to the repository.

`profileFreshness` compares current source and relevant mark snapshots plus policy versions. Changed rules, source, scan batch, move or marks require revalidation. A missing/unavailable source means unavailable, not deleted. This function is a gate available to consumers; this patch does not install a scheduler or retrofit all existing edges. Candidate profiles are not read as verified facts by live search. Source truth and review status remain separate from freshness.

Layer 3 must keep exact layer-2 revisions and transitively resolvable primary evidence. Any missing/stale/conflicting dependency prevents treating an old synthesis as current verified knowledge. No automatic training from synthetic test conversations; no bulk generation in this change.

## Acceptance and remaining work

- Synthetic regression cases cover folder/title purpose conflict, preserved real design files, season conflict, cross-drive mismatch, mark changes and source/rule staleness.
- Real sample reports must distinguish metadata-only classification changes from human/body verification and live search quality. Counts do not establish accuracy.
- Pending: Notion revision/parent provenance, evidence-backed canonical project/season identity, body review, verified-claim consumer integration, layer-3 persistence/invalidation, held-out queries and search latency.
