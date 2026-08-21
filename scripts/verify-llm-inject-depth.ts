/**
 * LLM 주입량 유형별 조절 검증
 *   npx tsx scripts/verify-llm-inject-depth.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import {
  classifyQuestionDepth,
  LLM_INJECT_BY_DEPTH,
  wikiLimitsForDepth
} from "../lib/luna/question-depth";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import { takeTopNotionSourcesForLlm } from "../lib/luna/source-pack";
import {
  formatListingNotionChecklist,
  isListingQuestion,
  LISTING_ANSWER_RULE
} from "../lib/luna/listing-question";
import { formatNotionSourcesForPrompt } from "../lib/luna/notion";
import { retrieveKnowledgeEmbeddings } from "../lib/luna/embedding-retrieve";
import {
  pickLearningsForQuestion,
  splitKeywordQuery,
  type LearningMatchRow
} from "../lib/luna/knowledge-match";
import { matchWikiSections } from "../lib/luna/wiki-match";
import { loadWikiDocs } from "../lib/wiki/store";

const CASES = [
  {
    q: "지금 진행 중인 사업개발 건 뭐가 있어",
    expect: "listing" as const,
    minItems: 8,
    maxSec: 25
  },
  {
    q: "우리가 한 공개공지 프로젝트들 공통점",
    expect: "synthesis" as const,
    minItems: 4,
    maxSec: 25
  },
  {
    q: "인스파이어 시즌3 수행계획서 어디 있어",
    expect: "simple" as const,
    minItems: 0,
    maxSec: 10
  },
  {
    q: "볼팍견적이 뭐야",
    expect: "simple" as const,
    minItems: 0,
    maxSec: 10
  }
];

function countAnswerItems(text: string): number {
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*[·•\-*]\s+\S/.test(line)) n += 1;
    else if (/^\s*\d+[.)]\s+\S/.test(line)) n += 1;
  }
  // 종합형은 불릿이 적을 수 있음 — 프로젝트명 언급도 근사
  if (n === 0) {
    const named = text.match(
      /(?:공개공지|미디어|파사드|인스파이어|볼팍|롯데|스타에비뉴|사업개발)/g
    );
    if (named) n = Math.min(named.length, 12);
  }
  return n;
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

  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_API_KEY ||
    process.env.ANTHROPIC_KEY;
  const model =
    process.env.LUNA_VERIFY_MODEL || "claude-haiku-4-5-20251001";

  console.log(
    "| 질문 | 유형 | 주입(노션/위키/기억) | 검색→주입 | 응답초 | 항목수 | 판정 |"
  );
  console.log("|---|---|---|---|---|---|---|");

  let failed = false;
  const { items: wikiDocs } = await loadWikiDocs(admin);
  const { data: learningsData } = await admin
    .from("luna_learnings")
    .select("id, content, category, importance, created_at")
    .limit(200);
  const learningsRows = (learningsData ?? []) as LearningMatchRow[];

  for (const c of CASES) {
    const depth = classifyQuestionDepth(c.q);
    const lim = LLM_INJECT_BY_DEPTH[depth];
    const depthOk = depth === c.expect;
    if (!depthOk) failed = true;

    const t0 = Date.now();
    const listing = isListingQuestion(c.q);
    const notionOutcome = await searchNotionForLuna(admin, c.q, c.q, {
      listing
    });
    const notionInject = takeTopNotionSourcesForLlm(
      notionOutcome.sources,
      lim.notion
    );
    const emb = await retrieveKnowledgeEmbeddings(admin, c.q);
    const kws = splitKeywordQuery(c.q, c.q, []);
    const wiki = matchWikiSections(
      wikiDocs,
      kws,
      c.q,
      emb.wiki,
      wikiLimitsForDepth(depth)
    );
    const learn = pickLearningsForQuestion(learningsRows, kws, {
      embeddingHits: emb.learning,
      max: lim.learnings,
      matchedMax: lim.learnings
    });

    let answer = "";
    let errMsg = "";
    if (apiKey) {
      try {
        const client = new Anthropic({ apiKey });
        const systemParts = [
          listing ? LISTING_ANSWER_RULE : "질문에 구체적으로 답한다. 근거 문서를 밝힌다.",
          listing
            ? formatListingNotionChecklist(notionInject)
            : "",
          notionInject.length > 0
            ? `[노션 검색 결과]\n${formatNotionSourcesForPrompt(notionInject)}`
            : "",
          wiki.length > 0
            ? `[위키]\n${wiki.map((w) => `- ${w.title}: ${w.excerpt.slice(0, 200)}`).join("\n")}`
            : "",
          learn.all.length > 0
            ? `[기억]\n${learn.all.map((l) => `- ${l.content.slice(0, 120)}`).join("\n")}`
            : ""
        ].filter(Boolean);
        const res = await client.messages.create({
          model,
          max_tokens: depth === "simple" ? 800 : 2500,
          system: systemParts.join("\n\n"),
          messages: [{ role: "user", content: c.q }]
        });
        answer =
          res.content.find((p) => p.type === "text")?.text?.trim() ?? "";
      } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e);
        failed = true;
      }
    } else {
      errMsg = "no API key";
    }

    const sec = (Date.now() - t0) / 1000;
    const items = countAnswerItems(answer);
    const injectOk =
      notionInject.length <= lim.notion &&
      wiki.length <= lim.wikiSections &&
      learn.all.length <= lim.learnings;
    const timeOk = !apiKey || sec <= c.maxSec + 8;
    const itemsOk =
      !apiKey ||
      Boolean(errMsg) ||
      c.minItems <= 0 ||
      items >= Math.min(c.minItems, Math.max(notionInject.length, 1));
    const itemsPass = itemsOk;
    const ok = depthOk && injectOk && timeOk && itemsPass && !errMsg;
    if (!ok && apiKey) failed = true;
    if (!depthOk || !injectOk) failed = true;

    const verdict = !depthOk
      ? `FAIL depth=${depth}`
      : !injectOk
        ? "FAIL inject"
        : errMsg
          ? `ERR ${errMsg.slice(0, 36)}`
          : !itemsPass
            ? `FAIL items=${items}<${c.minItems}`
            : !timeOk
              ? `FAIL time=${sec.toFixed(1)}`
              : "OK";

    console.log(
      `| ${c.q} | ${depth} | ${notionInject.length}/${wiki.length}/${learn.all.length} (상한 ${lim.notion}/${lim.wikiSections}/${lim.learnings}) | 검색 ${notionOutcome.sources.length}→주입 ${notionInject.length} | ${sec.toFixed(1)} | ${items} | ${verdict} |`
    );
    if (answer) {
      console.log(answer.slice(0, 420).replace(/\n/g, " / "));
      console.log("");
    }
  }

  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
