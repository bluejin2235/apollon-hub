/**
 * 같은 것 — 불용어 뺀 유사도로 자동 확정을 다시 본다.
 * npx tsx scripts/rejudge-same.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import { rejudgeAutoSame } from "@/lib/luna-admin/rejudge-same";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const admin = adminClient();
  const report = await rejudgeAutoSame(admin);
  const { data, error } = await admin
    .from("luna_links")
    .select("status, source")
    .eq("kind", "same");
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const byStatus = { active: 0, pending: 0, rejected: 0 };
  let human = 0;
  for (const row of rows) {
    const st = row.status as keyof typeof byStatus;
    if (st in byStatus) byStatus[st] += 1;
    if (row.source === "human") human += 1;
  }
  console.log(JSON.stringify({ ...report, byStatus, human }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
