/**
 * 검색 재현성 · 추천 displayScore 진단
 *   npx tsx scripts/verify-search-reproducibility.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { createQueryEmbedding } from "../lib/luna/embedding";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import { notionSearchKeywords } from "../lib/luna/notion-keyword";
import { classifyQuestionDepth } from "../lib/luna/question-depth";
import {
  buildSourcePacks,
  maxNotionSimilarity,
  PACK_SCORE_RECOMMENDED,
  tierSourcePacks
} from "../lib/luna/source-pack";

const QUESTIONS = [
  "덱스터스튜디오랑 뭘 같이 했었지",
  "지금 진행 중인 사업개발 건 뭐가 있어",
  "작년에 한 미디어파사드 제안 뭐가 있어"
];

type Row = {
  run: number;
  depth: string;
  searchKws: string[];
  sourceCount: number;
  maxSim: number;
  skipKwLlm: boolean;
  recommendedTitle: string;
  recommendedScore: number | null;
  recommendedDisplay: number | null | undefined;
  topTitle: string;
  topSim: number | null;
  topMatch: number | null;
  topVia: string | null;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing supabase env");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  for (const q of QUESTIONS) {
    console.log("\n" + "=".repeat(72));
    console.log("Q:", q);
    const depth = classifyQuestionDepth(q);
    const searchKws = notionSearchKeywords(q, q);
    console.log("depth:", depth);
    console.log("searchKws (from raw question):", searchKws.join(" | "));

    const embA = await createQueryEmbedding(q, { timeoutMs: 10_000 });
    const embB = await createQueryEmbedding(q, { timeoutMs: 10_000 });
    let embDiff = 0;
    if (embA && embB && embA.length === embB.length) {
      for (let i = 0; i < embA.length; i++) {
        embDiff = Math.max(embDiff, Math.abs(embA[i]! - embB[i]!));
      }
    }
    console.log(
      "embedding recreate max|Δ|:",
      embDiff,
      "identical:",
      embDiff < 1e-12
    );

    const rows: Row[] = [];
    for (let run = 1; run <= 3; run++) {
      // run1-2: same emb; run3: fresh emb (HNSW / recreate 영향)
      const emb =
        run <= 2
          ? embA
          : await createQueryEmbedding(q, { timeoutMs: 10_000 });
      const outcome = await searchNotionForLuna(admin, q, q, {
        queryEmbedding: emb,
        skipLive: true,
        listing: depth === "listing"
      });
      const maxSim = maxNotionSimilarity(outcome.sources);
      const tiers = tierSourcePacks(buildSourcePacks(outcome.sources, []));
      const rec = tiers.recommended;
      const top = outcome.sources[0];
      const row: Row = {
        run,
        depth,
        searchKws,
        sourceCount: outcome.sources.length,
        maxSim,
        skipKwLlm: maxSim >= PACK_SCORE_RECOMMENDED,
        recommendedTitle: rec?.title ?? "(none)",
        recommendedScore: rec?.score ?? null,
        recommendedDisplay: rec?.displayScore,
        topTitle: top?.title ?? "(none)",
        topSim: top?.similarity ?? null,
        topMatch: top?.match_score ?? null,
        topVia: top?.match_via ?? null
      };
      rows.push(row);
    }

    console.log(
      "| run | sources | maxSim | skipKwLlm | display | score(fused/10) | recommended |"
    );
    console.log(
      "|-----|---------|--------|-----------|---------|-----------------|-------------|"
    );
    for (const r of rows) {
      const disp =
        typeof r.recommendedDisplay === "number"
          ? r.recommendedDisplay.toFixed(2)
          : "—";
      const sc =
        typeof r.recommendedScore === "number"
          ? r.recommendedScore.toFixed(2)
          : "-";
      if (
        typeof r.recommendedDisplay === "number" &&
        r.recommendedDisplay > 1
      ) {
        throw new Error(
          `displayScore > 1: ${r.recommendedDisplay} for ${r.recommendedTitle}`
        );
      }
      console.log(
        `| ${r.run} | ${r.sourceCount} | ${r.maxSim.toFixed(3)} | ${String(r.skipKwLlm)} | ${disp} | ${sc} | ${r.recommendedTitle.slice(0, 42)} |`
      );
      console.log(
        `    top via=${r.topVia} sim=${r.topSim?.toFixed(3) ?? "-"} match=${r.topMatch?.toFixed(2) ?? "-"} · ${r.topTitle.slice(0, 50)}`
      );
    }

    const titles = rows.map((r) => r.recommendedTitle);
    const counts = rows.map((r) => r.sourceCount);
    console.log(
      "stable recommended?",
      titles.every((t) => t === titles[0]),
      titles.map((t) => t.slice(0, 30))
    );
    console.log(
      "stable sourceCount?",
      counts.every((c) => c === counts[0]),
      counts
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
