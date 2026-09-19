/**
 * 기존 Mode A 600문항의 top 을 검색 overfetch 50 으로 다시 저장.
 * 질문은 그대로 두고 searchNotionForLuna 만 재실행.
 *
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/refresh-mode-a-tops.ts
 */
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import {
  MODE_A_TOP_STORE,
  loadBelongsProjectIds,
  scoreProbeAgainstTop,
  type ProbeModeAItem,
  type ProbeTopHit
} from "../lib/luna/probe-retrieval";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import type { NotionSource } from "../lib/luna/notion";

function uniquePageRanks(
  sources: NotionSource[],
  limit = MODE_A_TOP_STORE
): ProbeTopHit[] {
  const out: ProbeTopHit[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const id = (s.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const score =
      typeof s.match_score === "number" && Number.isFinite(s.match_score)
        ? s.match_score
        : typeof s.similarity === "number" && Number.isFinite(s.similarity)
          ? s.similarity
          : null;
    out.push({
      page_id: id,
      title: (s.title || "").slice(0, 120),
      rank: out.length,
      score,
      match_via: s.match_via ?? (s.link_expanded ? "link" : null)
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("missing supabase env");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: runs, error } = await admin
    .from("luna_study_runs")
    .select("id, result, started_at")
    .eq("kind", "probe_retrieval")
    .gte("started_at", "2026-09-19T00:45:00Z")
    .lte("started_at", "2026-09-19T00:50:00Z")
    .order("started_at", { ascending: true });
  if (error) throw new Error(error.message);

  const unique = new Map<string, ProbeModeAItem>();
  for (const r of runs ?? []) {
    const res = (r.result ?? {}) as {
      items?: ProbeModeAItem[];
      misses?: ProbeModeAItem[];
    };
    for (const it of [...(res.items ?? []), ...(res.misses ?? [])]) {
      if (!it?.question || !it?.page_id) continue;
      unique.set(`${it.page_id}::${it.question}`, it);
    }
  }
  const base = [...unique.values()];
  console.log(
    `[refresh-tops] base_items=${base.length} store=${MODE_A_TOP_STORE}`
  );

  const refreshed: ProbeModeAItem[] = [];
  const topLens: number[] = [];
  let searchErrors = 0;

  for (let i = 0; i < base.length; i += 1) {
    const it = base[i]!;
    let top: ProbeTopHit[] = [];
    try {
      const outcome = await searchNotionForLuna(admin, it.question, it.question, {
        skipLive: true
      });
      top = uniquePageRanks(outcome.sources ?? [], MODE_A_TOP_STORE);
    } catch (err) {
      searchErrors += 1;
      console.error(`[refresh-tops] search fail i=${i}`, err);
      top = [];
    }
    topLens.push(top.length);
    refreshed.push({
      ...it,
      top,
      // rank/bucket 은 아래에서 belongs 로 재채점
      rank: null,
      bucket: "miss"
    });
    if ((i + 1) % 25 === 0) {
      console.log(`[refresh-tops] ${i + 1}/${base.length}`);
    }
  }

  const allPageIds = new Set<string>();
  for (const it of refreshed) {
    allPageIds.add(it.page_id);
    for (const t of it.top) allPageIds.add(t.page_id);
  }
  const belongsTo = await loadBelongsProjectIds(admin, [...allPageIds]);

  for (const it of refreshed) {
    const scored = scoreProbeAgainstTop(it.page_id, it.top, belongsTo);
    it.rank = scored.rank;
    it.bucket = scored.bucket;
    it.match_kind = scored.match_kind;
  }

  mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
  const outPath = resolve(process.cwd(), "tmp/mode-a-tops-overfetch50.json");
  const payload = {
    at: new Date().toISOString(),
    source_runs: (runs ?? []).map((r) => ({
      id: r.id,
      started_at: r.started_at
    })),
    store: MODE_A_TOP_STORE,
    search_errors: searchErrors,
    items: refreshed
  };
  writeFileSync(outPath, JSON.stringify(payload), "utf8");
  const bytes = statSync(outPath).size;
  const avgTop =
    topLens.reduce((a, b) => a + b, 0) / Math.max(1, topLens.length);
  const hit1 = refreshed.filter((i) => i.rank === 0).length;
  const hit5 = refreshed.filter((i) => i.rank != null && i.rank < 5).length;
  const miss = refreshed.filter((i) => i.bucket === "miss").length;
  const answerInTop = refreshed.filter((i) =>
    i.top.some((t) => t.page_id === i.page_id)
  ).length;
  const answerInTop10 = refreshed.filter((i) =>
    i.top.slice(0, 10).some((t) => t.page_id === i.page_id)
  ).length;
  const answerInTop11to50 = refreshed.filter((i) => {
    const idx = i.top.findIndex((t) => t.page_id === i.page_id);
    return idx >= 10;
  }).length;

  const summary = {
    items: refreshed.length,
    store: MODE_A_TOP_STORE,
    avg_top_len: Math.round(avgTop * 10) / 10,
    file_bytes: bytes,
    file_mb: Math.round((bytes / (1024 * 1024)) * 100) / 100,
    bytes_per_item: Math.round(bytes / Math.max(1, refreshed.length)),
    search_errors: searchErrors,
    baseline_after_refresh: {
      hit_at_1: hit1,
      hit_at_5: hit5,
      miss,
      answer_exact_in_top50: answerInTop,
      answer_exact_in_top10: answerInTop10,
      answer_exact_only_in_11_50: answerInTop11to50
    },
    path: outPath
  };
  writeFileSync(
    resolve(process.cwd(), "tmp/mode-a-tops-overfetch50-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );
  console.log(JSON.stringify(summary, null, 2));

  // Mode A 저장소(luna_study_runs)에도 overfetch 50 top 을 남긴다
  const hit_at_1 = hit1;
  const hit_at_5 = hit5;
  const hit_at_10 = refreshed.filter(
    (i) => i.rank != null && i.rank < 10
  ).length;
  const { error: insErr } = await admin.from("luna_study_runs").insert({
    kind: "probe_retrieval",
    agenda: "mode_a_overfetch50",
    why: "리랭크 실험용 — 검색 후보 50개(page_id·score·rank·match_via) 저장",
    expected: "hit@1/miss가 overfetch 범위에서 재측정 가능",
    outcome: "no_change",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    result: {
      mode: "document_answer",
      note: `overfetch tops refreshed store=${MODE_A_TOP_STORE}`,
      store: MODE_A_TOP_STORE,
      probed: refreshed.length,
      hit_at_1,
      hit_at_5,
      hit_at_10,
      miss,
      miss_rate: refreshed.length
        ? Number((miss / refreshed.length).toFixed(3))
        : 0,
      file_mb: summary.file_mb,
      avg_top_len: summary.avg_top_len,
      items: refreshed,
      misses: refreshed.filter((i) => i.bucket === "miss")
    },
    cost_usd: 0,
    llm_calls: 0
  });
  if (insErr) {
    console.error("[refresh-tops] study_runs insert failed", insErr.message);
  } else {
    console.log("[refresh-tops] saved luna_study_runs probe_retrieval overfetch50");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
