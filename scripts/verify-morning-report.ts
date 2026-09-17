/**
 * 아침 리포트 본문·체크·증감 실측 (메일 재발송 없음).
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/verify-morning-report.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { buildAdminReportHtml } from "../lib/luna-admin/report";
import { evaluateLunaChecks } from "../lib/luna/checks";
import { buildAdminDashboard } from "../lib/luna-admin/dashboard";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env required");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const admin = adminClient();
  const now = new Date();
  const { data: superRow } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "슈퍼관리자")
    .limit(1)
    .maybeSingle();
  const userId = typeof superRow?.id === "string" ? superRow.id : "";

  const [built, checks, dash] = await Promise.all([
    buildAdminReportHtml(admin, userId, now),
    evaluateLunaChecks(admin, now),
    buildAdminDashboard(admin, userId)
  ]);

  const {
    count: perspectives
  } = await admin
    .from("luna_perspectives")
    .select("id", { count: "exact", head: true });

  const out = {
    subject: built.subject,
    text: built.textPreview,
    checks: checks.map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      detail: c.detail,
      last: c.last_run_at ?? c.detail,
      days_stale: c.days_stale
    })),
    stages: dash.stages.map((s) => ({
      key: s.key,
      label: s.label,
      light: s.light,
      title: s.title,
      detail: s.detail
    })),
    perspectives_db: perspectives ?? null,
    check_count: checks.length
  };

  writeFileSync(
    resolve(process.cwd(), "tmp-morning-report-verify.json"),
    JSON.stringify(out, null, 2),
    "utf8"
  );
  writeFileSync(
    resolve(process.cwd(), "tmp-morning-report-text.txt"),
    built.textPreview,
    "utf8"
  );
  console.log(
    JSON.stringify(
      {
        check_count: out.check_count,
        perspectives_db: out.perspectives_db,
        checks: out.checks.map((c) => `${c.status} ${c.id} ${c.label} | ${c.detail}`),
        stages: out.stages
      },
      null,
      2
    )
  );
  console.log("\n--- TEXT ---\n");
  console.log(built.textPreview);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
