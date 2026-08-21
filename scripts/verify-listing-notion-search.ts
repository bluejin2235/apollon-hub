/**
 * 목록형 노션 색인 검색 안정성 검증 — 질문당 3회
 *   npx tsx scripts/verify-listing-notion-search.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import {
  applyListingTypeOverride,
  isListingQuestion
} from "../lib/luna/listing-question";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";

const QUESTIONS = [
  "지금 진행 중인 사업개발 건 뭐가 있어",
  "작년에 한 미디어파사드 제안 뭐가 있어",
  "lucky 라는 이름이 들어간 프로그램"
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

  console.log("=== listing notion search ×3 ===\n");
  console.log(
    "| 질문 | 회차 | 목록형(코드) | LLM가정→오버라이드 | 노션건수 | ms |"
  );
  console.log("|---|---|---|---|---|---|");

  let failed = false;
  for (const q of QUESTIONS) {
    const listing = isListingQuestion(q);
    const override = applyListingTypeOverride(["find", "know"], q, listing);
    const counts: number[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const t0 = Date.now();
      const outcome = await searchNotionForLuna(admin, q, q, {
        skipLive: listing,
        listing
      });
      const ms = Date.now() - t0;
      const n = outcome.sources.length;
      counts.push(n);
      console.log(
        `| ${q.slice(0, 24)}… | ${i} | ${listing} | ${override.types.join("+")} | ${n} | ${ms} |`
      );
      if (n > 0) {
        for (const s of outcome.sources.slice(0, 5)) {
          console.log(
            `    · [${(s.similarity ?? 0).toFixed(3)}] ${s.title.slice(0, 60)}`
          );
        }
      }
    }
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    if (q.includes("lucky")) {
      if (min < 1) {
        console.log(`  FAIL regression: lucky expected ≥1, got ${counts}`);
        failed = true;
      }
    } else if (min < 5) {
      console.log(`  FAIL expected ≥5 each run, got ${counts}`);
      failed = true;
    }
    if (max - min > 3) {
      console.log(`  WARN unstable counts ${counts}`);
    }
    console.log("");
  }

  if (failed) process.exit(1);
  console.log("OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
