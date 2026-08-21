/**
 * 노션 하이브리드 검색 검증
 *   npx tsx scripts/verify-notion-hybrid.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import { isListingQuestion } from "../lib/luna/listing-question";

const CASES = [
  {
    q: "지금 진행 중인 사업개발 건 뭐가 있어",
    expectTitle: /진행\s*중.*사업개발|사업개발.*진행\s*중/,
    expectRank1: true
  },
  {
    q: "덱스터스튜디오랑 뭘 같이 했었지",
    expectTitle: /덱스터/
  },
  {
    q: "우리가 한 공개공지 프로젝트들 공통점",
    expectTitle: /광안|KCC|공개공지/i
  },
  {
    q: "lucky 라는 이름이 들어간 프로그램",
    expectTitle: /lucky/i,
    expectInExcerpt: /lucky/i
  }
] as const;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing env");
    process.exit(1);
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let failed = false;

  for (const c of CASES) {
    const t0 = Date.now();
    const outcome = await searchNotionForLuna(admin, c.q, c.q, {
      listing: isListingQuestion(c.q),
      skipLive: true
    });
    const ms = Date.now() - t0;
    const top = outcome.sources.slice(0, 5);
    console.log(`\n### ${c.q}`);
    console.log(`ms=${ms} · sources=${outcome.sources.length}`);
    console.log("| 순위 | 제목 | kw | emb | fused | via | sim |");
    console.log("|---|---|---|---|---|---|---|");
    top.forEach((s, i) => {
      console.log(
        `| ${i + 1} | ${s.title.slice(0, 40)} | ${(s.keyword_score ?? 0).toFixed(1)} | ${(s.embedding_score ?? 0).toFixed(2)} | ${(s.match_score ?? 0).toFixed(2)} | ${s.match_via ?? "-"} | ${(s.similarity ?? 0).toFixed(3)} |`
      );
    });

    const hit = outcome.sources.find((s) => c.expectTitle.test(s.title));
    const excerptHit =
      "expectInExcerpt" in c && c.expectInExcerpt
        ? outcome.sources.find(
            (s) =>
              c.expectInExcerpt.test(s.title) ||
              c.expectInExcerpt.test(s.excerpt ?? "") ||
              c.expectInExcerpt.test(s.section ?? "")
          )
        : null;
    const found = hit ?? excerptHit;
    const rank = found
      ? outcome.sources.findIndex((s) => s.id === found.id) + 1
      : -1;
    if ("expectRank1" in c && c.expectRank1) {
      if (rank !== 1 || !hit) {
        console.log(`FAIL: expected rank1, got ${rank} (${hit?.title ?? "none"})`);
        failed = true;
      } else {
        console.log(`OK: rank1 = ${hit!.title}`);
      }
    } else if (!found) {
      console.log(`FAIL: no title/excerpt matching ${c.expectTitle}`);
      failed = true;
    } else {
      console.log(`OK: rank${rank} = ${found.title}`);
    }
  }

  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
