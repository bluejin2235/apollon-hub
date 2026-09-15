/**
 * 루나의 질문 — 같은 from-to(노션 링크드뷰 중복) 하나만 남긴다.
 * npx tsx scripts/dedupe-same-questions.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import { dedupeSameQuestions } from "@/lib/luna-admin/question-pairs";

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
  const report = await dedupeSameQuestions(adminClient());
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
