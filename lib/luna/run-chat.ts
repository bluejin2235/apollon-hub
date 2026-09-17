import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseNumberedChoices } from "@/lib/luna/chat-response";
import { getTierModel, resolveProviderModel } from "@/lib/luna/engine";
import {
  isSpuriousProjectClarify,
  shouldSkipProjectClarify
} from "@/lib/luna/question-intent";
import {
  applyTypeSearchOverride,
  formatConnectorRoutingSummary,
  hasManualConnectors,
  resolveConnectorsAuto,
  type ConnectorFlags
} from "@/lib/luna/connector-routing";
import {
  applyScopeToConnectorFlags,
  forceSimpleDepthForScope,
  inferRuleClassification,
  resolveSearchScope,
  scopeHitsInsufficient,
  scopeSkipsQueryEmbedding,
  widenSearchScope
} from "@/lib/luna/search-scope";
import { LUNA_DEFAULT_IDENTITY_PROMPT } from "@/lib/luna/constants";
import {
  CLARIFY_CONCEPT_GUARD,
  TYPE_CLASSIFY_FALLBACK,
  TYPE_FIND_FALLBACK,
  TYPE_KNOW_FALLBACK,
  TYPE_LEARN_FALLBACK,
  TYPE_MAKE_FALLBACK
} from "@/lib/luna/prompt-fallbacks";
import {
  isKnowledgeDumpRequest,
  KNOWLEDGE_DUMP_CLARIFY,
  KNOWLEDGE_LIST_HARD_RULE,
  sanitizeKnowledgeListAnswer
} from "@/lib/luna/knowledge-dump-guard";
import {
  formatMatchedLearningsBlock,
  learningUsedInAnswer,
  parseWebAugmentEnabled,
  pickGlossaryForQuestion,
  pickLearningsForQuestion,
  shouldWebAugmentKnow,
  splitKeywordQuery,
  WEB_AUGMENT_SETTINGS_KEY,
  type GlossaryMatchRow,
  type LearningMatchRow
} from "@/lib/luna/knowledge-match";
import { retrieveKnowledgeEmbeddings } from "@/lib/luna/embedding-retrieve";
import {
  orderCardsWithImagePriority,
  searchMediaForLuna
} from "@/lib/luna/media-index-search";
import { formatGlossaryBlock } from "@/lib/luna/prompt-cache";
import { loadWikiDocs, bumpWikiUseCount } from "@/lib/wiki/store";
import {
  formatWikiSectionsBlock,
  matchWikiSections,
  splitWikiSourcesByVisibility,
  wikiSourceUsedInAnswer,
  type WikiSourceRef
} from "@/lib/luna/wiki-match";
import {
  buildLocationAnswerRules,
  formatNotionSourcesForPrompt,
  notionRecordedPaths,
  type NotionSource
} from "@/lib/luna/notion";
import { searchNotionForLuna } from "@/lib/luna/notion-index-search";
import { WORK_STAGE_ANSWER_RULE } from "@/lib/luna/project-stage";
import { takeTopNotionSourcesForLlm } from "@/lib/luna/source-pack";
import {
  answerMaxTokensForDepth,
  LLM_INJECT_BY_DEPTH,
  llmInjectLimitsForQuestion,
  SYNTHESIS_ANSWER_RULE,
  wikiLimitsForDepth,
  type QuestionDepth
} from "@/lib/luna/question-depth";
import {
  formatListingNotionChecklist,
  formatListingWikiChecklist,
  isListingQuestion,
  listingAnswerRuleWithWikiCount
} from "@/lib/luna/listing-question";
import {
  getPrompts,
  LUNA_PROMPT_KEYS,
  LUNA_RUNTIME_PROMPT_KEYS
} from "@/lib/luna/prompts";
import { searchTavily, type LunaCard } from "@/lib/luna/tavily";
import {
  exploreWorkserverFallback,
  exploreWorkserverWithTools,
  type WorkserverExploreRow
} from "@/lib/luna/workserver-explore";
import { searchYoutube } from "@/lib/luna/youtube";
import { lunaLlmComplete } from "@/lib/luna/llm/client";
import {
  classifiedRows,
  formatTypeCatalog,
  loadQuestionTypes,
  parseClassificationJson,
  resolveClassification,
  typesNeedSearch,
  typesSkipClarify
} from "@/lib/luna/question-types";

