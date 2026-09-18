/**
 * 1차 원천 집계를 지금 계산해 luna_source_stats 에 넣는다.
 * npx tsx --require ./scripts/stub-server-only.cjs scripts/run-source-stats-once.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import { computeAndStoreSourceStats } from "@/lib/luna-admin/source-stats";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env required");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const result = await computeAndStoreSourceStats(adminClient());
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
