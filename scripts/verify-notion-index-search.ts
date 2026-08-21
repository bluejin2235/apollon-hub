/**
 * 노션 청크 검색 검증 — 주입 청크·유사도·응답 시간
 * 실행: npx tsx scripts/verify-notion-index-search.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";

const QUESTIONS = [
  "롯데타워 서울스카이 제안 어떻게 했어",
  "삼척 관련 프로젝트 경로는",
  "우리가 한 아이데이션 중 lucky 라는 이름이 들어간 프로그램",
  "공개공지 프로젝트들 공통점이 뭐야"
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
    process.exit(1);
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  console.log("=== Notion chunk search verification ===\n");

  for (const q of QUESTIONS) {
    const t0 = Date.now();
    const outcome = await searchNotionForLuna(admin, q, q);
    const ms = Date.now() - t0;
    console.log(`Q: ${q}`);
    console.log(`  status: ${outcome.status}  sources: ${outcome.sources.length}  ms: ${ms}`);
    console.log(`  queries: ${outcome.queries.join(", ")}`);
    for (const s of outcome.sources) {
      console.log(`  - [${(s.similarity ?? 0).toFixed(3)}] ${s.title}`);
      if (s.section) console.log(`      section: ${s.section.slice(0, 80)}`);
      if (s.excerpt) console.log(`      excerpt: ${s.excerpt.slice(0, 120)}`);
      if (s.nas_path) console.log(`      nas: ${s.nas_path}`);
      if (s.path_titles?.length) {
        console.log(`      path: ${s.path_titles.slice(-2).join(" › ")}`);
      }
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