export const LUNA_MODEL = "claude-sonnet-4-6";
export const LUNA_MODEL_LABEL = "Claude Sonnet 4.6";

const SYNTHESIS_OPINION_FALLBACK =
  "- 검색 결과 목록을 답변에 다시 나열하지 마세요. 화면에 이미 카드로 표시됩니다. 당신은 그 자료들을 종합한 판단과 의견만 쓰세요.";

const CLARIFY_FALLBACK =
  '질문이 모호하면 JSON만 응답: {"needs_clarify":true,"question":"...","options":["...","..."]}. 확실하면 {"needs_clarify":false}.';

const SEARCH_REQUEST_KEYWORDS = ["찾아줘", "레퍼런스", "사례", "검색", "알려줘"] as const;

export type LunaConnectors = {
  notion?: boolean;
  web?: boolean;
  nas?: boolean;
};

export type LunaRunResult = {
  answer: string;
  sources: LunaCard[];
  notionSources: NotionSource[];
  wikiSources?: WikiSourceRef[];
  privateWikiRefs?: WikiSourceRef[];
  durationMs: number;
  modelLabel: string;
  injected_knowledge_ids?: string[];
  injected_terms?: string[];
  web_augmented?: boolean;
  /** 단계별 ms — 프로브·디버그용 */
  stageMs?: Record<string, number>;
};

type NasDirectoryRow = WorkserverExploreRow;

function isSearchRequestMessage(message: string): boolean {
  return SEARCH_REQUEST_KEYWORDS.some((kw) => message.includes(kw));
}

