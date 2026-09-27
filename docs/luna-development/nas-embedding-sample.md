# Bounded embedding and in-memory NAS search validation

## What changed (2026-09-26)

The NAS embedding worker previously bounded row count, but silently truncated inputs,
had no request deadline, and did not reserve a dollar budget before paid calls.
It now plans the entire run before any job write or paid request, normalizes whitespace
without truncating, rejects empty/oversized input, and divides requests by both rows
and a conservative UTF-8 byte bound. `--max-cost-usd` defaults to 1 and accepts a
smaller positive value only. The worker remains dry-run unless `--apply` is supplied.

The dedicated client uses text-embedding-3-small, validates all 1,536 finite dimensions,
unique response indices, and token usage. Its 60-second deadline covers the response
body. It does not retry automatically: an aborted request may still incur a charge.
Missing/inconsistent vectors or usage fail the run instead of reporting success.

Pricing checked against the official model page on 2026-09-26:
https://developers.openai.com/api/docs/models/text-embedding-3-small
Standard embedding input costs USD 0.02 per million tokens. UTF-8 bytes conservatively
bound byte-BPE tokens; they are not actual token counts. The price constant must be
rechecked if this procedure is reused after a pricing change. This limits only this
script's embedding calls, not unrelated account use or infrastructure charges.

## Read-only sample runner

`scripts/verify-nas-embedding-sample.ts` reads existing extracted text through Supabase.
It does not read the NAS, invoke the scanner, write vectors, create job rows, update
metadata, change a scheduler, or deploy. SSH can run it if that process already has
the legitimate Hub database and OpenAI environment; NAS SMB authentication is irrelevant.

Selection: at most 20 matching successful file metadata rows, freshness checked against
the NAS index, at most 6 selected files, and at most 3 chunks per file. The query is
limited to 2,000 UTF-8 bytes. The corpus is path-scoped, lexicographically selected,
and deliberately small; it is not representative of the entire company corpus.

Default: dry-run, no embedding call. `--execute`: embeds at most 18 chunks + 1 question,
reserving at most USD 0.01 per invocation. Vectors stay in memory. The script re-reads
selected chunks and indexed versions after the paid request and refuses a result if
they changed. Output contains counts, actual tokens/cost, source/query digests and top
chunk IDs with similarity. It contains neither source text nor credentials nor paths.

Examples from an isolated checkout with the existing authorized environment loaded:

```powershell
npx --yes tsx --require ./scripts/stub-server-only.cjs scripts/verify-nas-embedding-sample.ts --term=해운대 "--query=해운대스퀘어 제안의 핵심 내용과 연출 방향은?"
npx --yes tsx --require ./scripts/stub-server-only.cjs scripts/verify-nas-embedding-sample.ts --term=해운대 "--query=해운대스퀘어 제안의 핵심 내용과 연출 방향은?" --execute
```

Use existing keys only. Never paste credentials into chat, command arguments or logs,
and do not copy environment files into the new checkout. If using dotenv preload,
set process-local `DOTENV_CONFIG_PATH` to the existing Hub `.env.local` path and preload
`dotenv/config`; unset that process-local setting afterwards. Do not overwrite an
already configured process environment. Read-only preview must succeed before execute.
Do not retry a failed paid run automatically; report its exact error and uncertain cost.

## Live observations and boundaries

- A read-only three-term scan over chunk paths hit a 10-second SQL statement timeout.
  No operational setting was changed. The runner now first selects file metadata and
  uses the existing `(path, seq)` chunk index rather than scanning/sorting all chunk paths.
- A bounded SQL probe for the first six successful 해운대 files completed: 14 chunks,
  23,754 raw UTF-8 bytes, largest chunk 2,412 bytes. It did not fetch source bodies into
  the conversation. The SQL probe did not run the JS freshness filter, so the actual
  runner may select a smaller/different current set.
- This observation plus the allowed 2,000-byte query has a conservative embedding
  input estimate below USD 0.001 at the checked price. It is not a paid usage result.
- This agent environment has neither an OpenAI API key nor direct Supabase client
  credentials. The connected Supabase SQL tool does not provide an embedding API.
  No live model call, embedding write, production migration or deployment was made.
- Automated tests cover read-only behavior, bounded selection, stale source rejection,
  response ordering/validation, limits and no retries. Mock vectors do not demonstrate
  semantic search quality. A live sample pass proves transport and local vector ranking,
  not production RPC, HNSW performance, employee UI, relevant-answer quality or full indexing.
- Concurrent worker cost coordination, atomic chunk replacement, paid-call uncertain
  outcome accounting and full-corpus relevance acceptance remain separate work.
