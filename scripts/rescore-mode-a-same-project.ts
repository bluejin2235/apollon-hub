/**
 * 기존 Mode A 600문항을 same_project 규칙으로 다시 채점 (검색 재실행 없음)
 *
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/rescore-mode-a-same-project.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import {
  MISS_CAUSE_LABEL,
  loadBelongsProjectIds,
  scoreProbeAgainstTop,
  type MissCauseKind,
  type ProbeModeAItem
} from "../lib/luna/probe-retrieval";

type Item = {
  page_id: string;
  title: string;
  question: string;
  rank: number | null;
  bucket: string;
  top: Array<{ page_id: string; title: string }>;
  cause_kind?: string | null;
  cause_guess?: string | null;
  match_kind?: string | null;
};

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

function reclassifyMiss(it: Item): MissCauseKind {
  const top = it.top ?? [];
  if (top.length === 0) return "no_results";
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
  if (it.rank == null && top.length > 0) return "bad_chunk";
  return "other";
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
    .select("id, started_at, result")
    .eq("kind", "probe_retrieval")
    .gte("started_at", "2026-09-19T00:45:00Z")
    .lte("started_at", "2026-09-19T00:50:00Z")
    .order("started_at", { ascending: true });
  if (error) throw new Error(error.message);

  const unique = new Map<string, Item>();
  let reported = {
    probed: 0,
    hit1: 0,
    hit5: 0,
    hit10: 0,
    miss: 0
  };
  for (const r of runs ?? []) {
    const res = (r.result ?? {}) as {
      probed?: number;
      hit_at_1?: number;
      hit_at_5?: number;
      hit_at_10?: number;
      miss?: number;
      items?: Item[];
      misses?: Item[];
    };
    reported.probed += Number(res.probed ?? 0);
    reported.hit1 += Number(res.hit_at_1 ?? 0);
    reported.hit5 += Number(res.hit_at_5 ?? 0);
    reported.hit10 += Number(res.hit_at_10 ?? 0);
    reported.miss += Number(res.miss ?? 0);
    for (const it of [...(res.items ?? []), ...(res.misses ?? [])]) {
      if (!it?.question || !it?.page_id) continue;
      unique.set(`${it.page_id}::${it.question}`, it);
    }
  }

  const items = [...unique.values()];
  const allPageIds = new Set<string>();
  for (const it of items) {
    allPageIds.add(it.page_id);
    for (const t of it.top ?? []) {
      if (t.page_id) allPageIds.add(t.page_id);
    }
  }
  const belongsTo = await loadBelongsProjectIds(admin, [...allPageIds]);

  let answerHasBelongs = 0;
  let answerNoBelongs = 0;
  for (const it of items) {
    if ((belongsTo.get(it.page_id)?.size ?? 0) > 0) answerHasBelongs += 1;
    else answerNoBelongs += 1;
  }

  const rescored: ProbeModeAItem[] = [];
  let sameProjectPromoted = 0;
  let sameTitleButNoBelongs = 0;

  for (const it of items) {
    const top = it.top ?? [];
    const scored = scoreProbeAgainstTop(it.page_id, top, belongsTo);
    if (
      it.bucket === "miss" &&
      scored.bucket !== "miss" &&
      scored.match_kind === "same_project"
    ) {
      sameProjectPromoted += 1;
    }
    if (it.bucket === "miss" && scored.bucket === "miss") {
      const ansTitle = (it.title || "").trim();
      if (
        ansTitle &&
        top.some((t) => t.title === ansTitle && t.page_id !== it.page_id)
      ) {
        sameTitleButNoBelongs += 1;
      }
    }
    const stillMiss = scored.bucket === "miss";
    const causeKind = stillMiss ? reclassifyMiss({ ...it, rank: scored.rank }) : null;
    rescored.push({
      page_id: it.page_id,
      title: it.title,
      question: it.question,
      rank: scored.rank,
      bucket: scored.bucket,
      match_kind: scored.match_kind,
      top,
      cause_guess: causeKind ? MISS_CAUSE_LABEL[causeKind] : null,
      cause_kind: causeKind
    });
  }

  const n = rescored.length;
  const hit1 = rescored.filter((i) => i.rank === 0).length;
  const hit5 = rescored.filter((i) => i.rank != null && i.rank < 5).length;
  const hit10 = rescored.filter((i) => i.rank != null && i.rank < 10).length;
  const miss = rescored.filter((i) => i.bucket === "miss").length;
  const exact = rescored.filter((i) => i.match_kind === "exact").length;
  const same_project = rescored.filter(
    (i) => i.match_kind === "same_project"
  ).length;

  const miss_by_cause: Record<string, number> = {};
  const miss_by_cause_label: Record<string, number> = {};
  for (const m of rescored) {
    if (m.bucket !== "miss") continue;
    const k = m.cause_kind ?? "other";
    miss_by_cause[k] = (miss_by_cause[k] ?? 0) + 1;
    const label = MISS_CAUSE_LABEL[k as MissCauseKind] ?? k;
    miss_by_cause_label[label] = (miss_by_cause_label[label] ?? 0) + 1;
  }

  const report = {
    before: reported,
    after: {
      probed: n,
      hit_at_1: hit1,
      hit_at_1_pct: n ? Math.round((1000 * hit1) / n) / 10 : 0,
      hit_at_5: hit5,
      hit_at_5_pct: n ? Math.round((1000 * hit5) / n) / 10 : 0,
      hit_at_10: hit10,
      hit_at_10_pct: n ? Math.round((1000 * hit10) / n) / 10 : 0,
      miss,
      miss_pct: n ? Math.round((1000 * miss) / n) / 10 : 0,
      exact,
      same_project
    },
    promoted_miss_to_same_project: sameProjectPromoted,
    belongs_coverage: {
      answer_with_belongs: answerHasBelongs,
      answer_without_belongs: answerNoBelongs,
      note: "belongs 없는 정답 문서는 exact(그 문서 id)만 hit. 같은 제목이 top에 있어도 프로젝트 연결이 없으면 miss 유지."
    },
    same_title_in_top_but_no_belongs_still_miss: sameTitleButNoBelongs,
    miss_by_cause,
    miss_by_cause_label,
    run_ids: (runs ?? []).map((r) => r.id),
    item_coverage: {
      unique_items: n,
      reported_probed: reported.probed,
      note:
        n < reported.probed
          ? "items 잘림으로 일부 문항만 재채점 — 집계는 unique items 기준"
          : "전 문항 재채점"
    }
  };

  mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
  const path = resolve(process.cwd(), "tmp/mode-a-rescore-same-project.json");
  writeFileSync(path, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log("WROTE", path);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