function pathLastSegment(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function isNasFileRow(row: NasDirectoryRow): boolean {
  const t = (row.type ?? "").toLowerCase();
  if (t === "file") return true;
  if (t === "folder" || t === "directory" || t === "dir") return false;
  return /\.[a-z0-9]{1,8}$/i.test(pathLastSegment(row.path));
}

function toNasCard(row: NasDirectoryRow): LunaCard {
  const title = pathLastSegment(row.path);
  const summary = row.file_summary?.trim();
  const hidden = row.variant_hidden ?? 0;
  let base = row.path;
  if (summary) base = `${base} · ${summary}`;
  if (hidden > 0) base = `${base} · 다른 형식 ${hidden}개`;
  const important = (row.importance ?? 0) > 0;
  return {
    type: "nas",
    title,
    url: null,
    thumbnail: null,
    description: important ? `★ ${base}` : base,
    drive: row.drive?.trim() || undefined,
    raw_path: row.path,
    is_file: isNasFileRow(row)
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s) as unknown;
      return v && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const fromFence = tryParse(fence[1].trim());
    if (fromFence) return fromFence;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(trimmed.slice(start, end + 1));
  return null;
}

function resolveEvalConnectors(
  message: string,
  requested: LunaConnectors
): ConnectorFlags {
  const manual: ConnectorFlags = {
    notion: requested.notion === true,
    web: requested.web === true,
    nas: requested.nas === true
  };
  if (hasManualConnectors(manual)) {
    console.log(
      "[luna/route] connectors =",
      manual,
      "· reason =",
      "문항 connectors 지정"
    );
    return manual;
  }
  const routed = resolveConnectorsAuto(message, {
    hasAttachments: false,
    manual
  });
  console.log(
    "[luna/route] connectors =",
    routed.connectors,
    "· reason =",
    routed.reasonLabel,
    "·",
    formatConnectorRoutingSummary(routed)
  );
  return routed.connectors;
}

function buildSystemPrompt(opts: {
  identity: string;
  learningsBlock?: string;
  glossaryBlock?: string;
  wikiSectionsBlock?: string;
  connectorPrompts?: string[];
  synthesisOpinion?: string;
  notionSources?: NotionSource[];
  cards?: LunaCard[];
  nasResults?: NasDirectoryRow[];
  nasSearchAttempted?: boolean;
  webAugmented?: boolean;
  questionDepth?: QuestionDepth;
  listingQuestion?: boolean;
  listingRule?: string;
  listingChecklist?: string;
  llmNotionTopN?: number;
  llmCardsTopN?: number;
  llmNasTopN?: number;
}): string {
  const parts: string[] = [opts.identity.trim() || LUNA_DEFAULT_IDENTITY_PROMPT];
  const depth: QuestionDepth = opts.questionDepth ?? "simple";
  const listing = depth === "listing" || Boolean(opts.listingQuestion);
  const synthesis = depth === "synthesis";
  const notionTop = opts.llmNotionTopN ?? 3;
  const cardsTop = opts.llmCardsTopN ?? 3;
  const nasTop = opts.llmNasTopN ?? 3;

  for (const block of opts.connectorPrompts ?? []) {
    if (block.trim()) parts.push(block.trim());
  }

  if (listing && opts.listingRule?.trim()) {
    parts.push(opts.listingRule.trim());
  } else if (synthesis) {
    parts.push(SYNTHESIS_ANSWER_RULE);
  }
  if (listing && opts.listingChecklist?.trim()) {
    parts.push(opts.listingChecklist.trim());
  }

  if (opts.glossaryBlock?.trim()) parts.push(opts.glossaryBlock.trim());
  if (opts.wikiSectionsBlock?.trim()) parts.push(opts.wikiSectionsBlock.trim());
  if (opts.learningsBlock?.trim()) parts.push(opts.learningsBlock.trim());
  parts.push(WORK_STAGE_ANSWER_RULE);
  if (opts.webAugmented) {
    parts.push(
      "[웹 검색 보강]\n웹 검색 도구가 있다. '기능이 없다'거나 '접근할 수 없다'고 말하지 않는다.\n확정 지식·용어가 있으면 그것을 우선하고, 웹은 일반 정보 보완에만 쓴다."
    );
  }

  if (opts.notionSources && opts.notionSources.length > 0) {
    const forLlm = takeTopNotionSourcesForLlm(opts.notionSources, notionTop);
    const notionHint = listing
      ? `(위 ${forLlm.length}건을 빠짐없이 검토해 해당 항목을 나열한다. 임의로 1건만 고르지 마라.)`
      : synthesis
        ? `(위 ${forLlm.length}건을 사례로 빠짐없이 다룬다. 2~3개로 줄이지 마라.)`
        : `(화면에는 더 많은 자료가 카드로 보이니 목록을 다시 나열하지 마라.)`;
    parts.push(
      `[노션 검색 결과]\n${formatNotionSourcesForPrompt(forLlm)}\n${notionHint}`
    );
  }

  if (opts.cards && opts.cards.length > 0) {
    const topCards = opts.cards.slice(0, cardsTop);
    const cardBlock = topCards
      .map((c) =>
        c.url ? `- [${c.type}] ${c.title}: ${c.url}` : `- [${c.type}] ${c.title}: ${c.description}`
      )
      .join("\n");
    parts.push(`[검색 레퍼런스]\n${cardBlock}`);
  }

  const nasResults = (opts.nasResults ?? []).slice(0, nasTop);
  const notionPaths = notionRecordedPaths(opts.notionSources ?? []);
  if (nasResults.length > 0) {
    const nasBlock = nasResults
      .map((row) => {
        const name = pathLastSegment(row.path);
        const drive = (row.drive ?? "T").trim().toUpperCase() || "T";
        return `- ${name} → ${drive}:\\${row.path.replace(/\//g, "\\")}`;
      })
      .join("\n");
    parts.push(
      "[Work서버 파일 위치]\n" +
        (notionPaths.length > 0
          ? "아래는 Work서버 인덱스 검색 결과다. 노션에 기록된 경로가 있으면 그것을 우선한다.\n"
          : "아래 경로는 Work서버 인덱스에서 확인된 경로다. 목록에 없는 경로는 추측하지 않는다.\n") +
        nasBlock
    );
  } else if (opts.nasSearchAttempted) {
    parts.push(
      notionPaths.length > 0
        ? "[Work서버 파일 위치]\n(인덱스 검색 0건 — 노션에 기록된 경로를 우선 사용한다. 찾지 못했다고 단정하지 말 것)"
        : "[Work서버 파일 위치]\n(검색 결과 없음 — 찾지 못했다고 명확히 답하고 경로를 추측하지 마세요)"
    );
  }

  const closing: string[] = [
    buildLocationAnswerRules({
      hasNotionSources: (opts.notionSources?.length ?? 0) > 0,
      hasNotionPaths: notionPaths.length > 0
    }),
    "- '기능 준비 중', '연동이 안 되어 있다', '검색 실패'처럼 시스템 장애로 단정하지 마세요."
  ];
  if (depth === "simple") {
    const opinionRule =
      opts.synthesisOpinion?.trim() || SYNTHESIS_OPINION_FALLBACK;
    closing.push(
      opinionRule.startsWith("-") ? opinionRule : `- ${opinionRule}`
    );
    closing.push(
      "- 위치 답변은 카드 목록을 다시 나열하는 것이 아니다. 핵심 경로와 근거 노션 링크를 문장으로 말한다."
    );
  }
  closing.push(
    `${KNOWLEDGE_LIST_HARD_RULE}`,
    "- 답변은 아폴론의 과거 프로젝트 맥락과 연결해서 구체적으로 쓰세요."
  );
  parts.push(closing.join("\n"));

  return parts.join("\n\n");
}

async function maybeClarify(
  admin: SupabaseClient,
  userText: string,
  clarifyPrompt: string
): Promise<string | null> {
  if (shouldSkipProjectClarify(userText)) return null;
  try {
    const clarifyRes = await lunaLlmComplete(admin, {
      tier: "B",
      feature: "understand",
      system: clarifyPrompt.trim() || CLARIFY_FALLBACK,
      user: userText,
      maxTokens: 512
    });
    const raw = clarifyRes.text.trim();
    const parsed = parseJsonObject(raw);
    if (parsed) {
      const needs = parsed.needs_clarify === true;
      const question =
        typeof parsed.question === "string" ? parsed.question.trim() : "";
      const options = Array.isArray(parsed.options)
        ? parsed.options
            .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
            .map((o) => o.trim())
            .slice(0, 5)
        : [];
      if (needs && question && options.length >= 2) {
        if (isSpuriousProjectClarify(userText, options)) return null;
        return `${question}\n${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`;
      }
      return null;
    }
    const numbered = parseNumberedChoices(raw);
    if (numbered && numbered.options.length >= 2) {
      if (isSpuriousProjectClarify(userText, numbered.options)) return null;
      return `${numbered.body || "어느 쪽을 찾으시나요?"}\n${numbered.options
        .map((o, i) => `${i + 1}. ${o}`)
        .join("\n")}`;
    }
  } catch (err) {
    console.error("[luna/run-chat] clarify", err);
  }
  return null;
}

/**
 * 단일 턴 LUNA 실행 (대화 이력/스킬/첨부 없음). 회귀 테스트용.
 * 일반 대화와 동일하게: 커넥터 수동 우선 → 없으면 자동 라우팅 → 되묻기 → 검색 → 답변.
 * 메시지를 DB에 저장하지 않음.
 */
export async function runLunaTurn(
  admin: SupabaseClient,
  message: string,
  connectors: LunaConnectors = {}
): Promise<LunaRunResult> {
  const startedAt = Date.now();
  const stageMs: Record<string, number> = {};
  const mark = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      stageMs[key] = (stageMs[key] ?? 0) + (Date.now() - t0);
    }
  };
  const userText = message.trim();
  if (!userText) {
    throw new Error("message is required");
  }

  if (isKnowledgeDumpRequest(userText)) {
    return {
      answer: KNOWLEDGE_DUMP_CLARIFY,
      sources: [],
      notionSources: [],
      durationMs: Date.now() - startedAt,
      modelLabel: LUNA_MODEL_LABEL,
      stageMs
    };
  }

  const loadedPrompts = await mark("load_prompts", () =>
    getPrompts(admin, [...LUNA_RUNTIME_PROMPT_KEYS])
  );

  const identity =
    loadedPrompts[LUNA_PROMPT_KEYS.identity]?.trim() || LUNA_DEFAULT_IDENTITY_PROMPT;
  const talkFind = loadedPrompts[LUNA_PROMPT_KEYS.find]?.trim() || TYPE_FIND_FALLBACK;
  const talkKnow = loadedPrompts[LUNA_PROMPT_KEYS.know]?.trim() || TYPE_KNOW_FALLBACK;
  const talkMake = loadedPrompts[LUNA_PROMPT_KEYS.make]?.trim() || TYPE_MAKE_FALLBACK;
  const talkLearn = loadedPrompts[LUNA_PROMPT_KEYS.learn]?.trim() || TYPE_LEARN_FALLBACK;
  const classifyPrompt =
    loadedPrompts[LUNA_PROMPT_KEYS.classify]?.trim() || TYPE_CLASSIFY_FALLBACK;
  const talkAnswer = loadedPrompts[LUNA_PROMPT_KEYS.answer]?.trim() || "";
  const talkAssume = loadedPrompts[LUNA_PROMPT_KEYS.assume]?.trim() || "";
  const clarifyPrompt = [
    loadedPrompts[LUNA_PROMPT_KEYS.understand]?.trim() || CLARIFY_FALLBACK,
    loadedPrompts[LUNA_PROMPT_KEYS.clarifyGuard]?.trim() || CLARIFY_CONCEPT_GUARD
  ]
    .filter(Boolean)
    .join("\n\n");
  const synthesisOpinion =
    [talkAnswer, talkAssume].filter(Boolean).join("\n\n") ||
    SYNTHESIS_OPINION_FALLBACK;

  const [{ types: questionTypes }, wikiLoaded] = await mark(
    "load_types_wiki",
    () =>
      Promise.all([
        loadQuestionTypes(admin, {
          activeOnly: true
        }),
        loadWikiDocs(admin, { activeOnly: true })
      ])
  );
  const wikiDocs = wikiLoaded.items;
  let classifiedSlugs: string[] = [];
  let classifyConfidence = 1;
  const ruleInfer = inferRuleClassification(userText);
  if (ruleInfer) {
    classifiedSlugs = ruleInfer.types;
    classifyConfidence = 0.95;
    stageMs.classify = 0;
    console.log("[luna/classify] rule-skip", ruleInfer);
  } else {
    try {
      await mark("classify", async () => {
        const classifyRes = await lunaLlmComplete(admin, {
          tier: "C",
          feature: "understand",
          system: `${classifyPrompt}\n\n[유형 목록]\n${formatTypeCatalog(questionTypes)}`,
          user: userText,
          maxTokens: 256
        });
        const parsed = parseClassificationJson(classifyRes.text);
        const classification = resolveClassification(parsed, questionTypes, {
          forceSearch: hasManualConnectors({
            notion: connectors.notion === true,
            web: connectors.web === true,
            nas: connectors.nas === true
          })
        });
        classifiedSlugs = classification.types;
        classifyConfidence = classification.confidence;
        console.log("[luna/classify]", classification);
      });
    } catch (err) {
      console.error("[luna/run-chat] classify", err);
    }
  }
  const classifiedTypeRows = classifiedRows(questionTypes, classifiedSlugs);
  const needsSearch = typesNeedSearch(classifiedTypeRows);

  const initial = resolveEvalConnectors(userText, connectors);
  const routed = applyTypeSearchOverride(
    {
      connectors: initial,
      reason: "ambiguous_wide",
      reasonLabel: "eval"
    },
    {
      needsSearch,
      manual: hasManualConnectors({
        notion: connectors.notion === true,
        web: connectors.web === true,
        nas: connectors.nas === true
      }),
      message: userText,
      hasAttachments: false
    }
  );
  const _notionEnabled = routed.connectors.notion;
  void _notionEnabled;
  let webEnabled = routed.connectors.web;
  let nasEnabled = routed.connectors.nas;

  let searchScope = resolveSearchScope({
    types: classifiedSlugs,
    question: userText,
    classifyConfidence
  });
  {
    const scoped = applyScopeToConnectorFlags(
      searchScope.flags,
      {
        notion: routed.connectors.notion,
        web: webEnabled,
        nas: nasEnabled
      },
      hasManualConnectors({
        notion: connectors.notion === true,
        web: connectors.web === true,
        nas: connectors.nas === true
      })
    );
    webEnabled = scoped.web;
    nasEnabled = scoped.nas;
  }
  console.log("[luna/run-chat] search-scope", {
    kind: searchScope.kind,
    tier: searchScope.tier,
    flags: searchScope.flags
  });

  const typePromptByKey: Record<string, string> = {
    [LUNA_PROMPT_KEYS.find]: talkFind,
    [LUNA_PROMPT_KEYS.know]: talkKnow,
    [LUNA_PROMPT_KEYS.make]: talkMake,
    [LUNA_PROMPT_KEYS.learn]: talkLearn
  };

  const connectorPrompts: string[] = [];
  for (const row of classifiedTypeRows) {
    if (!row.prompt_key) continue;
    const text = typePromptByKey[row.prompt_key];
    if (text) connectorPrompts.push(text);
  }

  if (
    !typesSkipClarify(classifiedTypeRows) &&
    !forceSimpleDepthForScope(searchScope.kind) &&
    searchScope.kind !== "reference"
  ) {
    const clarifyAnswer = await maybeClarify(admin, userText, clarifyPrompt);
    if (clarifyAnswer) {
      return {
        answer: clarifyAnswer,
        sources: [],
        notionSources: [],
        durationMs: Date.now() - startedAt,
        modelLabel: LUNA_MODEL_LABEL,
        stageMs
      };
    }
  }

  // 주입 안전: status='active' 만. candidate 는 절대 주입하지 않음.
  let learningsData: LearningMatchRow[] | null = null;
  await mark("load_learnings", async () => {
    const res = await admin
      .from("luna_learnings")
      .select("id, content, category, importance, use_count, created_at")
      .eq("status", "active")
      .neq("category", "identity")
      .order("importance", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);
    learningsData = (res.data ?? null) as LearningMatchRow[] | null;
  });

  let glossaryRows: GlossaryMatchRow[] = [];
  await mark("load_glossary", async () => {
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

  const { data: webAugmentRow } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", WEB_AUGMENT_SETTINGS_KEY)
    .maybeSingle();
  const webAugmentEnabled = parseWebAugmentEnabled(webAugmentRow?.value);

  // 검색·매칭은 질문 원문 고정 (LLM 키워드 추출은 재현성을 해침)
  const keywords = userText.slice(0, 120);
  const injectKeywords = splitKeywordQuery(keywords, userText, glossaryRows);
  const emb = scopeSkipsQueryEmbedding(searchScope.kind)
    ? {
        queryEmbedding: null as number[] | null,
        wiki: [],
        glossary: [],
        learning: [],
        embed_ms: 0
      }
    : await mark("embed_and_match", () =>
        retrieveKnowledgeEmbeddings(admin, userText)
      );
  if (scopeSkipsQueryEmbedding(searchScope.kind)) stageMs.embed_and_match = 0;
  const rawDepth = llmInjectLimitsForQuestion(userText);
  const questionDepth: QuestionDepth = forceSimpleDepthForScope(searchScope.kind)
    ? "simple"
    : rawDepth.depth;
  const llmInject =
    questionDepth === "simple" ? LLM_INJECT_BY_DEPTH.simple : rawDepth.limits;
  const listingQuestion = isListingQuestion(userText);
  const knowledgeInject = pickLearningsForQuestion(
    (learningsData ?? []) as LearningMatchRow[],
    injectKeywords,
    {
      embeddingHits: emb.learning,
      max:
        searchScope.kind === "term" || searchScope.kind === "policy"
          ? Math.min(1, llmInject.learnings)
          : llmInject.learnings,
      matchedMax:
        searchScope.kind === "term" || searchScope.kind === "policy"
          ? 1
          : llmInject.learnings
    }
  );
  const matchedTerms = searchScope.flags.glossary
    ? pickGlossaryForQuestion(
        glossaryRows,
        injectKeywords,
        emb.glossary
      )
    : [];
  const wikiSources =
    searchScope.flags.wiki &&
    (classifiedSlugs.includes("know") || classifiedSlugs.includes("find"))
      ? matchWikiSections(
          wikiDocs,
          injectKeywords,
          userText,
          emb.wiki,
          wikiLimitsForDepth(questionDepth, llmInject)
        )
      : [];
  const { public: publicWikiSources, private: privateWikiRefs } =
    splitWikiSourcesByVisibility(wikiSources);
  const injectedTerms = matchedTerms
    .map((t) => (t.term_ko ?? "").trim())
    .filter(Boolean);
  const learnings = knowledgeInject.all.map((l) => ({
    content: l.content,
    category: l.category
  }));
  const learningsBlock =
    searchScope.kind === "term" || searchScope.kind === "policy"
      ? formatMatchedLearningsBlock({
          matched: knowledgeInject.matched.slice(0, 1),
          other: []
        })
      : formatMatchedLearningsBlock({
          matched: knowledgeInject.matched,
          other: knowledgeInject.other
        });
  const glossaryBlock = formatGlossaryBlock(matchedTerms);
  const wikiSectionsBlock = formatWikiSectionsBlock(wikiSources);

  let webAugmented = false;
  if (
    scopeHitsInsufficient(searchScope.kind, {
      glossary: matchedTerms.length,
      wiki: wikiSources.length,
      notion: 0,
      nas: 0,
      media: 0
    }) &&
    shouldWebAugmentKnow({
      enabled: webAugmentEnabled,
      typeSlugs: classifiedSlugs,
      matchedKnowledge: knowledgeInject.matched.length,
      matchedTerms: matchedTerms.length,
      question: userText,
      alreadyWeb: webEnabled
    })
  ) {
    webEnabled = true;
    webAugmented = true;
  }

  // 위키·용어사전만으로 부족하면 넓힘
  if (
    scopeHitsInsufficient(searchScope.kind, {
      glossary: matchedTerms.length,
      wiki: wikiSources.length,
      notion: 0,
      nas: 0,
      media: 0
    })
  ) {
    const widened = widenSearchScope(searchScope);
    if (widened) {
      searchScope = widened;
      const scoped = applyScopeToConnectorFlags(
        searchScope.flags,
        {
          notion: searchScope.flags.notion,
          web: webEnabled,
          nas: nasEnabled
        },
        false
      );
      webEnabled = scoped.web;
      nasEnabled = scoped.nas;
    }
  }

  const isSearchRequest = isSearchRequestMessage(userText);

  let notionSources: NotionSource[] = [];
  let nasResults: NasDirectoryRow[] = [];
  let webCards: LunaCard[] = [];
  let youtubeCards: LunaCard[] = [];
  let nasSearchAttempted = false;

  let mediaCards: LunaCard[] = [];
  const runNotion = searchScope.flags.notion && Boolean(keywords || userText);
  const runMedia = searchScope.flags.media;
  if (runNotion || runMedia) {
    await mark("connector_search", async () => {
      const [notionOutcome, mediaRes] = await Promise.all([
        runNotion
          ? searchNotionForLuna(admin, keywords || userText, userText, {
              queryEmbedding: emb.queryEmbedding,
              skipLive: true,
              listing: false
            })
          : Promise.resolve({
              status: "skipped" as const,
              sources: [] as NotionSource[],
              queries: [] as string[],
              rounds: 0
            }),
        runMedia
          ? searchMediaForLuna(admin, emb.queryEmbedding, userText)
          : Promise.resolve({ cards: [] as LunaCard[], hits: [] })
      ]);
      notionSources = notionOutcome.sources;
      mediaCards = mediaRes.cards;
    });
  } else {
    stageMs.connector_search = 0;
  }
  if (webEnabled && searchScope.flags.web) {
    webCards = await searchTavily(keywords || userText);
  }
  if (needsSearch && isSearchRequest && keywords && searchScope.flags.youtube) {
    youtubeCards = await searchYoutube(keywords);
  }
  // 프로젝트: 노션이 충분하면 Work 색인은 생략 (도구 루프는 이미 꺼 둠)
  const runNasIndex =
    nasEnabled &&
    searchScope.flags.nas &&
    !(searchScope.kind === "project" && notionSources.length >= 3);

  if (runNasIndex) {
    nasSearchAttempted = true;
    const kw = keywords || userText;
    const useNasTools =
      searchScope.kind === "find_wide" || searchScope.kind === "wide";
    await mark("nas_explore", async () => {
      try {
        if (useNasTools) {
          const tierB = resolveProviderModel(await getTierModel(admin, "B"));
          const explored = await exploreWorkserverWithTools(admin, null, {
            keywords: kw,
            queryText: userText,
            model: tierB.model_id,
            provider: tierB.provider,
            exploreSystem: talkFind
          });
          nasResults = explored.rows;
          console.log(
            "[luna/ws] eval explore done",
            { kw, toolCalls: explored.toolCalls.length },
            "→",
            nasResults.length
          );
        } else {
          nasResults = await exploreWorkserverFallback(admin, kw, userText);
          console.log("[luna/ws] eval index-only →", nasResults.length);
        }
      } catch (err) {
        console.error(
          "[luna/ws] tool loop failed, fallback to legacy",
          err
        );
        nasResults = await exploreWorkserverFallback(admin, kw, userText);
        console.log("[luna/ws] eval fallback →", nasResults.length);
      }
    });
  } else {
    stageMs.nas_explore = 0;
  }

  // 검색 후에도 부족하면 한 단계 더
  if (
    scopeHitsInsufficient(searchScope.kind, {
      glossary: matchedTerms.length,
      wiki: wikiSources.length,
      notion: notionSources.length,
      nas: nasResults.length,
      media: mediaCards.length
    })
  ) {
    const widened = widenSearchScope(searchScope);
    if (widened && widened.flags.notion && notionSources.length === 0) {
      searchScope = widened;
      const notionOutcome = await searchNotionForLuna(
        admin,
        keywords || userText,
        userText,
        {
          queryEmbedding: emb.queryEmbedding,
          skipLive: false,
          listing: false
        }
      );
      notionSources = notionOutcome.sources;
    }
  }

  const notionCards: LunaCard[] = notionSources.map((s) => ({
    type: "notion" as const,
    title: s.title,
    url: s.url,
    thumbnail: null,
    description: ""
  }));
  const cards = orderCardsWithImagePriority(
    [...notionCards, ...nasResults.map(toNasCard), ...mediaCards, ...webCards, ...youtubeCards],
    userText
  );
  const notionForLlm = takeTopNotionSourcesForLlm(
    notionSources,
    llmInject.notion
  );
  const listingRule = listingQuestion
    ? listingAnswerRuleWithWikiCount(
        new Set(wikiSources.map((s) => s.slug)).size,
        notionForLlm.length
      )
    : undefined;
  const listingChecklist = listingQuestion
    ? [
        formatListingWikiChecklist(wikiSources),
        formatListingNotionChecklist(notionForLlm)
      ]
        .filter(Boolean)
        .join("\n\n")
    : undefined;

  const systemPrompt = buildSystemPrompt({
    identity,
    learningsBlock,
    glossaryBlock,
    wikiSectionsBlock,
    connectorPrompts,
    synthesisOpinion,
    notionSources,
    cards,
    nasResults,
    nasSearchAttempted,
    webAugmented,
    questionDepth,
    listingQuestion,
    listingRule,
    listingChecklist,
    llmNotionTopN: llmInject.notion,
    llmCardsTopN: llmInject.cards,
    llmNasTopN: llmInject.nas
  });

  const answerMaxTokens =
    searchScope.kind === "term" ||
    searchScope.kind === "policy" ||
    searchScope.kind === "project" ||
    searchScope.kind === "person"
      ? 512
      : answerMaxTokensForDepth(questionDepth, false);

  const answerRes = await mark("answer_llm", () =>
    lunaLlmComplete(admin, {
      tier: "A",
      feature: "chat_answer",
      system: systemPrompt,
      user: userText,
      maxTokens: answerMaxTokens
    })
  );
  const rawAnswer = answerRes.text.trim();
  let answer = sanitizeKnowledgeListAnswer(rawAnswer, learnings);
  const webCardsUsed = webAugmented && cards.some((c) => c.type === "web");
  if (webCardsUsed && !answer.includes("웹 검색으로 보강함")) {
    answer = `${answer.trim()}\n\n웹 검색으로 보강함`;
  }

  if (knowledgeInject.matched.length > 0) {
    const nowIso = new Date().toISOString();
    const used = knowledgeInject.matched.filter((row) =>
      learningUsedInAnswer(row, answer, injectKeywords)
    );
    if (used.length > 0) {
      await Promise.all(
        used.map((row) =>
          admin
            .from("luna_learnings")
            .update({
              use_count: (row.use_count ?? 0) + 1,
              last_used_at: nowIso
            })
            .eq("id", row.id)
        )
      );
    }
  }
  const usedWikiSlugs = Array.from(
    new Set(
      wikiSources.filter((hit) => wikiSourceUsedInAnswer(hit, answer)).map((hit) => hit.slug)
    )
  );
  if (usedWikiSlugs.length > 0) {
    await bumpWikiUseCount(admin, usedWikiSlugs);
  }

  return {
    answer,
    sources: cards,
    notionSources,
    wikiSources: publicWikiSources,
    privateWikiRefs: privateWikiRefs.length > 0 ? privateWikiRefs : undefined,
    durationMs: Date.now() - startedAt,
    modelLabel: answerRes.model_label || LUNA_MODEL_LABEL,
    injected_knowledge_ids: knowledgeInject.ids,
    injected_terms: injectedTerms,
    web_augmented: webAugmented,
    stageMs
  };
}
