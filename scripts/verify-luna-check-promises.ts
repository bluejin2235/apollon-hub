/**
 * luna_checks 약속 vs vercel cron · schedule.ts 대조
 *   npx tsx scripts/verify-luna-check-promises.ts
 */
import { createClient } from "@supabase/supabase-js";
import { diffCheckPromises, LUNA_CHECK_PROMISES } from "../lib/luna/check-promises";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required");
    process.exit(1);
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await admin
    .from("luna_checks")
    .select("id, label, promise_label")
    .order("sort_order");
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log("expected (code):");
  for (const [id, meta] of Object.entries(LUNA_CHECK_PROMISES)) {
    console.log(`  ${id.padEnd(14)} ${meta.promise_label}  ← ${meta.source}`);
  }
  console.log("\nDB:");
  for (const row of data ?? []) {
    console.log(`  ${String(row.id).padEnd(14)} ${row.promise_label}`);
  }
  const drifts = diffCheckPromises(data ?? []);
  if (drifts.length === 0) {
    console.log("\nOK — 12개 약속이 코드 기준과 일치");
    return;
  }
  console.log("\nDRIFT:");
  for (const d of drifts) {
    console.log(`  ${d.id}: DB="${d.actual}" → expected="${d.expected}" (${d.source})`);
  }
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
