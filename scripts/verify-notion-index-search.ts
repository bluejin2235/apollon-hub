/**
 * 청크 임계값(추천 0.42 / 간략 0.33) 검증
 * 실행: npx tsx scripts/verify-notion-index-search.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import {
  buildSourcePacks,
  PACK_SCORE_MID,
  PACK_SCORE_RECOMMENDED,
  tierSourcePacks
} from "../lib/luna/source-pack";

const QUESTIONS = [
  "롯데타워 서울스카이 제안 어떻게 했어",
  "삼척 관련 프로젝트 경로는",
  "우리가 한 아이데이션 중 lucky 라는 이름이 들어간 프로그램",
  "공개공지 프로젝트들 공통점이 뭐야"
];

function tierLabel(score: number): "추천" | "간략" | "접힘" {
  if (score >= PACK_SCORE_RECOMMENDED) return "추천";
  if (score >= PACK_SCORE_MID) return "간략";
  return "접힘";
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

  console.log(
    `=== thresholds recommended=${PACK_SCORE_RECOMMENDED} mid=${PACK_SCORE_MID} ===\n`
  );

  for (const q of QUESTIONS) {
    const t0 = Date.now();
    const outcome = await searchNotionForLuna(admin, q, q);
    const ms = Date.now() - t0;
    const views = buildSourcePacks(outcome.sources, []);
    const tiers = tierSourcePacks(views);

    console.log(`Q: ${q}`);
    console.log(
      `  ms=${ms} sources=${outcome.sources.length} maxScore=${tiers.maxScore.toFixed(3)} lowConfidence=${tiers.lowConfidence}`
    );

    if (tiers.recommended) {
      console.log(
        `  [추천] ${tiers.recommended.score.toFixed(3)} ${tiers.recommended.title}`
      );
    } else {
      console.log("  [추천] (없음)");
    }
    for (const m of tiers.mid) {
      console.log(`  [간략] ${m.score.toFixed(3)} ${m.title}`);
    }
    for (const w of tiers.weak.slice(0, 6)) {
      console.log(`  [접힘] ${w.score.toFixed(3)} ${w.title}`);
    }
    if (tiers.weak.length > 6) {
      console.log(`  [접힘] … +${tiers.weak.length - 6} more`);
    }

    console.log("  — raw sources —");
    for (const s of outcome.sources) {
      const sim = s.similarity ?? 0;
      console.log(`    ${tierLabel(sim)} ${sim.toFixed(3)} ${s.title}`);
      if (s.section) console.log(`           section: ${s.section.slice(0, 70)}`);
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
