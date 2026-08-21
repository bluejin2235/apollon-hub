/**
 * 답변 출력 정리 회귀 — scrub · 제목 strip 깊이 · 추천 fused
 *   npx tsx scripts/verify-answer-output-fix.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { scrubLunaAnswerText } from "../lib/luna/chat-response";
import {
  composeLunaResultLayout,
  stripResultArtifacts
} from "../lib/luna/answer-render";
import {
  buildSourcePacks,
  parseTitleDateLabel,
  tierSourcePacks
} from "../lib/luna/source-pack";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import { isListingQuestion } from "../lib/luna/listing-question";
import { classifyQuestionDepth } from "../lib/luna/question-depth";
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
  const title = "[진행 중] 사업개발";
  const prose = `현재 검색 결과에서 **${title}** 페이지에 등록된 건은 다음 3건입니다.`;
  const notion: NotionSource[] = [
    { title, url: "https://www.notion.so/x", id: "x" }
  ];

  assert(classifyQuestionDepth("지금 진행 중인 사업개발 건 뭐가 있어") === "listing", "listing depth");
  assert(
    classifyQuestionDepth("인스파이어 시즌3 수행계획서 어디 있어") === "simple",
    "simple depth"
  );

  const listingStrip = stripResultArtifacts(prose, [], notion, {
    depth: "listing"
  });
  assert(
    listingStrip.includes(title),
    `listing must keep title: ${listingStrip}`
  );
  assert(!listingStrip.includes("****"), `listing ****: ${listingStrip}`);

  const synthStrip = stripResultArtifacts(prose, [], notion, {
    depth: "synthesis"
  });
  assert(synthStrip.includes(title), `synthesis must keep title: ${synthStrip}`);

  const simpleStrip = stripResultArtifacts(prose, [], notion, {
    depth: "simple"
  });
  assert(
    !simpleStrip.includes(title),
    `simple should strip title: ${simpleStrip}`
  );
  assert(!simpleStrip.includes("****"), `simple **** left: ${simpleStrip}`);
  assert(simpleStrip.includes("페이지에"), `simple body lost: ${simpleStrip}`);

  const layoutListing = composeLunaResultLayout({
    raw: prose + "\n\n· 전주관광타워 — 진행 — 근거: 「" + title + "」",
    notionSources: notion,
    questionText: "지금 진행 중인 사업개발 건 뭐가 있어"
  });
  const listingView = `${layoutListing.lead}\n${layoutListing.body}`;
  assert(
    listingView.includes(title),
    `compose listing lost title: ${listingView}`
  );
  assert(!listingView.includes("****"), `compose listing ****: ${listingView}`);

  const layoutSimple = composeLunaResultLayout({
    raw: prose,
    notionSources: notion,
    questionText: "인스파이어 시즌3 수행계획서 어디 있어"
  });
  const simpleView = `${layoutSimple.lead}\n${layoutSimple.body}`;
  assert(
    !simpleView.includes("****"),
    `compose simple ****: ${simpleView}`
  );

  const dirty =
    '현재 검색 결과에서 **** 페이지에 등록된 건은 다음 3건입니다.\n{"type":"step","key":"answer","status":"done","label":"정리 완료","ms":1}';
  const cleaned = scrubLunaAnswerText(dirty);
  assert(!cleaned.includes("*"), `stars remain: ${cleaned}`);
  assert(cleaned.includes("페이지에"), "body lost");
  assert(
    scrubLunaAnswerText("**정상 굵게**와 ****").includes("**정상 굵게**"),
    "real bold removed"
  );
  assert(
    !scrubLunaAnswerText("**정상 굵게**와 ****").includes("****"),
    "**** kept"
  );

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

  // isListingQuestion sanity
  assert(isListingQuestion("건 뭐가 있어"), "listing re");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("OK scrub+strip depth (skip hybrid live)");
    return;
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const qList = "지금 진행 중인 사업개발 건 뭐가 있어";
  const listOutcome = await searchNotionForLuna(admin, qList, qList, {
    listing: isListingQuestion(qList),
    skipLive: true
  });
  const fixed = tierSourcePacks(
    buildSourcePacks(keepHybridScores(listOutcome.sources), [])
  );
  console.log(
    "listing recommended →",
    fixed.recommended?.title,
    "score",
    fixed.recommended?.score
  );
  assert(
    Boolean(
      fixed.recommended?.title?.includes("진행 중") &&
        fixed.recommended?.title?.includes("사업개발")
    ),
    `recommended should be [진행 중] 사업개발, got ${fixed.recommended?.title}`
  );

  const qSimple = "인스파이어 시즌3 수행계획서 어디 있어";
  const simpleOutcome = await searchNotionForLuna(admin, qSimple, qSimple, {
    listing: false,
    skipLive: true
  });
  console.log(
    "simple hits →",
    simpleOutcome.sources.slice(0, 3).map((s) => s.title)
  );
  const simpleLayout = composeLunaResultLayout({
    raw:
      (simpleOutcome.sources[0]
        ? `「${simpleOutcome.sources[0].title}」에서 확인됩니다.\n\n`
        : "") +
      "아래 추천 자료를 확인하세요.",
    notionSources: simpleOutcome.sources.slice(0, 3),
    questionText: qSimple
  });
  assert(
    !`${simpleLayout.lead}${simpleLayout.body}`.includes("****"),
    "simple live ****"
  );
  console.log("simple lead →", simpleLayout.lead.slice(0, 80));

  // dropHybridScores still used for contrast log
  const broken = tierSourcePacks(
    buildSourcePacks(dropHybridScores(listOutcome.sources), [])
  );
  console.log("without match_score →", broken.recommended?.title);

  console.log("OK all checks");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
