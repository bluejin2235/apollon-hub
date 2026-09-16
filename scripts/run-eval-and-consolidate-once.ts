/**
 * 멈춘 매일 점검·후보 정리를 한 번 실행
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/run-eval-and-consolidate-once.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { runConsolidation } from "../lib/luna/consolidate";
import {
  reapStuckEvalRuns,
  runEvalExam
} from "../lib/luna/eval-exam";
import { evaluateLunaChecks } from "../lib/luna/checks";
import { missingEnvGroups } from "../lib/luna/env-keys";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env required");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const missing = missingEnvGroups();
  console.log(
    "missing env:",
    missing.length ? missing.map((m) => m.message).join(" | ") : "(none)"
  );

  const admin = adminClient();
  const reaped = await reapStuckEvalRuns(admin, 10 * 60 * 1000);
  console.log("reaped stuck eval runs:", reaped);

  console.log("=== consolidate (force) ===");
  const cons = await runConsolidation(admin, { force: true });
  console.log(
    JSON.stringify(
      {
        skipped: cons.skipped,
        trigger: cons.trigger,
        reason: cons.reason,
        run_id: cons.run_id,
        scanned: cons.scanned,
        merged_candidates: cons.merged_candidates,
        stale_candidates: cons.stale_candidates,
        conflict_candidates: cons.conflict_candidates,
        error: cons.error
      },
      null,
      2
    )
  );

  console.log("=== eval light ===");
  const exam = await runEvalExam(admin, {
    trigger: "cron_light",
    tier: "light",
    force: true,
    notify: true,
    budgetMs: 12 * 60 * 1000
  });
  console.log(JSON.stringify(exam, null, 2));

  const checks = await evaluateLunaChecks(admin);
  for (const c of checks.filter((x) =>
    ["eval_light", "consolidate", "env_keys"].includes(x.id)
  )) {
    const lamp =
      c.status === "ok" ? "🟢" : c.status === "warn" ? "🟡" : "🔴";
    console.log(`${lamp} ${c.label}  ${c.days_stale ?? "—"}일  ${c.detail}`);
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
