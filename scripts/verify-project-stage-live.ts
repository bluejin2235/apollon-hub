/**
 * 실검색 4문장 — 단계 뱃지·정렬 확인
 * npx tsx --require ./scripts/stub-server-only.cjs scripts/verify-project-stage-live.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import { workStageBadgeText } from "../lib/luna/project-stage";
import {
  buildSourcePacks,
  tierSourcePacks
} from "../lib/luna/source-pack";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("missing supabase env");
    process.exit(1);
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const questions = [
    "아폴론의 미디어 설치 사례를 알려줘",
    "우리가 제안한 공공 프로젝트 뭐가 있어",
    "인스파이어 시즌3 수행계획서 어디 있어",
    "공개공지 프로젝트들 공통점이 뭐야"
  ];

  for (const q of questions) {
    const outcome = await searchNotionForLuna(admin, q.slice(0, 80), q, {
      skipLive: true,
      listing: /뭐가 있어|공통점|알려줘|사례/.test(q)
    });
    const top = outcome.sources.slice(0, 8).map((s) => ({
      title: s.title.slice(0, 40),
      stage: workStageBadgeText(s.work_stage ?? "unknown") ?? "불명",
      score: Number((s.match_score ?? 0).toFixed(2)),
      path: (s.path_titles ?? []).slice(0, 2).join(" › ")
    }));
    const tiers = tierSourcePacks(buildSourcePacks(outcome.sources, [], q));
    const cards = [tiers.recommended, ...tiers.mid]
      .filter(Boolean)
      .map((i) => ({
        title: i!.title.slice(0, 36),
        badge: workStageBadgeText(i!.workStage ?? "unknown") ?? "—"
      }));
    console.log("\n===", q);
    console.log("sources", outcome.sources.length, "top:", top);
    console.log("cards:", cards);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
