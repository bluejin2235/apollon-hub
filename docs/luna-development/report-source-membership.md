# Saved report source membership

Saved report reuse and text retrieval now share the current directory membership check. A NAS reference must match exactly one file in its drive's latest indexed scan, including drive, modification time and file size. Surviving rows from older scans, ambiguous relative paths, missing metadata and failed or truncated lookups cannot establish freshness.

Directory lookup uses escaped PostgREST text filters for Windows paths. Latest scan lookups are cached per drive within each directory helper call. Text retrieval invokes that helper for each bounded path batch and additionally requires one matching successful text extraction. Image references do not require document text extraction.

Regression coverage includes removed files surviving in old snapshots, cross-drive ambiguity, unknown size versus zero, image-only references and the installed Supabase client's actual request encoding. Full foundation suite: 176 passing tests locally before submission to CI.

This validates indexed source membership, not physical NAS content, semantic report quality or an atomic snapshot held throughout response generation. Production integration and relevance acceptance remain separate gates.
