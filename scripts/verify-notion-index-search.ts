/**
 * 노션 색인 검색 검증 — 주입 블록·페이지·유사도·응답 시간
 * 실행: npx tsx scripts/verify-notion-index-search.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";

const QUESTIONS = [
  {
    q: "롯데타워 서울스카이 제안 어떻게 했어",
    expect: "아이데이션 1~3차·최종 제안서·P: 경로"
  },
  {
    q: "몽유도원 제안이 뭐야",
    expect: "251212 코어제안 페이지"
  },
  {
    q: "스타에비뉴 제안서 어디 있어",
    expect: "스타에비뉴 제안 회귀"
  },
  {
    q: "아폴론이 제안한 공공 프로젝트",
    expect: "노션 색인 히트 (위키는 채팅 경로)"
  }
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

  console.log("=== Notion index search verification ===\n");

  for (const row of QUESTIONS) {
    const t0 = Date.now();
    const outcome = await searchNotionForLuna(admin, row.q, row.q);
    const ms = Date.now() - t0;
    console.log(`Q: ${row.q}`);
    console.log(`  expect: ${row.expect}`);
    console.log(`  status: ${outcome.status}  pages: ${outcome.sources.length}  ms: ${ms}`);
    console.log(`  queries: ${outcome.queries.join(", ")}`);
    for (const s of outcome.sources) {
      console.log(
        `  - [${(s.similarity ?? 0).toFixed(3)}] ${s.title}`
      );
      if (s.section) console.log(`      section: ${s.section.slice(0, 60)}`);
      if (s.nas_path) console.log(`      nas: ${s.nas_path}`);
      if (s.hierarchy) {
        console.log(
          `      hierarchy:\n${s.hierarchy
            .split("\n")
            .map((l) => `        ${l}`)
            .join("\n")}`
        );
      }
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
