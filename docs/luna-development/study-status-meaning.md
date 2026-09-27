# Study activity and quality claims

The operational administrator screen exposed two misleading interpretations: repeated test questions from multiple sources were divided by the current Notion document count to show completion, and historical `improved` outcomes were displayed as measured improvement without a before/after comparison.

## Changes

- Show recorded question attempts, explicitly including repeated questions, separately from the current Notion document count. A missing document count remains unknown.
- Do not display a coverage bar or estimated finish date for this activity. The last 120 loaded runs are a history window, not a unique document-coverage ledger.
- Label legacy `improved` outcomes as effects unverified in execution history and morning report text. Preserve the stored records for audit. Execution failure is not labeled worsening quality.
- Queue preparation and secondary-data diagnosis now record `no_change`, since neither measures retrieval improvement. Their detailed result still describes what was queued or diagnosed.
- Year groups describe where relationship rows exist; this is not completion of derived insight or relationship correctness.

Regression tests cover repeated multi-source attempts, document/question unit separation, duplicate run IDs, unknown source totals, legacy outcomes, and morning-report labels. None of these changes establishes a before/after search-quality measurement. The hands-on review still compares the same questions and evidence in the actual Hub.

The company PC has independent pending edits to `selfstudy-view.ts`, `LunaStudyRunHistory.tsx`, and `study-report.ts`. Preserve those edits and merge both behaviors when the private handoff is available. This branch does not overwrite that worktree.
