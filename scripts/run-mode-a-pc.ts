/**
 * 회사 PC 에서 모드 A 여섯 원천을 한 번에 돌린다.
 * Vercel 800초 청크를 쓰지 않는다.
 *
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/run-mode-a-pc.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import {
  runProbeGlossary,
  runProbeImage,
  runProbeKnowledge,
  runProbeWiki,
  runProbeWork,
  type ModeASourceKind,
  type ModeASourceResult
} from "../lib/luna/probe-mode-a-sources";
import {
  generateQuestionsForPage,
  runProbeAnswerKey,
  MISS_CAUSE_LABEL,
  type MissCauseKind,
  type ProbeModeAItem
} from "../lib/luna/probe-retrieval";

const BUDGET = {
  glossary: 100,
  image: 200,
  knowledge: 20,
  wiki: 15,
  work: 100,
  notion: 100
} as const;

const NOTION_BUDGET_MS = 3 * 60 * 60 * 1000;

type Stage = {
  source: ModeASourceKind;
  probed: number;
  hit_at_1: number;
  hit_at_5: number;
  hit_at_10: number;
  miss: number;
  miss_by_cause: Record<string, number>;
  duration_sec: number;
  cost_usd: number;
  llm_calls: number;
  error: string | null;
  sampled?: string[];
  miss_samples?: Array<{
    title: string;
    question: string;
    rank: number | null;
    top: string[];
    cause_kind: string | null;
    cause_guess: string | null;
  }>;
};

function scoreItems(items: ProbeModeAItem[]) {
  const miss_by_cause: Record<string, number> = {};
  for (const m of items) {
    if (m.bucket !== "miss" || !m.cause_kind) continue;
    miss_by_cause[m.cause_kind] = (miss_by_cause[m.cause_kind] ?? 0) + 1;
  }
  return {
    probed: items.length,
    hit_at_1: items.filter((i) => i.rank === 0).length,
    hit_at_5: items.filter((i) => i.rank != null && i.rank < 5).length,
    hit_at_10: items.filter((i) => i.rank != null && i.rank < 10).length,
    miss: items.filter((i) => i.bucket === "miss").length,
    miss_by_cause
  };
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.stack || err.message;
  return String(err);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env missing");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const startedAt = new Date().toISOString();
  const stages: Stage[] = [];
  const { data: inserted, error: insErr } = await admin
    .from("luna_study_runs")
    .insert({
      agenda: "모드 A PC 전량",
      why: "Vercel 800초로는 여섯 원천 455건이 0건으로 끊긴다. 회사 PC 에서 한 번에 돌린다.",
      expected: "용어100 · 이미지200 · 지식20 · 위키45 · Work300 · 노션300",
      kind: "probe_retrieval",
      scope: {
        mode: "answer_key",
        multi_source: true,
        host: "pc-interactive",
        budget: BUDGET
      },
      started_at: startedAt,
      finished_at: null,
      result: { stages: [], error: null, running: true },
      outcome: null,
      cost_usd: 0,
      llm_calls: 0
    })
    .select("id")
    .single();
  if (insErr || !inserted?.id) {
    throw new Error(insErr?.message ?? "study_runs insert failed");
  }
  const runId = String(inserted.id);
  console.log(`[mode-a-pc] started run=${runId}`);

  async function flush(extra?: { error?: string | null; running?: boolean }) {
    const cost = stages.reduce((s, x) => s + x.cost_usd, 0);
    const llm = stages.reduce((s, x) => s + x.llm_calls, 0);
    const { error } = await admin
      .from("luna_study_runs")
      .update({
        result: {
          stages,
          error: extra?.error ?? null,
          running: extra?.running ?? true,
          probed: stages.reduce((s, x) => s + x.probed, 0)
        },
        cost_usd: Number(cost.toFixed(6)),
        llm_calls: llm
      })
      .eq("id", runId);
    if (error) console.error("[mode-a-pc] flush", error.message);
  }

  const gen = (title: string, body: string, source?: ModeASourceKind) =>
    generateQuestionsForPage({
      title,
      body,
      source: source === "wiki" || source === "work" || source === "notion" ? source : undefined
    });

  const jobs: Array<{
    kind: ModeASourceKind;
    run: () => Promise<ModeASourceResult>;
  }> = [
    {
      kind: "glossary",
      run: () => runProbeGlossary(admin, { limit: BUDGET.glossary })
    },
    {
      kind: "image",
      run: () => runProbeImage(admin, { limit: BUDGET.image })
    },
    {
      kind: "knowledge",
      run: () => runProbeKnowledge(admin, { limit: BUDGET.knowledge })
    },
    {
      kind: "wiki",
      run: () =>
        runProbeWiki(admin, { limit: BUDGET.wiki, generateQuestions: gen })
    },
    {
      kind: "work",
      run: () =>
        runProbeWork(admin, { limit: BUDGET.work, generateQuestions: gen })
    },
    {
      kind: "notion",
      run: async () => {
        const t0 = Date.now();
        const out = await runProbeAnswerKey(admin, {
          pageLimit: BUDGET.notion,
          questionsPerPage: 3,
          budgetMs: NOTION_BUDGET_MS
        });
        return {
          source: "notion" as const,
          probed: out.result.probed,
          hit: (out.result.probed ?? 0) - (out.result.miss ?? 0),
          miss: out.result.miss ?? 0,
          cost_usd: out.cost_usd,
          llm_calls: out.llm_calls,
          duration_ms: Date.now() - t0,
          miss_by_cause: out.result.miss_by_cause ?? {},
          items: [] as ProbeModeAItem[],
          hit_at_1: out.result.hit_at_1 ?? 0,
          hit_at_5: out.result.hit_at_5 ?? 0,
          hit_at_10: out.result.hit_at_10 ?? 0
        };
      }
    }
  ];

  for (const job of jobs) {
    const t0 = Date.now();
    console.log(`[mode-a-pc] source start ${job.kind}`);
    try {
      const src = (await job.run()) as ModeASourceResult & {
        hit_at_1?: number;
        hit_at_5?: number;
        hit_at_10?: number;
      };
      const scored = scoreItems(src.items ?? []);
      const useItems = scored.probed > 0;
      const stage: Stage = {
        source: job.kind,
        probed: useItems ? scored.probed : src.probed,
        hit_at_1: useItems ? scored.hit_at_1 : (src.hit_at_1 ?? 0),
        hit_at_5: useItems ? scored.hit_at_5 : (src.hit_at_5 ?? 0),
        hit_at_10: useItems ? scored.hit_at_10 : (src.hit_at_10 ?? 0),
        miss: useItems ? scored.miss : src.miss,
        miss_by_cause: useItems ? scored.miss_by_cause : src.miss_by_cause,
        duration_sec: Math.round((Date.now() - t0) / 1000),
        cost_usd: src.cost_usd,
        llm_calls: src.llm_calls,
        error: null,
        sampled:
          job.kind === "wiki"
            ? [...new Set((src.items ?? []).map((i) => i.title))].slice(0, 20)
            : undefined,
        miss_samples: (src.items ?? [])
          .filter((i) => i.bucket === "miss")
          .slice(0, 20)
          .map((i) => ({
            title: i.title,
            question: i.question,
            rank: i.rank,
            top: (i.top ?? []).slice(0, 3).map((t) => t.title),
            cause_kind: i.cause_kind ?? null,
            cause_guess: i.cause_guess ?? null
          }))
      };
      stages.push(stage);
      console.log(`[mode-a-pc] source done ${JSON.stringify(stage)}`);
      await flush();
    } catch (err) {
      const message = errText(err);
      const stage: Stage = {
        source: job.kind,
        probed: 0,
        hit_at_1: 0,
        hit_at_5: 0,
        hit_at_10: 0,
        miss: 0,
        miss_by_cause: {},
        duration_sec: Math.round((Date.now() - t0) / 1000),
        cost_usd: 0,
        llm_calls: 0,
        error: message
      };
      stages.push(stage);
      console.error(`[mode-a-pc] source fail ${job.kind}`, message);
      await flush({ error: `${job.kind}: ${message}`, running: true });
    }
  }

  const probed = stages.reduce((s, x) => s + x.probed, 0);
  const miss = stages.reduce((s, x) => s + x.miss, 0);
  const failed = stages.filter((s) => s.error);
  const outcome =
    probed === 0 ? "failed" : miss > 0 ? "improved" : "no_change";
  const miss_by_cause: Record<string, number> = {};
  for (const s of stages) {
    for (const [k, v] of Object.entries(s.miss_by_cause)) {
      miss_by_cause[k] = (miss_by_cause[k] ?? 0) + v;
    }
  }
  const cost = stages.reduce((s, x) => s + x.cost_usd, 0);
  const llm = stages.reduce((s, x) => s + x.llm_calls, 0);
  const summaryError = failed.length
    ? failed.map((s) => `${s.source}: ${s.error}`).join("\n")
    : null;

  const { error: finErr } = await admin
    .from("luna_study_runs")
    .update({
      finished_at: new Date().toISOString(),
      outcome,
      cost_usd: Number(cost.toFixed(6)),
      llm_calls: llm,
      result: {
        stages,
        error: summaryError,
        running: false,
        probed,
        hit_at_1: stages.reduce((s, x) => s + x.hit_at_1, 0),
        hit_at_5: stages.reduce((s, x) => s + x.hit_at_5, 0),
        miss,
        miss_by_cause,
        miss_by_cause_label: Object.fromEntries(
          Object.entries(miss_by_cause).map(([k, v]) => [
            MISS_CAUSE_LABEL[k as MissCauseKind] ?? k,
            v
          ])
        ),
        duration_sec: Math.round((Date.now() - Date.parse(startedAt)) / 1000)
      }
    })
    .eq("id", runId);
  if (finErr) console.error("[mode-a-pc] finish", finErr.message);
  console.log(
    `[mode-a-pc] finished run=${runId} probed=${probed} outcome=${outcome} cost=${cost.toFixed(4)}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
