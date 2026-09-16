/**
 * 약속 점검 스냅샷 갱신
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/run-luna-checks-once.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { evaluateLunaChecks } from "../lib/luna/checks";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env required");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const rows = await evaluateLunaChecks(admin);
  for (const r of rows) {
    const lamp =
      r.status === "ok" ? "🟢" : r.status === "warn" ? "🟡" : "🔴";
    console.log(
      `${lamp} ${r.label}  ${r.days_stale ?? "—"}일  ${r.status}  ${r.detail ?? ""}`
    );
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
