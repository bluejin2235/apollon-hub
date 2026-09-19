/**
 * 저장된 Mode A top 에 리랭커만 적용해 점수 비교 (검색 재실행 없음)
 * 로컬 ONNX BGE (transformers.js) — HF 키 불필요
 *
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/measure-rerank-mode-a.ts
 *   MODE_A_TOPS_FILE=tmp/mode-a-tops-overfetch50.json 로 overfetch 50 후보 사용
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  MISS_CAUSE_LABEL,
  MODE_A_TOP_STORE,
  loadBelongsProjectIds,
  scoreProbeAgainstTop,
  type MissCauseKind
} from "../lib/luna/probe-retrieval";

type Top = {
  page_id: string;
  title: string;
  rank?: number;
  score?: number | null;
  match_via?: string | null;
};
type Item = {
  page_id: string;
  title: string;
  question: string;
  rank: number | null;
  bucket: string;
  top: Top[];
  cause_kind?: string | null;
};

const MODEL_ID = "Xenova/bge-reranker-base"; // ONNX, 브라우저/노드 가능 · 무료 로컬
const MAX_PASSAGE = 800;

function looksLikeBadQuestion(question: string): boolean {
  const s = question.trim();
  if (s.length < 16) return true;
  if (/^(이|그|해당)\s*문서/.test(s)) return true;
  if (/문서의\s*(주제|내용|제목|요지|핵심)/.test(s)) return true;
  if (/무엇인가요\?$|무엇인가\?$|알려주세요\.?$/.test(s) && s.length < 28) {
    return true;
  }
  return false;
}

function reclassifyMiss(it: {
  question: string;
  rank: number | null;
  top: Top[];
  cause_kind?: string | null;
}): MissCauseKind {
  if ((it.top ?? []).length === 0) return "no_results";
  if (looksLikeBadQuestion(it.question)) return "bad_question";
  const prev = it.cause_kind as MissCauseKind | null | undefined;
  if (
    prev === "proper_noun_body_only" ||
    prev === "weak_embedding" ||
    prev === "bad_chunk" ||
    prev === "no_chunks" ||
    prev === "wrong_label"
  ) {
    return prev;
  }
  if (it.rank != null && it.rank >= 10) return "weak_embedding";
  if (it.rank == null && (it.top?.length ?? 0) > 0) return "bad_chunk";
  return "other";
}

function summarize(
  items: Array<{
    rank: number | null;
    bucket: string;
    match_kind?: string | null;
    cause_kind?: string | null;
  }>
) {
  const n = items.length;
  const hit1 = items.filter((i) => i.rank === 0).length;
  const hit5 = items.filter((i) => i.rank != null && i.rank < 5).length;
  const hit10 = items.filter((i) => i.rank != null && i.rank < 10).length;
  const miss = items.filter((i) => i.bucket === "miss").length;
  const miss_by_cause: Record<string, number> = {};
  for (const m of items) {
    if (m.bucket !== "miss") continue;
    const k = m.cause_kind ?? "other";
    miss_by_cause[k] = (miss_by_cause[k] ?? 0) + 1;
  }
  return {
    probed: n,
    hit_at_1: hit1,
    hit_at_1_pct: n ? Math.round((1000 * hit1) / n) / 10 : 0,
    hit_at_5: hit5,
    hit_at_5_pct: n ? Math.round((1000 * hit5) / n) / 10 : 0,
    hit_at_10: hit10,
    miss,
    miss_pct: n ? Math.round((1000 * miss) / n) / 10 : 0,
    exact: items.filter((i) => i.match_kind === "exact").length,
    same_project: items.filter((i) => i.match_kind === "same_project").length,
    miss_by_cause,
    miss_by_cause_label: Object.fromEntries(
      Object.entries(miss_by_cause).map(([k, v]) => [
        MISS_CAUSE_LABEL[k as MissCauseKind] ?? k,
        v
      ])
    )
  };
}

async function loadPagePassages(
  admin: SupabaseClient,
  pageIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(pageIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    const [{ data: pages }, { data: chunks }] = await Promise.all([
      admin.from("luna_notion_pages").select("page_id, title").in("page_id", slice),
      admin
        .from("luna_notion_chunks")
        .select("page_id, heading, text, position")
        .in("page_id", slice)
        .order("position", { ascending: true })
        .limit(400)
    ]);
    const titleBy = new Map(
      (pages ?? []).map((p) => [
        String((p as { page_id: string }).page_id),
        String((p as { title?: string }).title ?? "")
      ])
    );
    const texts = new Map<string, string[]>();
    for (const row of chunks ?? []) {
      const pid = String((row as { page_id?: string }).page_id ?? "");
      const heading = String((row as { heading?: string }).heading ?? "").trim();
      const text = String((row as { text?: string }).text ?? "").trim();
      if (!pid) continue;
      const list = texts.get(pid) ?? [];
      if (list.join(" ").length > MAX_PASSAGE) continue;
      list.push([heading, text].filter(Boolean).join(" "));
      texts.set(pid, list);
    }
    for (const id of slice) {
      const title = titleBy.get(id) ?? "";
      const body = (texts.get(id) ?? []).join("\n").slice(0, MAX_PASSAGE);
      out.set(id, `${title}\n${body}`.trim().slice(0, MAX_PASSAGE) || title);
    }
  }
  return out;
}

function loadItemsFromDbRuns(
  runs: Array<{ result?: unknown }>
): Item[] {
  const unique = new Map<string, Item>();
  for (const r of runs) {
    const res = (r.result ?? {}) as { items?: Item[]; misses?: Item[] };
    for (const it of [...(res.items ?? []), ...(res.misses ?? [])]) {
      if (!it?.question || !it?.page_id) continue;
      unique.set(`${it.page_id}::${it.question}`, it);
    }
  }
  return [...unique.values()];
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("missing supabase env");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const topsFile =
    process.env.MODE_A_TOPS_FILE?.trim() ||
    "tmp/mode-a-tops-overfetch50.json";
  const topsPath = resolve(process.cwd(), topsFile);
  let items: Item[] = [];
  let topsSource = "db_study_runs";

  if (existsSync(topsPath)) {
    const raw = JSON.parse(readFileSync(topsPath, "utf8")) as {
      items?: Item[];
      store?: number;
    };
    items = (raw.items ?? []).filter((it) => it?.question && it?.page_id);
    topsSource = topsPath;
    console.log(
      `[measure-rerank] loaded file=${topsPath} items=${items.length} store≈${raw.store ?? "?"}`
    );
  } else {
    const { data: runs, error } = await admin
      .from("luna_study_runs")
      .select("id, result")
      .eq("kind", "probe_retrieval")
      .gte("started_at", "2026-09-19T00:45:00Z")
      .lte("started_at", "2026-09-19T00:50:00Z")
      .order("started_at", { ascending: true });
    if (error) throw new Error(error.message);
    items = loadItemsFromDbRuns(runs ?? []);
    console.log(`[measure-rerank] items=${items.length} (db fallback)`);
  }

  const allPageIds = new Set<string>();
  for (const it of items) {
    allPageIds.add(it.page_id);
    for (const t of it.top ?? []) if (t.page_id) allPageIds.add(t.page_id);
  }
  const belongsTo = await loadBelongsProjectIds(admin, [...allPageIds]);
  const passages = await loadPagePassages(admin, [...allPageIds]);
  console.log(`[measure-rerank] pages=${allPageIds.size} passages=${passages.size}`);

  // baseline (same_project, no rerank)
  const baseline = items.map((it) => {
    const scored = scoreProbeAgainstTop(it.page_id, it.top ?? [], belongsTo);
    const cause =
      scored.bucket === "miss"
        ? reclassifyMiss({ ...it, rank: scored.rank })
        : null;
    return {
      ...scored,
      cause_kind: cause,
      answer_in_top: (it.top ?? []).some((t) => t.page_id === it.page_id)
    };
  });

  // load local ONNX reranker
  console.log(`[measure-rerank] loading ${MODEL_ID} …`);
  const { AutoTokenizer, AutoModelForSequenceClassification } = await import(
    "@huggingface/transformers"
  );
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  const model = await AutoModelForSequenceClassification.from_pretrained(MODEL_ID, {
    dtype: "q8"
  });
  console.log(`[measure-rerank] model ready`);

  async function scorePair(query: string, text: string): Promise<number> {
    const inputs = await tokenizer(query, {
      text_pair: text,
      padding: true,
      truncation: true,
      max_length: 512
    });
    const output = await model(inputs);
    const logits = output.logits;
    const data =
      logits?.data ??
      logits?.ort_tensor?.cpuData ??
      (Array.isArray(logits) ? logits : null);
    if (!data) return Number.NEGATIVE_INFINITY;
    const v = typeof data[0] === "number" ? data[0] : Number(data[0]);
    return Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
  }

  const rerankMsList: number[] = [];
  const withRerank = [];
  let answerInTopButNotRank0 = 0;
  let promotedByRerank = 0;
  let demotedByRerank = 0;

  for (let i = 0; i < items.length; i += 1) {
    const it = items[i]!;
    const top = [...(it.top ?? [])];
    const t0 = Date.now();
    if (top.length >= 2) {
      const scoredPairs: Array<{ page_id: string; title: string; score: number }> =
        [];
      for (const t of top) {
        const text =
          passages.get(t.page_id) || t.title || t.page_id;
        const score = await scorePair(it.question, text);
        scoredPairs.push({ ...t, score });
      }
      scoredPairs.sort((a, b) => b.score - a.score);
      const newTop = scoredPairs.map(({ page_id, title }) => ({ page_id, title }));
      const before = scoreProbeAgainstTop(it.page_id, top, belongsTo);
      const after = scoreProbeAgainstTop(it.page_id, newTop, belongsTo);
      if (
        before.bucket === "miss" &&
        after.bucket !== "miss"
      ) {
        promotedByRerank += 1;
      }
      if (
        before.bucket !== "miss" &&
        after.bucket === "miss"
      ) {
        demotedByRerank += 1;
      }
      if (
        before.rank != null &&
        before.rank > 0 &&
        after.rank === 0
      ) {
        answerInTopButNotRank0 += 1;
      }
      const cause =
        after.bucket === "miss"
          ? reclassifyMiss({ ...it, top: newTop, rank: after.rank })
          : null;
      withRerank.push({ ...after, cause_kind: cause });
    } else {
      const scored = scoreProbeAgainstTop(it.page_id, top, belongsTo);
      const cause =
        scored.bucket === "miss"
          ? reclassifyMiss({ ...it, rank: scored.rank })
          : null;
      withRerank.push({ ...scored, cause_kind: cause });
    }
    rerankMsList.push(Date.now() - t0);
    if ((i + 1) % 50 === 0) {
      const avg =
        rerankMsList.reduce((a, b) => a + b, 0) / rerankMsList.length;
      console.log(
        `[measure-rerank] ${i + 1}/${items.length} avg_rerank_ms=${Math.round(avg)}`
      );
    }
  }

  const off = summarize(baseline);
  const on = summarize(withRerank);
  const avgMs =
    rerankMsList.reduce((a, b) => a + b, 0) / Math.max(1, rerankMsList.length);
  const p50 = [...rerankMsList].sort((a, b) => a - b)[
    Math.floor(rerankMsList.length * 0.5)
  ]!;
  const p95 = [...rerankMsList].sort((a, b) => a - b)[
    Math.floor(rerankMsList.length * 0.95)
  ]!;

  // how many baseline misses had answer/sibling already in stored top?
  let missWithAnswerInTop = 0;
  let missWithSameProjectInTop = 0;
  for (let i = 0; i < items.length; i += 1) {
    if (baseline[i]!.bucket !== "miss") continue;
    const it = items[i]!;
    const top = it.top ?? [];
    if (top.some((t) => t.page_id === it.page_id)) missWithAnswerInTop += 1;
    if (
      top.some((t) => {
        if (t.page_id === it.page_id) return false;
        const ta = belongsTo.get(it.page_id);
        const tb = belongsTo.get(t.page_id);
        if (ta && tb) {
          for (const p of ta) if (tb.has(p)) return true;
        }
        if (tb?.has(it.page_id)) return true;
        if (ta?.has(t.page_id)) return true;
        return false;
      })
    ) {
      missWithSameProjectInTop += 1;
    }
  }

  const report = {
    caveat:
      topsSource === "db_study_runs"
        ? "Mode A 저장 top 이 구버전(~10개)일 수 있음. MODE_A_TOPS_FILE 로 overfetch 50 파일을 지정하라."
        : `Mode A overfetch ${MODE_A_TOP_STORE} 후보 파일 기준. 검색 재실행 없이 저장된 top 에 리랭크만 적용.`,
    tops_source: topsSource,
    store_expected: MODE_A_TOP_STORE,
    avg_top_len:
      Math.round(
        (items.reduce((a, it) => a + (it.top?.length ?? 0), 0) /
          Math.max(1, items.length)) *
          10
      ) / 10,
    model: {
      id: MODEL_ID,
      kind: "ONNX q8 via @huggingface/transformers (로컬)",
      note: "프로덕션 기본은 BAAI/bge-reranker-v2-m3 (TEI/HF). 키 없어 측정은 Xenova/bge-reranker-base ONNX 로 함."
    },
    where: {
      this_measure: "로컬 Node 스크립트",
      production_code: "Vercel 함수 안 (lib/luna/rerank.ts) — LUNA_RERANK_URL 또는 HF_TOKEN 있을 때만",
      vercel_limit: "한 요청당 rerank timeout 8s · 모델 가중치는 함수에 안 넣고 원격 TEI/HF 호출"
    },
    cost: {
      this_measure: "$0 (로컬 ONNX)",
      production_tei_selfhost: "$0 추론 + 서버비",
      production_hf_inference: "HF 무료/프로 쿼터 (유료면 토큰 과금)"
    },
    switch: {
      off: "LUNA_RERANK=0 또는 키 없음",
      on: "LUNA_RERANK_URL 또는 HF_TOKEN (+ 선택 LUNA_RERANK_MODEL)"
    },
    off,
    on,
    delta: {
      hit_at_1: on.hit_at_1 - off.hit_at_1,
      hit_at_5: on.hit_at_5 - off.hit_at_5,
      miss: on.miss - off.miss,
      bad_chunk:
        (on.miss_by_cause.bad_chunk ?? 0) - (off.miss_by_cause.bad_chunk ?? 0),
      proper_noun_body_only:
        (on.miss_by_cause.proper_noun_body_only ?? 0) -
        (off.miss_by_cause.proper_noun_body_only ?? 0)
    },
    rerank_ms: {
      avg: Math.round(avgMs),
      p50,
      p95,
      per_question_passages: `~${MODE_A_TOP_STORE} (저장된 top)`
    },
    diagnostics: {
      miss_with_exact_in_stored_top: missWithAnswerInTop,
      miss_with_same_project_in_stored_top: missWithSameProjectInTop,
      promoted_by_rerank: promotedByRerank,
      demoted_by_rerank: demotedByRerank,
      moved_to_rank0_within_top: answerInTopButNotRank0
    }
  };

  mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
  const path = resolve(process.cwd(), "tmp/mode-a-rerank-measure.json");
  writeFileSync(path, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log("WROTE", path);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
