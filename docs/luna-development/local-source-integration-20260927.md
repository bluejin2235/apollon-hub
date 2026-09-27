# Local source integration — 2026-09-27

The user supplied the existing local-change archive after the private Git handoff was unavailable. All 72 included files match the manifest SHA-256 and byte counts; the six excluded files remain excluded. The baseline is `66dcb3fd49301089f75ebcf2804ea4cae77bf8eb`; the reviewed development parent is `d5c5069890bb78229d885f0c40ee0c2a623b3dff`.

## Web integration

Reviewed all 32 component/library files against baseline and development. Six paths have changes on both sides. Retained the human-failure grouping already present in development, merged the other local behavior, and preserved recorded-retrieval safeguards and the “effect unverified” outcome label.

- Office/laptop NAS path copy controls, file/folder handling and long-path wrapping.
- Gray status for deliberately held jobs, including dashboard, checks and report output.
- Prioritization of human-reported search failures in the administrator inbox.
- Per-source study counts and running status, without inferring rank-one hits from non-misses.
- Copy controls are siblings of navigation links; failed clipboard writes report failure.

The 38 PC operator/probe/scheduler files remain in the user's original snapshot and are not part of this web release. The two local SQL files describe schema already present in both production and the restored validation DB (`held` check status and `new_big_folders`); they were not replayed. This integration does not install or execute PC jobs.

## Validation

- Manifest: 72/72 file hashes and sizes matched.
- TypeScript and existing foundation suite: 206 tests passed.
- Six focused integration tests cover dual paths, deliberate holds, stage summaries, running status and recorded-retrieval safeguards.
- Local Next build passed compilation/lint/type checking, then stopped during page-data collection because this execution environment has no Supabase configuration. Use the configured Vercel Preview to verify the complete build for the updated commit.
- No production credentials or paid API calls are used by these tests.
- The verified database rehearsal remains based on the same five SQL files, which this source integration does not change.

## Remaining operational acceptance

The user reported that the local snapshot is unchanged and NAS text extraction/embedding are not running. This is a user-supplied PC observation, not a remote process inspection. Deployment still requires green checks for the updated commit, confirmed production recovery reference, a real-Hub login/application check and comparison of representative questions. A passing build or SQL test is not employee search acceptance. Retain existing backup and recovery material through the agreed acceptance/stabilization gate.
