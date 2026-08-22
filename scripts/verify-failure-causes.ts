/**
 * 실패 원인 분포 확인
 * npx tsx --require ./scripts/stub-server-only.cjs scripts/verify-failure-causes.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import {
  classifyFailureCause,
  failureCauseMeta,
  FAILURE_CAUSE_ORDER,
  type FailureCauseType
} from "../lib/luna/failure-cause";
import {
  isInspectFailure,
  isLikelyClarifyPickQuestion,
  mergeFailureRowsByMessage,
  type FailureKind,
  type FailureSignal
} from "../lib/luna/failures-shared";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("env missing");
    process.exit(1);
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data, error } = await admin
    .from("luna_failures")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;

  const raw = (data ?? []) as Array<{
    id: string;
    message_id: string | null;
    question: string;
    answer_excerpt: string;
    kind: FailureKind;
    signal: FailureSignal;
    signals?: FailureSignal[];
    intent_score: number | null;
    confidence_score: number | null;
    self_note: string | null;
    sources_used: Record<string, unknown>;
    duration_ms: number | null;
    types: string[];
    source_ref: Record<string, unknown>;
    created_at: string;
    asked_by: string | null;
    verdict: string | null;
  }>;

  const enriched = raw.map((r) => ({
    ...r,
    signals:
      Array.isArray(r.signals) && r.signals.length > 0
        ? r.signals
        : [r.signal]
  }));

  const merged = mergeFailureRowsByMessage(enriched).filter(
    (r) => isInspectFailure(r) || !isLikelyClarifyPickQuestion(r.question)
  );
  const open = merged.filter((r) => !r.verdict && !isInspectFailure(r));

  const counts = new Map<FailureCauseType, number>();
  const samples = new Map<FailureCauseType, string[]>();
  for (const row of open) {
    const cause = classifyFailureCause(row);
    counts.set(cause, (counts.get(cause) ?? 0) + 1);
    const list = samples.get(cause) ?? [];
    if (list.length < 4) {
      list.push(row.question.replace(/\s+/g, " ").trim().slice(0, 48));
      samples.set(cause, list);
    }
  }

  const total = open.length;
  console.log(`open(non-inspect)=${total} merged_all=${merged.length}`);
  console.log("--- distribution ---");
  for (const t of FAILURE_CAUSE_ORDER) {
    const n = counts.get(t) ?? 0;
    if (n === 0) continue;
    const meta = failureCauseMeta(t);
    const pct = total ? ((n / total) * 100).toFixed(1) : "0";
    console.log(
      `${meta.emoji} ${meta.title}\t${n}건 (${pct}%)\t예: ${(samples.get(t) ?? []).join(" / ")}`
    );
  }
  const unk = counts.get("unclassified") ?? 0;
  console.log(
    `unclassified_ratio=${total ? ((unk / total) * 100).toFixed(1) : 0}%`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
