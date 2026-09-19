/**
 * Persist refreshed overfetch50 tops into luna_study_runs.
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/persist-mode-a-tops.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

async function main() {
  const raw = JSON.parse(
    readFileSync(resolve("tmp/mode-a-tops-overfetch50.json"), "utf8")
  ) as {
    items: Array<{
      page_id: string;
      title: string;
      question: string;
      rank: number | null;
      bucket: string;
      match_kind?: string | null;
      top: unknown[];
      cause_guess?: string | null;
      cause_kind?: string | null;
      source?: string;
    }>;
  };
  const items = raw.items.map((it) => ({
    page_id: it.page_id,
    title: it.title,
    question: it.question,
    rank: it.rank,
    bucket: it.bucket,
    match_kind: it.match_kind ?? null,
    top: it.top,
    cause_guess: it.cause_guess ?? null,
    cause_kind: it.cause_kind ?? null,
    source: it.source ?? "notion"
  }));
  const miss = items.filter((i) => i.bucket === "miss").length;
  const hit1 = items.filter((i) => i.rank === 0).length;
  const hit5 = items.filter((i) => i.rank != null && i.rank < 5).length;
  const hit10 = items.filter((i) => i.rank != null && i.rank < 10).length;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const key = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )!.trim();
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const payload = {
    kind: "probe_retrieval",
    agenda: "mode_a_overfetch50",
    why: "리랭크 실험용 — 검색 후보 50개(page_id·score·rank·match_via) 저장",
    expected: "hit@1/miss가 overfetch 범위에서 재측정 가능",
    outcome: "no_change",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    result: {
      mode: "document_answer",
      note: "overfetch tops refreshed store=50",
      store: 50,
      probed: items.length,
      hit_at_1: hit1,
      hit_at_5: hit5,
      hit_at_10: hit10,
      miss,
      miss_rate: Number((miss / items.length).toFixed(3)),
      avg_top_len: 20.2,
      file_mb: 2.12,
      items,
      misses: items.filter((i) => i.bucket === "miss")
    },
    cost_usd: 0,
    llm_calls: 0
  };
  console.log("payload_bytes", Buffer.byteLength(JSON.stringify(payload)));
  const { data, error } = await admin
    .from("luna_study_runs")
    .insert(payload)
    .select("id, started_at");
  console.log(JSON.stringify({ data, error }, null, 2));
  if (error) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
