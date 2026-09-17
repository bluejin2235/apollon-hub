/**
 * 검색 범위 경로 — 단계별 시간 분해 + classify on/off 비교.
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/probe-scope-stages.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  loadQuestionTypes,
  formatTypeCatalog,
  parseClassificationJson,
  resolveClassification
} from "../lib/luna/question-types";
import { loadWikiDocs } from "../lib/wiki/store";
import { lunaLlmComplete } from "../lib/luna/llm/client";
import { retrieveKnowledgeEmbeddings } from "../lib/luna/embedding-retrieve";
import {
  pickGlossaryForQuestion,
  pickLearningsForQuestion,
  splitKeywordQuery,
  type GlossaryMatchRow,
  type LearningMatchRow
} from "../lib/luna/knowledge-match";
import {
  matchWikiSections,
  formatWikiSectionsBlock
} from "../lib/luna/wiki-match";
import { formatGlossaryBlock } from "../lib/luna/prompt-cache";
import {
  inferRuleClassification,
  resolveSearchScope,
  scopeSkipsQueryEmbedding
} from "../lib/luna/search-scope";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import { searchMediaForLuna } from "../lib/luna/media-index-search";
import { exploreWorkserverWithTools } from "../lib/luna/workserver-explore";
import { getPrompts, LUNA_PROMPT_KEYS, LUNA_RUNTIME_PROMPT_KEYS } from "../lib/luna/prompts";
import { TYPE_CLASSIFY_FALLBACK, TYPE_KNOW_FALLBACK, TYPE_FIND_FALLBACK } from "../lib/luna/prompt-fallbacks";
import { LUNA_DEFAULT_IDENTITY_PROMPT } from "../lib/luna/constants";
import { llmInjectLimitsForQuestion, wikiLimitsForDepth } from "../lib/luna/question-depth";
import { formatSeconds } from "../lib/luna/response-timings";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicApiKey } from "../lib/luna/env-keys";

const QUESTIONS = [
  "볼팍견적이 뭐야?",
  "병가 며칠 쓸 수 있어?",
  "인스파이어 시즌4 어떻게 돼가?",
  "상지원 상무가 얘기한 내용",
  "미디어파사드 사례 보여줘"
];

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env required");
  return createClient(url, key, { auth: { persistSession: false } });
}

type StageMs = Record<string, number>;

async function timed<T>(
  bag: StageMs,
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    bag[key] = (bag[key] ?? 0) + (Date.now() - t0);
  }
}

async function probeOne(
  admin: SupabaseClient,
  question: string,
  opts: { useClassify: boolean }
) {
  const stages: StageMs = {};
  const total0 = Date.now();
  const rule = inferRuleClassification(question);

  const prompts = await timed(stages, "load_prompts", () =>
    getPrompts(admin, [...LUNA_RUNTIME_PROMPT_KEYS])
  );

  const [{ types: questionTypes }, wikiLoaded] = await timed(
    stages,
    "load_types_wiki",
    () =>
      Promise.all([
        loadQuestionTypes(admin, { activeOnly: true }),
        loadWikiDocs(admin, { activeOnly: true })
      ])
  );
  const wikiDocs = wikiLoaded.items;

  let types: string[] = [];
  let classifyConfidence = 1;
  let classifySkipped = false;

  if (!opts.useClassify && rule) {
    types = rule.types;
    classifyConfidence = 0.95;
    classifySkipped = true;
    stages.classify = 0;
  } else {
    await timed(stages, "classify", async () => {
      const classifyPrompt =
        prompts[LUNA_PROMPT_KEYS.classify]?.trim() || TYPE_CLASSIFY_FALLBACK;
      const res = await lunaLlmComplete(admin, {
        tier: "C",
        feature: "understand",
        system: `${classifyPrompt}\n\n[유형 목록]\n${formatTypeCatalog(questionTypes)}`,
        user: question,
        maxTokens: 256
      });
      const parsed = parseClassificationJson(res.text);
      const classification = resolveClassification(parsed, questionTypes, {
        forceSearch: false
      });
      types = classification.types;
      classifyConfidence = classification.confidence;
    });
  }

  // 규칙이 있으면 규칙 kind 우선
  const scope = resolveSearchScope({
    types,
    question,
    classifyConfidence
  });
  const kind = rule?.kind ?? scope.kind;
  const flags = scope.flags;

  const { data: learningsData } = await timed(stages, "load_learnings", () =>
    admin
      .from("luna_learnings")
      .select("id, content, category, importance, use_count, created_at")
      .eq("status", "active")
      .neq("category", "identity")
      .order("importance", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200)
  );

  let glossaryRows: GlossaryMatchRow[] = [];
  await timed(stages, "load_glossary", async () => {
    let gq = await admin
      .from("glossary_terms")
      .select("id, term_ko, term_en, synonyms, definition")
      .is("deleted_at", null);
    if (gq.error) {
      gq = await admin
        .from("glossary_terms")
        .select("id, term_ko, term_en, synonyms, definition");
    }
    if (!gq.error) glossaryRows = (gq.data ?? []) as GlossaryMatchRow[];
  });

  const injectKeywords = splitKeywordQuery(question, question, glossaryRows);
  const skipEmb = scopeSkipsQueryEmbedding(kind);

  const emb = skipEmb
    ? {
        queryEmbedding: null as number[] | null,
        wiki: [],
        glossary: [],
        learning: [],
        embed_ms: 0
      }
    : await timed(stages, "embed_and_match", () =>
        retrieveKnowledgeEmbeddings(admin, question)
      );
  if (skipEmb) stages.embed_and_match = 0;
  else stages.embed_query_only = emb.embed_ms;

  const { limits: llmInject } = llmInjectLimitsForQuestion(question);
  const knowledgeInject = pickLearningsForQuestion(
    (learningsData ?? []) as LearningMatchRow[],
    injectKeywords,
    {
      embeddingHits: emb.learning,
      max: llmInject.learnings,
      matchedMax: llmInject.learnings
    }
  );

  const matchedTerms = await timed(stages, "glossary_match", async () =>
    flags.glossary
      ? pickGlossaryForQuestion(glossaryRows, injectKeywords, emb.glossary)
      : []
  );

  const wikiSources = await timed(stages, "wiki_match", async () =>
    flags.wiki
      ? matchWikiSections(
          wikiDocs,
          injectKeywords,
          question,
          emb.wiki,
          wikiLimitsForDepth(llmInjectLimitsForQuestion(question).depth)
        )
      : []
  );

  let notionN = 0;
  let nasN = 0;
  let mediaN = 0;

  if (flags.notion) {
    const outcome = await timed(stages, "notion_search", () =>
      searchNotionForLuna(admin, question.slice(0, 80), question, {
        queryEmbedding: emb.queryEmbedding,
        skipLive: true,
        listing: false
      })
    );
    notionN = outcome.sources.length;
    stages.notion_link = outcome.secondary?.link_ms ?? 0;
  } else {
    stages.notion_search = 0;
    stages.notion_link = 0;
  }

  if (flags.media && emb.queryEmbedding) {
    const media = await timed(stages, "media_search", () =>
      searchMediaForLuna(admin, emb.queryEmbedding, question)
    );
    mediaN = media.cards.length;
  } else {
    stages.media_search = 0;
  }

  if (flags.nas) {
    const key = anthropicApiKey();
    if (key) {
      const client = new Anthropic({ apiKey: key });
      const talkFind =
        prompts[LUNA_PROMPT_KEYS.find]?.trim() || TYPE_FIND_FALLBACK;
      try {
        const explored = await timed(stages, "nas_explore", () =>
          exploreWorkserverWithTools(admin, client, {
            keywords: question.slice(0, 80),
            queryText: question,
            model: "claude-sonnet-4-20250514",
            exploreSystem: talkFind
          })
        );
        nasN = explored.rows.length;
      } catch {
        stages.nas_explore = stages.nas_explore ?? 0;
      }
    }
  } else {
    stages.nas_explore = 0;
  }

  const glossaryBlock = formatGlossaryBlock(matchedTerms);
  const wikiBlock = formatWikiSectionsBlock(wikiSources);
  const identity =
    prompts[LUNA_PROMPT_KEYS.identity]?.trim() || LUNA_DEFAULT_IDENTITY_PROMPT;
  const typePrompt =
    types.includes("find")
      ? prompts[LUNA_PROMPT_KEYS.find]?.trim() || TYPE_FIND_FALLBACK
      : prompts[LUNA_PROMPT_KEYS.know]?.trim() || TYPE_KNOW_FALLBACK;

  const system = [
    identity,
    typePrompt,
    glossaryBlock,
    wikiBlock,
    "주어진 자료만으로 한국어로 짧게 답하세요."
  ]
    .filter(Boolean)
    .join("\n\n");

  const answer = await timed(stages, "answer_llm", () =>
    lunaLlmComplete(admin, {
      tier: "A",
      feature: "chat_answer",
      system,
      user: question,
      maxTokens: 512
    })
  );

  const total_ms = Date.now() - total0;
  const sumKnown = Object.values(stages).reduce((a, b) => a + b, 0);

  return {
    question,
    useClassify: opts.useClassify,
    classifySkipped,
    rule: rule?.kind ?? null,
    scope: kind,
    types,
    docs: {
      glossary: matchedTerms.length,
      wiki: wikiSources.length,
      notion: notionN,
      nas: nasN,
      media: mediaN
    },
    stages,
    total_ms,
    accounted_ms: sumKnown,
    answer_preview: answer.text.replace(/\s+/g, " ").slice(0, 100)
  };
}

function printStages(r: Awaited<ReturnType<typeof probeOne>>) {
  const order = [
    "load_prompts",
    "load_types_wiki",
    "classify",
    "load_learnings",
    "load_glossary",
    "embed_and_match",
    "embed_query_only",
    "glossary_match",
    "wiki_match",
    "notion_search",
    "notion_link",
    "media_search",
    "nas_explore",
    "answer_llm"
  ];
  const lines = order
    .filter((k) => r.stages[k] != null)
    .map((k) => `    ${k.padEnd(18)} ${formatSeconds(r.stages[k]!)}`);
  console.log(
    `\n=== ${r.question} · classify=${r.useClassify ? "ON" : "OFF"} · scope=${r.scope} ===`
  );
  console.log(
    `  total ${formatSeconds(r.total_ms)} · accounted ${formatSeconds(r.accounted_ms)} · docs g${r.docs.glossary}/w${r.docs.wiki}/n${r.docs.notion}/nas${r.docs.nas}/m${r.docs.media}`
  );
  console.log(lines.join("\n"));
  console.log(`  answer: ${r.answer_preview}`);
}

async function main() {
  const admin = adminClient();

  console.log("\n--- A) classify ON (현재와 유사) ---");
  const withClassify = [];
  for (const q of QUESTIONS) {
    const r = await probeOne(admin, q, { useClassify: true });
    withClassify.push(r);
    printStages(r);
  }

  console.log("\n--- B) classify OFF (규칙만) ---");
  const noClassify = [];
  for (const q of QUESTIONS) {
    const r = await probeOne(admin, q, { useClassify: false });
    noClassify.push(r);
    printStages(r);
  }

  console.log("\n=== classify ON vs OFF ===");
  for (let i = 0; i < QUESTIONS.length; i++) {
    const a = withClassify[i]!;
    const b = noClassify[i]!;
    const dClassify = (a.stages.classify ?? 0) - (b.stages.classify ?? 0);
    const dTotal = a.total_ms - b.total_ms;
    console.log(
      `${QUESTIONS[i]}\n  classify ${formatSeconds(a.stages.classify ?? 0)} → ${formatSeconds(b.stages.classify ?? 0)} (Δ ${formatSeconds(dClassify)})\n  total    ${formatSeconds(a.total_ms)} → ${formatSeconds(b.total_ms)} (Δ ${formatSeconds(dTotal)}) · answer_llm ${formatSeconds(b.stages.answer_llm ?? 0)} · embed ${formatSeconds(b.stages.embed_and_match ?? 0)} · nas ${formatSeconds(b.stages.nas_explore ?? 0)}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
