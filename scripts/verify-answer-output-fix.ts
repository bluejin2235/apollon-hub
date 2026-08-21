/**
 * 답변 출력 정리 회귀 — scrub · 날짜 · 추천 fused
 *   npx tsx scripts/verify-answer-output-fix.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { scrubLunaAnswerText } from "../lib/luna/chat-response";
import {
  buildSourcePacks,
  parseTitleDateLabel,
  tierSourcePacks
} from "../lib/luna/source-pack";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import { isListingQuestion } from "../lib/luna/listing-question";
import type { NotionSource } from "../lib/luna/notion";

function keepHybridScores(sources: NotionSource[]): NotionSource[] {
  return sources.map((s) => ({ ...s }));
}

function dropHybridScores(sources: NotionSource[]): NotionSource[] {
  return sources.map((s) => {
    const {
      match_score: _m,
      keyword_score: _k,
      embedding_score: _e,
      match_via: _v,
      ...rest
    } = s;
    return rest;
  });
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dirty =
    '롯데면세점 스타 에비뉴 리뉴얼은 … 제외했습니다.\n{"type":"step","key":"answer","status":"done","label":"정리 완료","ms":8567}';
  const cleaned = scrubLunaAnswerText(dirty);
  assert(!cleaned.includes('"type":"step"'), "step JSON still present");
  assert(cleaned.includes("롯데면세점"), "answer body lost");

  const emptyCite = scrubLunaAnswerText(
    "· 전주관광타워 — 진행된 건 — 근거:\n· **** — 설명\n출처: 노션 「」의 「효과」\n출처: Notion 「」"
  );
  assert(!/근거\s*:\s*$/m.test(emptyCite), "empty 근거 remains");
  assert(!emptyCite.includes("노션 「」"), "empty 노션 cite remains");
  assert(!emptyCite.includes("Notion 「」"), "empty Notion cite remains");
  assert(!emptyCite.includes("****"), "**** remains");

  assert(parseTitleDateLabel("050422 아이디어") === null, "050422 should be null");
  assert(
    parseTitleDateLabel("250422 아이디어") === "2025.04.22",
    "250422 should be 2025"
  );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("OK scrub+date (skip hybrid)");
    return;
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const q = "지금 진행 중인 사업개발 건 뭐가 있어";
  const outcome = await searchNotionForLuna(admin, q, q, {
    listing: isListingQuestion(q),
    skipLive: true
  });

  const broken = tierSourcePacks(
    buildSourcePacks(dropHybridScores(outcome.sources), [])
  );
  console.log("without match_score →", broken.recommended?.title);

  const fixed = tierSourcePacks(
    buildSourcePacks(keepHybridScores(outcome.sources), [])
  );
  console.log(
    "with match_score →",
    fixed.recommended?.title,
    "score",
    fixed.recommended?.score,
    "display",
    fixed.recommended?.displayScore
  );
  assert(
    Boolean(
      fixed.recommended?.title?.includes("진행 중") &&
        fixed.recommended?.title?.includes("사업개발")
    ),
    `recommended should be [진행 중] 사업개발, got ${fixed.recommended?.title}`
  );

  console.log("OK all checks");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
