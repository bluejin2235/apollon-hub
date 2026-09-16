/**
 * 체크리스트만 다시 계산
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/evaluate-luna-checks-once.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
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
  console.log(
    "missing env:",
    missingEnvGroups().map((m) => m.message).join(" | ") || "(none)"
  );
  const checks = await evaluateLunaChecks(adminClient());
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
