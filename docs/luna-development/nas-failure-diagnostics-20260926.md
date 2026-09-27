# Room 3 failure investigation and implementation

## Supplied read-only report

The company-PC report received on 2026-09-26 found 87 failed extracts:
86 stored `[object Object]` (59 PDF, 21 PPTX, 5 DOCX, 1 XLSX), and one DOCX parser
message saying no main document part was found. Counts remain ok 18,263 / skipped
1,035 / empty 173 / failed 87. The report identified 27 failed sources above 64 MB,
including four PPTX files above 1 GB, but also very small failures.

The 86 rows are unclassified. Absence of timeout/access error strings does not establish
that no transient/access failures occurred; their messages were lost. Repeated failures
do not recover original causes. This agent has not re-extracted these files.

## Changes on the isolated integration branch

- `describeNasError` preserves diagnostic name, code, errno, status, message and bounded
  nested causes/errors, handles circular/non-Error objects, and avoids serializing
  arbitrary bodies, headers, environment and source payloads. Known bearer/API-key
  patterns in messages are redacted. It is bounded text, not a guaranteed JSON document.
- The extraction library and indexer's per-file/outer catches now use the same formatter.
  A DB/client thrown object may also have produced the historical text, so it would be
  premature to attribute all 86 historical errors to a parser.
- Whole-buffer formats (PDF/DOCX/XLSX/XLS/TXT/MD) are limited to 64 MiB of source bytes.
  Size is checked before reading and again as bytes arrive, covering growth after stat.
  Crossing the limit yields `skipped:too_large`, not partial successful text.
- PPTX was already different: it reads slide/notes XML with yauzl and does not load
  embedded media or the whole archive into a Buffer. It retains that behavior, including
  the previously verified 320,750,445-byte sample's supported size range. Bounds are
  1 GiB archive size, 8 MiB per selected XML entry, 32 MiB cumulative selected XML and
  50,000 enumerated entries. Declared sizes and actual streamed XML bytes are checked.
  On a limit failure the active stream/archive are closed; partial text is discarded.
- The specific DOCX missing-main-document message maps to `skipped:corrupt`, consistent
  with existing parser-incompatible/corrupt skip handling. This operational category
  does not prove the original file cannot be opened by any other application.

These are conservative processing limits, not an OS memory ceiling. Compressed workbook/
DOCX expansion, parser internal allocations and CPU duration still need process isolation
for hard runtime guarantees. Large PDFs are intentionally unindexed by this path until a
separate bounded parser workflow is provided. Changing policy later requires deliberate
reprocessing of prior skipped records; no historical rows were rewritten here.

## Verification and next evidence

133 local tests pass, including existing PPTX partial-read integrity tests and new cases
for object diagnostics, redaction, file growth, pre-read limits, declared/streamed XML
limits, DOCX classification, and selective XML handling for a simulated 321 MB archive.
Mocks are not a repeat of the physical company-PC file test. GitHub full TypeScript and
regression results are recorded in PR #7 after completion. No paid API calls or DB writes.

Once the existing room 1/2 checks finish, a company-PC-only check can re-extract one or
two bounded failed samples in memory using the new library, with no DB writes. That is
the evidence needed to recover their current error fields. Historical lost messages
cannot be reconstructed by changing the formatter.

## Working rule confirmed by the user

Only Cursor room 1 and room 2 remain active. Room 3 is closed for future assignments.
Use Cursor only for company-PC-local/NAS/uncommitted-file/existing-key execution that
this agent cannot access directly. GitHub changes, accessible DB queries, code edits and
automated tests stay with this agent. Current room 1 path-validation and room 2 complete
branch-versus-dirty-tree comparison remain unchanged; do not duplicate those tasks.
