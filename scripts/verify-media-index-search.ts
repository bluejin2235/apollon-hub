/**
 * 이미지 색인 임계값·유사도 분포 검증 (142장)
 * 실행: npx tsx scripts/verify-media-index-search.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { createQueryEmbedding } from "../lib/luna/embedding";
import {
  matchMediaEmbeddings,
  mediaHitsToCards,
  MEDIA_MATCH_THRESHOLD,
  MEDIA_PACK_MID,
  MEDIA_PACK_RECOMMENDED
} from "../lib/luna/media-index-search";
import {
  buildSourcePacks,
  tierSourcePacks
} from "../lib/luna/source-pack";

const QUESTIONS = [
  "미디어파사드 레퍼런스",
  "파란 조명 야간 연출",
  "로비 미디어아트",
  "LED 스크린 설치",
  "시계탑 시뮬레이션"
];

function tierLabel(score: number): string {
  if (score >= MEDIA_PACK_RECOMMENDED) return "추천";
  if (score >= MEDIA_PACK_MID) return "간략";
  return "접힘";
}

function categoryKo(cat: string | null | undefined): string {
  if (cat === "ours") return "시안";
  if (cat === "reference") return "레퍼런스";
  if (cat === "document") return "문서";
  return cat ?? "unknown";
}

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

  const { count } = await admin
    .from("luna_media_index")
    .select("*", { count: "exact", head: true })
    .not("embedding", "is", null);
  console.log(`=== luna_media_index rows with embedding: ${count ?? "?"} ===`);
  console.log(
    `thresholds match=${MEDIA_MATCH_THRESHOLD} pack_rec=${MEDIA_PACK_RECOMMENDED} pack_mid=${MEDIA_PACK_MID}\n`
  );

  const allTopScores: number[] = [];
  const timings: number[] = [];

  for (const q of QUESTIONS) {
    const t0 = Date.now();
    const embedding = await createQueryEmbedding(q);
    const embedMs = Date.now() - t0;
    if (!embedding) {
      console.log(`Q: ${q}\n  (embedding failed)\n`);
      continue;
    }
    const t1 = Date.now();
    const hits = await matchMediaEmbeddings(admin, embedding, {
      threshold: 0,
      limit: 25
    });
    const searchMs = Date.now() - t1;
    const totalMs = Date.now() - t0;
    timings.push(totalMs);

    const top5 = hits.slice(0, 5);
    if (top5[0]) allTopScores.push(top5[0].similarity);

    console.log(`Q: ${q}`);
    console.log(
      `  ms embed=${embedMs} search=${searchMs} total=${totalMs} hits=${hits.length}`
    );
    console.log("  top5:");
    for (const h of top5) {
      console.log(
        `    ${h.similarity.toFixed(3)} ${categoryKo(h.ai_category)} ${h.file_name}`
      );
    }

    const aboveMatch = hits.filter((h) => h.similarity >= MEDIA_MATCH_THRESHOLD);
    const cards = mediaHitsToCards(aboveMatch);
    const tiers = tierSourcePacks(buildSourcePacks([], cards, q));
    console.log(
      `  above ${MEDIA_MATCH_THRESHOLD}: ${aboveMatch.length} max=${tiers.maxScore.toFixed(3)} ${tierLabel(tiers.maxScore)}`
    );

    const weakTop = hits.slice(0, 3).map((h) => h.similarity);
    const tail = hits.slice(-3).map((h) => h.similarity);
    if (hits.length >= 6) {
      console.log(
        `  distribution top3=[${weakTop.map((s) => s.toFixed(3)).join(", ")}] tail3=[${tail.map((s) => s.toFixed(3)).join(", ")}]`
      );
    }
    console.log("");
  }

  const avgMs =
    timings.length > 0
      ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length)
      : 0;
  const maxTop =
    allTopScores.length > 0 ? Math.max(...allTopScores) : 0;
  const minTop =
    allTopScores.length > 0 ? Math.min(...allTopScores) : 0;
  console.log("=== summary ===");
  console.log(`avg total ms (embed+search): ${avgMs}`);
  console.log(`top1 similarity range: ${minTop.toFixed(3)} – ${maxTop.toFixed(3)}`);
  console.log(
    `recommended: match≥${MEDIA_MATCH_THRESHOLD} pack≥${MEDIA_PACK_RECOMMENDED}/${MEDIA_PACK_MID}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
