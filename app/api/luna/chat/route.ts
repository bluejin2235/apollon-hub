import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import { runAnalysisPipeline } from "@/lib/luna/analysis";
import { LUNA_DEFAULT_IDENTITY_PROMPT } from "@/lib/luna/constants";
import {
  bumpUsageDaily,
  emptyUsage,
  getTierModel,
  readUsage,
  resolveProviderModel,
  type LunaUsageTokens
} from "@/lib/luna/engine";
import { llmStreamText, lunaLlmComplete } from "@/lib/luna/llm/client";
import {
  buildCachedSystem,
  formatGlossaryBlock,
  type CachedSystemPayload
} from "@/lib/luna/prompt-cache";
import {
  buildLocationAnswerRules,
  formatNotionSourcesForPrompt,
  mergeNotionSearchOutcomes,
  notionRecordedPaths,
  annotateNotionSourcesWithWorkStage,
  type NotionSearchOutcome,
  type NotionSearchStatus,
  type NotionSource
} from "@/lib/luna/notion";
import { searchNotionForLuna } from "@/lib/luna/notion-index-search";
import { matchNasChunkEmbeddings } from "@/lib/luna/nas-chunk-search";
import { searchNasTextKeyword } from "@/lib/luna/nas-text-keyword";
import { recordResponseTiming } from "@/lib/luna/response-timings";
import { estimateUsageKrw } from "@/lib/luna/model-pricing";
import { USD_KRW_FALLBACK } from "@/lib/fx/get-rate-for-date";
import { recordAnswerFlagsAsync } from "@/lib/luna/answer-flags";
import {
  hasImageSearchIntent,
  orderCardsWithImagePriority,
  searchMediaForLuna
} from "@/lib/luna/media-index-search";
import { WORK_STAGE_ANSWER_RULE } from "@/lib/luna/project-stage";
import {
  maxNotionMatchStrength,
  maxNotionSimilarity,
  PACK_LLM_TOP_N,
  PACK_SCORE_RECOMMENDED,
  takeTopNotionSourcesForLlm
} from "@/lib/luna/source-pack";
import {
  getPromptRows,
  LUNA_PROMPT_KEYS,
  LUNA_RUNTIME_PROMPT_KEYS,
  type LunaLoadedPrompt,
  type LunaPromptKind,
  type LunaPromptLevel
} from "@/lib/luna/prompts";
import { searchTavily, type LunaCard } from "@/lib/luna/tavily";
import { scheduleConversationTitle } from "@/lib/luna/conversation-title";
import {
  formatUserMemoryBlock,
  getUserMemory,
  scheduleUserMemoRewrite,
  type LunaUserMemory
} from "@/lib/luna/user-memory";
import { maybeProposeMemoryAsk } from "@/lib/luna/memory-ask";
import {
  bumpReportUse,
  findSimilarReport
} from "@/lib/luna/selfstudy";
import {
  lookupNasByRecordedPaths,
  runWorkserverResultPipeline
} from "@/lib/luna/workserver";
import {
  exploreWorkserverFallback,
  exploreWorkserverWithTools,
  type WorkserverExploreRow
} from "@/lib/luna/workserver-explore";
import { searchYoutube } from "@/lib/luna/youtube";
import { parseNumberedChoices, scrubLunaAnswerText } from "@/lib/luna/chat-response";
import { bumpWikiUseCount } from "@/lib/wiki/store";
import { loadWikiDocs } from "@/lib/wiki/store";
import { PREP_TTL_MS, withPrepCache } from "@/lib/luna/prep-cache";
import {
  classifiedRows,
  classificationPublic,
  emptyClassification,
  formatLibraryBlock,
  formatTypeCatalog,
  formatTypeLabels,
  isLowConfidence,
  loadQuestionTypes,
  matchLibraryItems,
  parseClassificationJson,
  recordUnclassifiedQuestion,
  resolveClassification,
  typesNeedLibrary,
  typesNeedSearch,
  typesSkipClarify,
  type QuestionTypeRow
} from "@/lib/luna/question-types";
import { parseAskedWhat } from "@/lib/luna/ask-what";
import {
  emptyProjectPeek,
  peekProjectFolders,
  searchNasFoldersByName
} from "@/lib/luna/project-peek";
import {
  filterRetrievedByAsked,
  filterWikiByAsked,
  formatNotFoundAnswer,
  isNotFoundAnswerText,
  keepSourcesUsedInAnswer,
  scoreEvidenceMatch
} from "@/lib/luna/search-filter";
import {
  isAnswerScoresVisible,
  recordAutoFailuresFromAnswer,
  recordLunaFailure
} from "@/lib/luna/failures";
import { CORRECTION_RE } from "@/lib/luna/selfstudy";
import {
  formatWikiSectionsBlock,
  matchWikiSections,
  splitWikiSourcesByVisibility,
  wikiSourceUsedInAnswer,
  type WikiSourceRef
} from "@/lib/luna/wiki-match";
import {
  applyListingTypeOverride,
  formatListingNotionChecklist,
  formatListingWikiChecklist,
  listingAnswerRuleWithWikiCount,
  shouldSkipFindConnectors,
  wikiCoversKnowIntent
} from "@/lib/luna/listing-question";
import {
  answerMaxTokensForDepth,
  LLM_INJECT_BY_DEPTH,
  llmInjectLimitsForQuestion,
  shouldOmitTalkAnswer,
  SYNTHESIS_ANSWER_RULE,
  wikiLimitsForDepth,
  type LlmInjectLimits,
  type QuestionDepth
} from "@/lib/luna/question-depth";
import { checkAndNotifyPrivateWikiOveruse } from "@/lib/luna/wiki-private-alert";
import { captureTermMeaningQuestion } from "@/lib/luna/capture-term-question";
import {
  CLARIFY_FOLLOWUP_RULE,
  combineClarifyFollowup,
  conversationHadClarify,
  ensureClarifyFollowupTypes,
  findClarifyRootUser,
  parseClarifyOptions,
  resolveListingQuestion,
  typesNeedWikiLookup
} from "@/lib/luna/clarify-followup";
import {
  applyTypeSearchOverride,
  formatConnectorRoutingSummary,
  hasManualConnectors,
  hasManualSkills,
  resolveConnectorsAuto,
  type ConnectorFlags,
  type ConnectorRoutingResult
} from "@/lib/luna/connector-routing";
import {
  applyListingReferenceFlags,
  applyScopeToConnectorFlags,
  forceSimpleDepthForScope,
  inferRuleClassification,
  listingReferenceDisablesNas,
  resolveSearchScope,
  resolveSearchScopeKind,
  scopeHitsInsufficient,
  scopeReasonLabel,
  scopeSkipsQueryEmbedding,
  widenSearchScope,
  type SearchScope
} from "@/lib/luna/search-scope";
import {
  ensureUiProgressZeros,
  pushUiGlossaryStep,
  pushUiImageStep,
  pushUiLinkStep,
  pushUiNotionStep,
  pushUiReadStep,
  pushUiWebStep,
  pushUiWikiStep,
  pushUiWorkStep,
  queryHintFromQuestion,
  refreshConnectorUiSteps,
  uiChannelsForKind,
  uiProgressCountsFromState
} from "@/lib/luna/chat-progress-ui";
import { progressQueryHint } from "@/lib/luna/progress-display";
import { resolveDepartmentLens } from "@/lib/luna/department-lens";
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
import {
  maxSimilarityByLibrary,
  retrieveKnowledgeEmbeddings
} from "@/lib/luna/embedding-retrieve";
import {
  isSpuriousProjectClarify,
  shouldSkipProjectClarify
} from "@/lib/luna/question-intent";
import {
  createPromptUsageLog,
  recordPromptUse
} from "@/lib/luna/used-prompts";
import {
  CLARIFY_CONCEPT_GUARD,
  KEYWORD_EXTRACT_FALLBACK,
  REQUERY_FALLBACK,
  SELF_EVAL_FALLBACK,
  SYNTHESIS_REASON_FALLBACK,
  TYPE_CLASSIFY_FALLBACK,
  TYPE_FIND_FALLBACK,
  TYPE_KNOW_FALLBACK,
  TYPE_LEARN_FALLBACK,
  TYPE_MAKE_FALLBACK,
  WORKSERVER_STRUCTURE_FALLBACK
} from "@/lib/luna/prompt-fallbacks";

export const runtime = "nodejs";

const SYNTHESIS_OPINION_FALLBACK =
  "- 검색 결과 목록을 답변에 다시 나열하지 마세요. 화면에 이미 카드로 표시됩니다. 당신은 그 자료들을 종합한 판단과 의견만 쓰세요.";

const CLARIFY_FALLBACK =
  "사용자의 질문이 여러 방향으로 갈라질 수 있는지 판단하세요. 확실한 분기가 있을 때만 needs_clarify=true 로 하세요. JSON만 응답: {\"needs_clarify\":true|false,\"question\":\"...\",\"options\":[\"...\",\"...\",\"...\"]}";

const SEARCH_REQUEST_KEYWORDS = ["찾아줘", "레퍼런스", "사례", "검색", "알려줘"] as const;
const SEARCH_BUDGET_MS = 45_000;
const MAX_SEARCH_ROUNDS = 3;

function isSearchRequestMessage(message: string): boolean {
  return SEARCH_REQUEST_KEYWORDS.some((kw) => message.includes(kw));
}

type NasDirectoryRow = WorkserverExploreRow;

type ChatRequestBody = {
  conversation_id?: string;
  message?: string;
  engine?: string;
  skills?: {
    perspective_ids?: unknown;
    role_ids?: unknown;
    task_ids?: unknown;
  };
  connectors?: { notion?: boolean; web?: boolean; nas?: boolean };
  attachment_ids?: string[];
};

type AttachmentRow = {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
};

type MessageRow = {
  id?: string;
  role: string;
  content: string;
  metadata?: Record<string, unknown> | null;
};
type PromptSkillRow = {
  id: string;
  title: string;
  kind: string;
  content: string;
  is_active: boolean;
  sort_order: number | null;
  prompt_key: string | null;
  level: string | null;
};

type StepStatus = "running" | "done" | "skip";
type StepRecord = {
  key: string;
  label: string;
  status: StepStatus;
  ms?: number;
  right?: string;
};
type ModelStep = {
  label: string;
  model: string;
  tier: string;
  tokens?: { input: number; output: number };
};
type SourceReasons = {
  notion?: string;
  nas?: string;
  web?: string;
};

function parseIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
}

function logPromptInject(opts: {
  key: string;
  step: string;
  source: "db" | "fallback";
  text: string;
}) {
  console.log("[luna/prompt] inject", {
    key: opts.key,
    step: opts.step,
    source: opts.source,
    len: opts.text.length,
    head: opts.text.slice(0, 80)
  });
}

function pickLoaded(
  rows: Record<string, LunaLoadedPrompt>,
  key: string,
  fallback: string
): { text: string; row: LunaLoadedPrompt | undefined; source: "db" | "fallback" } {
  const row = rows[key];
  const dbText = row?.content?.trim() ?? "";
  if (dbText) return { text: dbText, row, source: "db" };
  return { text: fallback, row, source: "fallback" };
}

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({
    apiKey,
    defaultHeaders: {
      "anthropic-beta": "prompt-caching-2024-07-31"
    }
  });
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

/** 도구 루프 결과 최종 정리 — exact → ancestor → variant → importance → 6건 */
function finalizeNasDirectoryRows(rows: NasDirectoryRow[]): NasDirectoryRow[] {
  return runWorkserverResultPipeline(rows);
}

function cardDedupeKey(card: LunaCard): string {
  if (card.url) return `url:${card.url}`;
  if (card.type === "nas" || card.type === "image") {
    if (card.raw_path) return `${card.type}:${card.raw_path}`;
    let pathPart = card.description?.split(" · ")[0] || card.title;
    if (pathPart.startsWith("★ ")) pathPart = pathPart.slice(2);
    return `${card.type}:${pathPart}`;
  }
  return `${card.type}:${card.title}`;
}

function mergeCards(existing: LunaCard[], incoming: LunaCard[]): LunaCard[] {
  const map = new Map<string, LunaCard>();
  for (const c of existing) map.set(cardDedupeKey(c), c);
  for (const c of incoming) map.set(cardDedupeKey(c), c);
  return Array.from(map.values());
}

function clipReason(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > 40 ? t.slice(0, 40) : t;
}

function buildSourceReasonUserMessage(
  question: string,
  cards: LunaCard[],
  nasResults: NasDirectoryRow[]
): string | null {
  const notionTitles = cards
    .filter((c) => c.type === "notion")
    .map((c) => c.title)
    .filter(Boolean);
  const webTitles = cards
    .filter((c) => c.type === "web")
    .map((c) => c.title)
    .filter(Boolean);

  const nasLines =
    nasResults.length > 0
      ? nasResults.map((r) => {
          const important = (r.importance ?? 0) > 0;
          return `- ${r.path}${important ? " (importance>0)" : ""}`;
        })
      : cards
          .filter((c) => c.type === "nas")
          .map((c) => {
            let pathPart = c.description?.split(" · ")[0]?.trim() || c.title;
            const important = pathPart.startsWith("★ ");
            if (important) pathPart = pathPart.slice(2);
            return `- ${pathPart}${important ? " (importance>0)" : ""}`;
          });

  if (
    notionTitles.length === 0 &&
    nasLines.length === 0 &&
    webTitles.length === 0
  ) {
    return null;
  }

  const parts = [`질문:\r\n${question}`];
  if (notionTitles.length > 0) {
    parts.push(`노션:\r\n${notionTitles.map((t) => `- ${t}`).join("\r\n")}`);
  }
  if (nasLines.length > 0) {
    parts.push(`Work서버:\r\n${nasLines.join("\r\n")}`);
  }
  if (webTitles.length > 0) {
    parts.push(`웹:\r\n${webTitles.map((t) => `- ${t}`).join("\r\n")}`);
  }
  return parts.join("\r\n\r\n");
}

function formatCardLineForEval(card: LunaCard): string {
  if (card.type === "notion") {
    return `- [노션] ${card.title}`;
  }
  if (card.type === "nas") {
    let pathPart = card.description?.split(" · ")[0]?.trim() || card.title;
    if (pathPart.startsWith("★ ")) pathPart = pathPart.slice(2);
    return `- [Work서버] ${pathPart}`;
  }
  return `- [웹] ${card.title}`;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const tryParse = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
    return null;
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

function buildL3PromptBlock(opts: {
  understand?: string;
  assume?: string;
  typeBlocks?: string[];
  answer?: string;
  /** talk.answer 를 덮는 깊이 규칙 (listing / synthesis) */
  depthRule?: string;
}): string {
  return [
    opts.understand,
    opts.assume,
    ...(opts.typeBlocks ?? []),
    opts.answer,
    opts.depthRule
  ]
    .map((s) => s?.trim() ?? "")
    .filter(Boolean)
    .join("\r\n\r\n");
}

function buildAnswerSystem(
  opts: {
    identity: string;
    learningsBlock?: string;
    glossaryBlock?: string;
    wikiSectionsBlock?: string;
    skillPrompt?: string | null;
    l3Prompt?: string;
    workserverStructure?: string;
    synthesisOpinion?: string;
    notionSources?: NotionSource[];
    cards?: LunaCard[];
    nasResults?: NasDirectoryRow[];
    nasSearchAttempted?: boolean;
    reportContent?: string | null;
    notionSearchAttempted?: boolean;
    notionSearchStatus?: NotionSearchStatus;
    notionSearchRounds?: number;
    webAugmented?: boolean;
    clarifyFollowup?: boolean;
    questionDepth?: QuestionDepth;
    listingQuestion?: boolean;
    listingRule?: string;
    listingChecklist?: string;
    llmInject?: LlmInjectLimits;
    /** 개인 memo — 캐시하면 안 됨 (사람마다 다름) */
    userMemoryBlock?: string | null;
    /** 목록형 사례 — Work구조·NAS·카드 주입 생략 (입력 토큰 폭증 방지) */
    slimListingPrompt?: boolean;
  },
  useCaching: boolean,
  modelId: string
): CachedSystemPayload {
  const identity = opts.identity.trim() || LUNA_DEFAULT_IDENTITY_PROMPT;
  const slim = opts.slimListingPrompt === true;
  const structure = slim
    ? ""
    : opts.workserverStructure?.trim() || WORKSERVER_STRUCTURE_FALLBACK;
  const block1 = [identity, structure].filter(Boolean).join("\r\n\r\n");
  const block2 = [opts.skillPrompt?.trim() ?? "", opts.l3Prompt?.trim() ?? ""]
    .filter(Boolean)
    .join("\r\n\r\n");
  const block3 = [
    slim ? "" : opts.glossaryBlock?.trim() ?? "",
    opts.wikiSectionsBlock?.trim() ?? "",
    opts.learningsBlock?.trim() ?? "",
    `[답변 안전]\r\n${KNOWLEDGE_LIST_HARD_RULE}`
  ]
    .filter(Boolean)
    .join("\r\n\r\n");
  const volatile = buildVolatileSystemText({
    ...opts,
    // 목록형 사례: UI 카드는 meta 로 보내고, LLM 에는 노션만
    cards: slim ? [] : opts.cards,
    nasResults: slim ? [] : opts.nasResults,
    nasSearchAttempted: slim ? false : opts.nasSearchAttempted,
    clarifyFollowup: opts.clarifyFollowup,
    questionDepth: opts.questionDepth,
    listingQuestion: opts.listingQuestion,
    listingRule: opts.listingRule,
    listingChecklist: opts.listingChecklist,
    llmInject: opts.llmInject,
    userMemoryBlock: opts.userMemoryBlock
  });

  const payload = buildCachedSystem(
    [
      { text: block1, cache: true },
      { text: block2, cache: true },
      { text: block3, cache: true },
      { text: volatile, cache: false }
    ],
    { enabled: useCaching, modelId }
  );
  console.log("[luna/cache]", {
    useCaching,
    applied: payload.applied,
    cacheChars: payload.cacheChars,
    slimListing: slim
  });
  return payload;
}

function buildVolatileSystemText(opts: {
  synthesisOpinion?: string;
  notionSources?: NotionSource[];
  cards?: LunaCard[];
  nasResults?: NasDirectoryRow[];
  /** Work서버 검색을 실제로 돌렸는지 (0건 명시 주입 구분용) */
  nasSearchAttempted?: boolean;
  reportContent?: string | null;
  notionSearchAttempted?: boolean;
  notionSearchStatus?: NotionSearchStatus;
  notionSearchRounds?: number;
  webAugmented?: boolean;
  clarifyFollowup?: boolean;
  questionDepth?: QuestionDepth;
  listingQuestion?: boolean;
  listingRule?: string;
  listingChecklist?: string;
  llmInject?: LlmInjectLimits;
  userMemoryBlock?: string | null;
}): string {
  const parts: string[] = [];
  const depth: QuestionDepth = opts.questionDepth ?? "simple";
  const listing = depth === "listing" || Boolean(opts.listingQuestion);
  const synthesis = depth === "synthesis";
  const inject = opts.llmInject ?? {
    notion: PACK_LLM_TOP_N,
    wikiSections: 3,
    wikiPerDoc: 2,
    learnings: 3,
    cards: 3,
    nas: 3
  };

  // 순서: 조직 지식(캐시 block3) → 팀 관점(캐시 block2) → 개인 memo(여기)
  if (opts.userMemoryBlock?.trim()) {
    parts.push(opts.userMemoryBlock.trim());
  }

  if (opts.clarifyFollowup) {
    parts.push(CLARIFY_FOLLOWUP_RULE);
  }

  if (listing && opts.listingRule?.trim()) {
    parts.push(opts.listingRule.trim());
  } else if (synthesis) {
    parts.push(SYNTHESIS_ANSWER_RULE);
  }
  if (listing && opts.listingChecklist?.trim()) {
    parts.push(opts.listingChecklist.trim());
  }

  if (opts.reportContent?.trim()) {
    parts.push(`[이미 정리해둔 자료]\r\n${opts.reportContent.trim()}`);
  }

  parts.push(WORK_STAGE_ANSWER_RULE);

  if (opts.webAugmented) {
    parts.push(
      "[웹 검색 보강]\r\n웹 검색 도구가 있다. '기능이 없다'거나 '접근할 수 없다'고 말하지 않는다.\r\n확정 지식·용어가 있으면 그것을 우선하고, 웹은 일반 정보 보완에만 쓴다."
    );
  }

  if (opts.notionSources && opts.notionSources.length > 0) {
    const forLlm = takeTopNotionSourcesForLlm(
      opts.notionSources,
      inject.notion
    );
    const notionHint = listing
      ? `(위 ${forLlm.length}건 중 조건에 맞는 것만 번호로 나열한다. 임의로 1건만 고르지 마라. 제목·URL을 근거로 쓴다.)`
      : synthesis
        ? `(위 ${forLlm.length}건을 사례로 빠짐없이 다룬다. 2~3개로 줄이지 마라. 각 항목에 페이지 제목을 근거로 단다.)`
        : `(기록된 경로가 있으면 그 경로를 답의 근거로 쓴다. 페이지 제목과 URL도 함께 단다. 화면에는 더 많은 자료가 카드로 보이니 목록을 다시 나열하지 마라.)`;
    parts.push(
      `[노션 검색 결과]\r\n${formatNotionSourcesForPrompt(forLlm, {
        compact: listing || depth === "simple"
      })}\r\n${notionHint}`
    );
  } else if (opts.notionSearchAttempted) {
    if (opts.notionSearchStatus === "error") {
      parts.push("[노션 검색] 호출 실패 — 결과를 확인하지 못함");
    } else if (opts.notionSearchStatus === "empty") {
      const n = opts.notionSearchRounds ?? 0;
      parts.push(`[노션 검색] ${n}회 검색, 결과 0건`);
    }
  }

  if (opts.cards && opts.cards.length > 0) {
    const topCards = opts.cards.slice(0, inject.cards);
    const cardBlock = topCards
      .map((c) =>
        c.url ? `- [${c.type}] ${c.title}: ${c.url}` : `- [${c.type}] ${c.title}: ${c.description}`
      )
      .join("\r\n");
    parts.push(`[검색 레퍼런스]\r\n${cardBlock}`);
  }

  const nasResults = (opts.nasResults ?? []).slice(0, inject.nas);
  const notionPaths = notionRecordedPaths(opts.notionSources ?? []);
  if (nasResults.length > 0) {
    const nasBlock = nasResults
      .map((row) => {
        const name = pathLastSegment(row.path);
        const drive = (row.drive ?? "T").trim().toUpperCase() || "T";
        return `- ${name} → ${drive}:\\${row.path.replace(/\//g, "\\")}`;
      })
      .join("\r\n");
    parts.push(
      "[Work서버 파일 위치]\r\n" +
        (notionPaths.length > 0
          ? "아래는 Work서버 인덱스 검색 결과다. 노션에 기록된 경로가 있으면 그것을 우선한다.\r\n"
          : "아래 경로는 Work서버 인덱스에서 확인된 경로다. 목록에 없는 경로는 추측하지 않는다.\r\n") +
        nasBlock
    );
  } else if (opts.nasSearchAttempted) {
    parts.push(
      notionPaths.length > 0
        ? "[Work서버 파일 위치]\r\n(인덱스 검색 0건 — 노션에 기록된 경로를 우선 사용한다. 찾지 못했다고 단정하지 말 것)"
        : "[Work서버 파일 위치]\r\n(검색 결과 없음 — 노션 페이지가 있으면 그 링크는 제시하고, 경로는 추측하지 말 것)"
    );
  }

  const closing: string[] = [
    buildLocationAnswerRules({
      hasNotionSources: (opts.notionSources?.length ?? 0) > 0,
      hasNotionPaths: notionPaths.length > 0
    })
  ];
  // simple 만 "카드 재나열 금지·의견만" — listing·synthesis 는 사례 나열이 답이다
  if (depth === "simple") {
    closing.push(SYNTHESIS_OPINION_FALLBACK);
    closing.push(
      "- 위치 답변은 카드 목록을 다시 나열하는 것이 아니다. 핵심 경로와 근거 노션 링크를 문장으로 말한다."
    );
  }
  closing.push(
    "- 답변은 아폴론의 과거 프로젝트 맥락과 연결해서 구체적으로 쓰세요."
  );
  parts.push(closing.join("\r\n"));

  return parts.join("\r\n\r\n");
}

function pushModelStep(
  modelSteps: ModelStep[],
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>,
  opts: {
    label: string;
    model: string;
    tier: string;
    model_id: string;
    usage?: LunaUsageTokens;
  }
) {
  const step: ModelStep = {
    label: opts.label,
    model: opts.model,
    tier: opts.tier
  };
  if (opts.usage) {
    step.tokens = {
      input: opts.usage.input_tokens,
      output: opts.usage.output_tokens
    };
    bumpUsageDaily(admin, {
      tier: opts.tier,
      model_id: opts.model_id,
      usage: opts.usage
    });
  }
  modelSteps.push(step);
}

function emit(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: Record<string, unknown>
) {
  controller.enqueue(encoder.encode(JSON.stringify(event) + "\r\n"));
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let loadsDoneAt = startedAt;
  const prepLoads: Array<{
    name: string;
    n: number;
    ms: number;
    hit: boolean;
  }> = [];
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = getAnthropicClient();
  // Anthropic 키는 A등급이 anthropic 이거나 멀티모달 스트림이 필요할 때만 필수.
  // B등급 전처리(lunaLlmComplete)는 OpenAI 등 다른 공급사로도 동작한다.

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const conversationId =
    typeof body.conversation_id === "string" ? body.conversation_id.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  let perspectiveIds = parseIdList(body.skills?.perspective_ids);
  const roleIds = parseIdList(body.skills?.role_ids);
  const taskIds = parseIdList(body.skills?.task_ids);
  const attachmentIds = Array.isArray(body.attachment_ids)
    ? body.attachment_ids
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    : [];
  const hasAttachments = attachmentIds.length > 0;
  let notionEnabled = body.connectors?.notion === true;
  let webEnabled = body.connectors?.web === true;
  let nasEnabled = body.connectors?.nas === true;
  if (!conversationId || (!message && !hasAttachments)) {
    return NextResponse.json(
      { error: "conversation_id and message (or attachments) are required" },
      { status: 400 }
    );
  }

  const usedEngine = "claude";

  const { data: conversation, error: convError } = await admin
    .from("luna_conversations")
    .select("id, user_id, engine")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (convError) {
    console.error("[luna/chat] conversation", convError);
    return NextResponse.json({ error: convError.message }, { status: 500 });
  }
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const routingMessage =
    message || (hasAttachments ? "첨부한 파일을 분석해 주세요." : "");
  const manualConnectorFlags: ConnectorFlags = {
    notion: body.connectors?.notion === true,
    web: body.connectors?.web === true,
    nas: body.connectors?.nas === true
  };

  const wikiLoad = withPrepCache(
    "wiki-lite",
    PREP_TTL_MS.wiki,
    () =>
      loadWikiDocs(admin, {
        activeOnly: true,
        includeHistory: false,
        includeContent: false
      })
  );
  const glossaryLoad = withPrepCache(
    "glossary",
    PREP_TTL_MS.glossary,
    async () => {
      let gq = await admin
        .from("glossary_terms")
        .select("id, term_ko, term_en, synonyms, definition")
        .is("deleted_at", null);
      if (gq.error) {
        gq = await admin
          .from("glossary_terms")
          .select("id, term_ko, term_en, synonyms, definition");
      }
      return {
        data: (gq.data ?? null) as GlossaryMatchRow[] | null,
        error: gq.error
      };
    },
    (row) => !row.error
  );
  const learningsLoad = withPrepCache(
    "learnings",
    PREP_TTL_MS.learnings,
    () =>
      admin
        .from("luna_learnings")
        .select("id, content, category, importance, use_count, created_at")
        .eq("status", "active")
        .neq("category", "identity")
        .order("importance", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200),
    (row) => !row.error
  );
  const typesLoad = withPrepCache("question-types", PREP_TTL_MS.types, () =>
    loadQuestionTypes(admin, { activeOnly: true })
  );
  const promptRowsLoad = withPrepCache(
    "runtime-prompts",
    PREP_TTL_MS.prompts,
    () => getPromptRows(admin, [...LUNA_RUNTIME_PROMPT_KEYS]),
    (rows) => Object.keys(rows).length > 0
  );

  const [profileHit, perspectivesHit, tierAHit, tierBHit] = await Promise.all([
    withPrepCache(
      `profile:${user.id}`,
      PREP_TTL_MS.profile,
      () =>
        admin.from("profiles").select("department").eq("id", user.id).maybeSingle(),
      (row) => !row.error
    ),
    withPrepCache(
      "l2-perspectives",
      PREP_TTL_MS.perspectives,
      () =>
        admin
          .from("luna_prompts")
          .select("id, title, kind, prompt_key")
          .eq("level", "L2")
          .eq("kind", "perspective")
          .eq("is_active", true),
      (row) => !row.error
    ),
    withPrepCache("tier-A", PREP_TTL_MS.tiers, () => getTierModel(admin, "A")),
    withPrepCache("tier-B", PREP_TTL_MS.tiers, () => getTierModel(admin, "B"))
  ]);
  const profileResult = profileHit.value;
  const perspectivesResult = perspectivesHit.value;
  const tierACfg = tierAHit.value;
  const tierBCfg = tierBHit.value;
  prepLoads.push(
    {
      name: "profile",
      n: profileResult.data ? 1 : 0,
      ms: profileHit.ms,
      hit: profileHit.hit
    },
    {
      name: "perspectives",
      n: perspectivesResult.data?.length ?? 0,
      ms: perspectivesHit.ms,
      hit: perspectivesHit.hit
    },
    { name: "tierA", n: 1, ms: tierAHit.ms, hit: tierAHit.hit },
    { name: "tierB", n: 1, ms: tierBHit.ms, hit: tierBHit.hit }
  );

  if (profileResult.error) {
    console.error("[luna/chat] profile", profileResult.error);
  }
  if (perspectivesResult.error) {
    console.error("[luna/chat] perspectives", perspectivesResult.error);
  }

  const profile = profileResult.data;
  const perspectives = (perspectivesResult.data ?? []) as Array<{
    id: string;
    title: string;
    kind: string;
    prompt_key: string | null;
  }>;

  const manualSkillIds = {
    perspective_ids: perspectiveIds,
    role_ids: roleIds,
    task_ids: taskIds
  };

  if (!hasManualSkills(manualSkillIds)) {
    const lensHit = await withPrepCache(
      `lens:${(profile?.department ?? "").trim()}`,
      PREP_TTL_MS.lens,
      () => resolveDepartmentLens(admin, profile?.department)
    );
    const resolved = lensHit.value;
    prepLoads.push({
      name: "lens",
      n: resolved.found ? 1 : 0,
      ms: lensHit.ms,
      hit: lensHit.hit
    });
    if (!resolved.found) {
      console.log("[luna/lens] no mapping", {
        department: resolved.department || "(empty)",
        source: resolved.source
      });
    } else if (!resolved.lensPromptKey) {
      console.log("[luna/lens] mapped none", {
        department: resolved.department,
        source: resolved.source
      });
    } else {
      const matched = perspectives.find(
        (p) => p.prompt_key === resolved.lensPromptKey
      );
      if (matched) {
        perspectiveIds = [matched.id];
        console.log("[luna/lens] auto", {
          department: resolved.department,
          key: resolved.lensPromptKey,
          id: matched.id,
          title: matched.title,
          source: resolved.source
        });
      } else {
        console.log("[luna/lens] mapped key missing", {
          department: resolved.department,
          key: resolved.lensPromptKey,
          source: resolved.source
        });
      }
    }
  }

  let connectorRouting: ConnectorRoutingResult | null = null;
  if (!hasManualConnectors(manualConnectorFlags)) {
    connectorRouting = resolveConnectorsAuto(routingMessage, {
      hasAttachments,
      manual: manualConnectorFlags
    });
    notionEnabled = connectorRouting.connectors.notion;
    webEnabled = connectorRouting.connectors.web;
    nasEnabled = connectorRouting.connectors.nas;
    console.log(
      "[luna/route] connectors =",
      { nas: nasEnabled, notion: notionEnabled, web: webEnabled },
      "· reason =",
      connectorRouting.reasonLabel
    );
  } else if (hasAttachments) {
    notionEnabled = false;
    webEnabled = false;
    nasEnabled = false;
  }

  const autoRoutingUsed =
    !hasManualConnectors(manualConnectorFlags) ||
    !hasManualSkills(manualSkillIds);

  const skillIds = Array.from(
    new Set([...perspectiveIds, ...roleIds, ...taskIds])
  );
  const tierAResolved = resolveProviderModel(tierACfg);
  const tierBResolved = resolveProviderModel(tierBCfg);
  const tierA = {
    model_id: tierAResolved.model_id,
    model_label: tierAResolved.model_label || tierACfg.model_label
  };
  const tierB = {
    model_id: tierBResolved.model_id,
    model_label: tierBResolved.model_label || tierBCfg.model_label
  };

  const promptRowsHit = await promptRowsLoad;
  prepLoads.push({
    name: "prompts",
    n: Object.keys(promptRowsHit.value).length,
    ms: promptRowsHit.ms,
    hit: promptRowsHit.hit
  });
  const promptRows = promptRowsHit.value;
  const usageLog = createPromptUsageLog();

  const identityPick = pickLoaded(
    promptRows,
    LUNA_PROMPT_KEYS.identity,
    LUNA_DEFAULT_IDENTITY_PROMPT
  );
  const identity = identityPick.text;
  const understandPick = pickLoaded(
    promptRows,
    LUNA_PROMPT_KEYS.understand,
    CLARIFY_FALLBACK
  );
  const assumePick = pickLoaded(promptRows, LUNA_PROMPT_KEYS.assume, "");
  const findPick = pickLoaded(
    promptRows,
    LUNA_PROMPT_KEYS.find,
    TYPE_FIND_FALLBACK
  );
  const classifyPick = pickLoaded(
    promptRows,
    LUNA_PROMPT_KEYS.classify,
    TYPE_CLASSIFY_FALLBACK
  );
  const knowPick = pickLoaded(promptRows, LUNA_PROMPT_KEYS.know, TYPE_KNOW_FALLBACK);
  const makePick = pickLoaded(promptRows, LUNA_PROMPT_KEYS.make, TYPE_MAKE_FALLBACK);
  const learnTypePick = pickLoaded(
    promptRows,
    LUNA_PROMPT_KEYS.learn,
    TYPE_LEARN_FALLBACK
  );
  const answerPick = pickLoaded(promptRows, LUNA_PROMPT_KEYS.answer, "");
  const keywordPick = pickLoaded(
    promptRows,
    LUNA_PROMPT_KEYS.keywordExtract,
    KEYWORD_EXTRACT_FALLBACK
  );
  const requeryPick = pickLoaded(
    promptRows,
    LUNA_PROMPT_KEYS.requery,
    REQUERY_FALLBACK
  );
  const selfEvalPick = pickLoaded(
    promptRows,
    LUNA_PROMPT_KEYS.selfEval,
    SELF_EVAL_FALLBACK
  );
  const synthesisPick = pickLoaded(
    promptRows,
    LUNA_PROMPT_KEYS.synthesis,
    SYNTHESIS_REASON_FALLBACK
  );
  const guardPick = pickLoaded(
    promptRows,
    LUNA_PROMPT_KEYS.clarifyGuard,
    CLARIFY_CONCEPT_GUARD
  );
  const structurePick = pickLoaded(
    promptRows,
    LUNA_PROMPT_KEYS.workserverStructure,
    WORKSERVER_STRUCTURE_FALLBACK
  );

  const keywordExtractPrompt = keywordPick.text;
  const selfEvalPrompt = selfEvalPick.text;
  const requeryPrompt = requeryPick.text;
  const synthesisReason = synthesisPick.text;
  const typeFindPrompt = findPick.text;
  const workserverStructure = structurePick.text;
  const talkAssume = assumePick.text;
  const talkAnswer = answerPick.text;
  const clarifyPrompt = [understandPick.text, guardPick.text]
    .filter(Boolean)
    .join("\r\n\r\n");
  const webSearchHint = "";

  const typePromptByKey: Record<
    string,
    { text: string; row: LunaLoadedPrompt | undefined; source: "db" | "fallback"; title: string }
  > = {
    [LUNA_PROMPT_KEYS.find]: {
      text: findPick.text,
      row: findPick.row,
      source: findPick.source,
      title: "FIND 자료 찾기"
    },
    [LUNA_PROMPT_KEYS.know]: {
      text: knowPick.text,
      row: knowPick.row,
      source: knowPick.source,
      title: "KNOW 답변"
    },
    [LUNA_PROMPT_KEYS.make]: {
      text: makePick.text,
      row: makePick.row,
      source: makePick.source,
      title: "MAKE 답변"
    },
    [LUNA_PROMPT_KEYS.learn]: {
      text: learnTypePick.text,
      row: learnTypePick.row,
      source: learnTypePick.source,
      title: "LEARN 답변"
    }
  };

  // 위키·용어·배움·유형은 위에서 이미 띄워 둠. 여기서는 사용자별 조회와 같이 기다린다.
  const [
    typesHit,
    wikiHit,
    learningsHit,
    userMemory,
    glossaryHit,
    webAugmentHit,
    skillDataResult,
    recentResult,
    attachmentsResult
  ] = await Promise.all([
    typesLoad,
    wikiLoad,
    learningsLoad,
    (async () => {
      const t0 = Date.now();
      const mem = await getUserMemory(admin, user.id);
      prepLoads.push({
        name: "memo",
        n: mem?.memo?.length ?? 0,
        ms: Date.now() - t0,
        hit: false
      });
      return mem;
    })(),
    glossaryLoad,
    withPrepCache(
      "web-augment",
      PREP_TTL_MS.web,
      () =>
        admin
          .from("luna_settings")
          .select("value")
          .eq("key", WEB_AUGMENT_SETTINGS_KEY)
          .maybeSingle(),
      (row) => !row.error
    ),
    (async () => {
      const t0 = Date.now();
      const res =
        skillIds.length > 0
          ? await admin
              .from("luna_prompts")
              .select(
                "id, title, kind, content, is_active, sort_order, prompt_key, level"
              )
              .in("id", skillIds)
              .eq("level", "L2")
          : { data: [] as PromptSkillRow[], error: null };
      prepLoads.push({
        name: "skills",
        n: res.data?.length ?? 0,
        ms: Date.now() - t0,
        hit: false
      });
      return res;
    })(),
    (async () => {
      const t0 = Date.now();
      const res = await admin
        .from("luna_messages")
        .select("id, role, content, metadata")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(20);
      prepLoads.push({
        name: "recent",
        n: res.data?.length ?? 0,
        ms: Date.now() - t0,
        hit: false
      });
      return res;
    })(),
    hasAttachments
      ? admin
          .from("luna_attachments")
          .select("id, storage_path, file_name, mime_type")
          .eq("user_id", user.id)
          .in("id", attachmentIds)
      : Promise.resolve({ data: [] as AttachmentRow[], error: null })
  ]);
  const questionTypes = typesHit.value.types;
  const wikiLoaded = wikiHit.value;
  const learningsResult = learningsHit.value;
  const glossaryResult = glossaryHit.value;
  const webAugmentRowResult = webAugmentHit.value;
  loadsDoneAt = Date.now();
  prepLoads.push(
    {
      name: "wiki",
      n: wikiLoaded.items.length,
      ms: wikiHit.ms,
      hit: wikiHit.hit
    },
    {
      name: "glossary",
      n: glossaryResult.data?.length ?? 0,
      ms: glossaryHit.ms,
      hit: glossaryHit.hit
    },
    {
      name: "learnings",
      n: learningsResult.data?.length ?? 0,
      ms: learningsHit.ms,
      hit: learningsHit.hit
    },
    {
      name: "types",
      n: questionTypes.length,
      ms: typesHit.ms,
      hit: typesHit.hit
    },
    {
      name: "web",
      n: webAugmentRowResult.data ? 1 : 0,
      ms: webAugmentHit.ms,
      hit: webAugmentHit.hit
    }
  );
  const wikiDocs = wikiLoaded.items;
  const libraryItems = wikiDocs
    .filter((d) => d.menu_slug !== "rules")
    .map((d) => ({
      id: d.id ?? null,
      slug: d.slug,
      title: d.title,
      kind: d.kind,
      content: d.content
    }));

  if (learningsResult.error) {
    console.error("[luna/chat] learnings", learningsResult.error);
    return NextResponse.json(
      { error: learningsResult.error.message },
      { status: 500 }
    );
  }
  const learningsRowsAll = (learningsResult.data ?? []) as LearningMatchRow[];

  const userMemoryBlock = formatUserMemoryBlock(userMemory, {
    question: message,
    maxChars: 500
  });

  let glossaryRows: GlossaryMatchRow[] = [];
  if (glossaryResult.error) {
    console.error("[luna/chat] glossary", glossaryResult.error);
  } else {
    glossaryRows = glossaryResult.data ?? [];
  }

  const webAugmentEnabled = parseWebAugmentEnabled(
    webAugmentRowResult.data?.value
  );

  let skillPrompt: string | null = null;
  const l2SkillRows: Array<{
    title: string;
    level: LunaPromptLevel;
    sort_order: number;
    kind: LunaPromptKind;
    prompt_key: string | null;
  }> = [];
  if (skillIds.length > 0) {
    if (skillDataResult.error) {
      console.error("[luna/chat] prompts skills", skillDataResult.error);
      return NextResponse.json(
        { error: skillDataResult.error.message },
        { status: 500 }
      );
    }
    const byId = new Map(
      ((skillDataResult.data ?? []) as PromptSkillRow[])
        .filter((s) => s.is_active)
        .map((s) => [s.id, s])
    );
    const blocks: string[] = [];
    for (const id of perspectiveIds) {
      const row = byId.get(id);
      if (!row || row.kind !== "perspective") continue;
      blocks.push(`[관점 · ${row.title}]\r\n${row.content}`);
      l2SkillRows.push({
        title: row.title,
        level: "L2",
        sort_order: row.sort_order ?? 0,
        kind: row.kind as LunaPromptKind,
        prompt_key: row.prompt_key
      });
    }
    for (const id of roleIds) {
      const row = byId.get(id);
      if (!row || row.kind !== "role") continue;
      blocks.push(`[역할 · ${row.title}]\r\n${row.content}`);
      l2SkillRows.push({
        title: row.title,
        level: "L2",
        sort_order: row.sort_order ?? 0,
        kind: row.kind as LunaPromptKind,
        prompt_key: row.prompt_key
      });
    }
    for (const id of taskIds) {
      const row = byId.get(id);
      if (!row || row.kind !== "task") continue;
      blocks.push(`[작업 · ${row.title}]\r\n${row.content}`);
      l2SkillRows.push({
        title: row.title,
        level: "L2",
        sort_order: row.sort_order ?? 0,
        kind: row.kind as LunaPromptKind,
        prompt_key: row.prompt_key
      });
    }
    skillPrompt = blocks.length > 0 ? blocks.join("\r\n\r\n") : null;
  }

  let attachments: AttachmentRow[] = [];
  if (hasAttachments) {
    if (attachmentsResult.error) {
      console.error("[luna/chat] attachments", attachmentsResult.error);
      return NextResponse.json(
        { error: attachmentsResult.error.message },
        { status: 500 }
      );
    }
    attachments = (attachmentsResult.data ?? []) as AttachmentRow[];
    if (attachments.length === 0) {
      return NextResponse.json({ error: "Attachments not found" }, { status: 404 });
    }
  }

  if (recentResult.error) {
    console.error("[luna/chat] messages", recentResult.error);
    return NextResponse.json(
      { error: recentResult.error.message },
      { status: 500 }
    );
  }
  const recentData = recentResult.data;
  const recent = ((recentData ?? []) as MessageRow[]).reverse();
  const lastAssistant = [...recent].reverse().find((m) => m.role === "assistant");
  const lastHadClarify = Boolean(
    lastAssistant?.metadata &&
      typeof lastAssistant.metadata === "object" &&
      lastAssistant.metadata.clarify
  );
  const clarifyRootUser = lastHadClarify ? findClarifyRootUser(recent) : null;
  const clarifyOptions = lastHadClarify
    ? parseClarifyOptions(lastAssistant?.metadata)
    : [];

  const userText =
    message || (hasAttachments ? "첨부한 파일을 분석해 주세요." : "");
  const knowledgeDumpRequested = isKnowledgeDumpRequest(userText);
  const clarifyFollowupQuery = lastHadClarify
    ? combineClarifyFollowup(clarifyRootUser, userText, clarifyOptions) ??
      (clarifyRootUser
        ? `${clarifyRootUser}\r\n조건: ${userText.trim()}`
        : null)
    : null;
  const searchIntentText = clarifyFollowupQuery || userText;
  const listingCtx = resolveListingQuestion(recent, searchIntentText);
  const listingQuestion = listingCtx.listing;
  const listingSourceText = listingCtx.rootText;
  const depthText = listingSourceText || searchIntentText;
  const imagePrimary =
    hasImageSearchIntent(depthText) ||
    resolveSearchScopeKind({
      types: [],
      question: depthText
    }) === "reference";
  let { depth: questionDepth, limits: llmInject } = llmInjectLimitsForQuestion(
    depthText,
    { imagePrimary }
  );
  console.log("[luna/inject]", {
    depth: questionDepth,
    imagePrimary,
    notion: llmInject.notion,
    wiki: llmInject.wikiSections,
    learnings: llmInject.learnings
  });
  const attachmentMeta = attachments.map((a) => ({
    id: a.id,
    file_name: a.file_name,
    mime_type: a.mime_type
  }));

  if (CORRECTION_RE.test(userText) && lastAssistant?.id) {
    const asstIdx = recent.findIndex((m) => m.id === lastAssistant.id);
    let priorQuestion = "";
    for (let i = asstIdx - 1; i >= 0; i -= 1) {
      const row = recent[i];
      if (row?.role === "user") {
        priorQuestion = row.content;
        break;
      }
    }
    void recordLunaFailure(admin, {
      messageId: lastAssistant.id,
      conversationId,
      askedBy: user.id,
      question: priorQuestion,
      answerExcerpt: lastAssistant.content,
      kind: "human",
      signal: "correction"
    }).catch((err) => console.error("[luna/chat] correction failure", err));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const steps: StepRecord[] = [];
      const modelSteps: ModelStep[] = [];
      let searchRounds = 0;

      const stepStartedAt = new Map<string, number>();
      /** meta 이후에는 step JSON 을 본문 스트림에 넣지 않는다 */
      let streamMetaEmitted = false;
      const pushStep = (
        key: string,
        status: StepStatus,
        label: string,
        opts?: { silent?: boolean; right?: string }
      ) => {
        const now = Date.now();
        if (status === "running") stepStartedAt.set(key, now);
        const started = stepStartedAt.get(key);
        const ms =
          status === "done" && started != null ? now - started : undefined;
        const idx = steps.findIndex((s) => s.key === key);
        const rec: StepRecord = {
          key,
          status,
          label,
          ...(typeof ms === "number" ? { ms } : {}),
          ...(opts?.right ? { right: opts.right } : {})
        };
        if (idx >= 0) steps[idx] = rec;
        else steps.push(rec);
        if (opts?.silent || streamMetaEmitted) return;
        emit(controller, encoder, {
          type: "step",
          key,
          status,
          label,
          ...(typeof ms === "number" ? { ms } : {}),
          ...(opts?.right ? { right: opts.right } : {})
        });
      };

      const touchConversation = async () => {
        const { error: updateError } = await admin
          .from("luna_conversations")
          .update({
            updated_at: new Date().toISOString(),
            engine: usedEngine
          })
          .eq("id", conversationId)
          .eq("user_id", user.id);
        if (updateError) {
          console.error("[luna/chat] update conversation", updateError);
        }
      };

      try {
        const userMessageId = crypto.randomUUID();
        const assistantMessageId = crypto.randomUUID();
        emit(controller, encoder, {
          type: "ids",
          user_message_id: userMessageId,
          assistant_message_id: assistantMessageId
        });

        if (perspectiveIds.length + roleIds.length >= 2) {
          await runAnalysisPipeline({
            controller,
            encoder,
            admin,
            startedAt,
            conversationId,
            userId: user.id,
            userText,
            usedEngine,
            identity,
            keywordExtractPrompt,
            selfEvalPrompt,
            requeryPrompt,
            tierA,
            tierAProvider: tierAResolved.provider,
            tierB,
            perspectiveIds,
            roleIds,
            taskIds,
            notionEnabled,
            webEnabled,
            nasEnabled,
            hasAttachments,
            attachments,
            attachmentMeta,
            userMessageId,
            assistantMessageId
          });
          return;
        }

        // 지식 대량 인출 요청 — 나열 대신 범위 되묻기 (코드 가드)
        if (knowledgeDumpRequested) {
          pushStep("clarify", "done", "의도 확인");
          const dumpNow = Date.now();
          controller.enqueue(encoder.encode(KNOWLEDGE_DUMP_CLARIFY));
          await admin.from("luna_messages").insert([
            {
              id: userMessageId,
              conversation_id: conversationId,
              role: "user",
              content: userText,
              engine: usedEngine,
              metadata: {},
              created_at: new Date(dumpNow - 1000).toISOString()
            },
            {
              id: assistantMessageId,
              conversation_id: conversationId,
              role: "assistant",
              content: KNOWLEDGE_DUMP_CLARIFY,
              engine: usedEngine,
              metadata: {
                knowledge_dump_blocked: true,
                model_label: tierB.model_label,
                duration_ms: Date.now() - startedAt,
                steps
              },
              created_at: new Date(dumpNow).toISOString()
            }
          ]);
          await touchConversation();
          scheduleConversationTitle(admin, conversationId);
          controller.close();
          return;
        }

        // ——— 단계 0: 유형 판정 (임베딩은 범위 확정 후 — 용어·규정은 생략) ———
        let classification = emptyClassification();
        let classifiedTypeRows: QuestionTypeRow[] = [];
        let classifySource: "rule" | "llm" = "llm";
        pushStep("classify", "running", "유형 판정 중");

        let knowledgeEmbPromise: Promise<
          Awaited<ReturnType<typeof retrieveKnowledgeEmbeddings>>
        > = Promise.resolve({
          queryEmbedding: null,
          wiki: [],
          glossary: [],
          learning: [],
          embed_ms: 0
        });
        let speculativeNotionPromise: Promise<NotionSearchOutcome> =
          Promise.resolve({
            status: "skipped",
            sources: [],
            queries: [],
            rounds: 0
          });
        let speculativeNasPromise: Promise<WorkserverExploreRow[]> =
          Promise.resolve([]);

        const ruleInfer = inferRuleClassification(searchIntentText);
        if (ruleInfer) {
          classifySource = "rule";
          classification = {
            types: ruleInfer.types,
            reason: ruleInfer.reason,
            confidence: 0.95,
            switched: false,
            switch_reason: null
          };
          console.log("[luna/classify] rule-skip", {
            types: classification.types,
            reason: classification.reason,
            kind: ruleInfer.kind
          });
          pushStep("classify", "done", ruleInfer.reason);
        } else {
          try {
            const classifyRes = await lunaLlmComplete(admin, {
              tier: "C",
              feature: "understand",
              system: `${classifyPick.text}\r\n\r\n[유형 목록]\r\n${formatTypeCatalog(questionTypes)}`,
              user: searchIntentText,
              maxTokens: 256
            });
            recordPromptUse(usageLog, {
              key: LUNA_PROMPT_KEYS.classify,
              step: "유형 판정",
              title: "유형 판정",
              row: classifyPick.row
            });
            logPromptInject({
              key: LUNA_PROMPT_KEYS.classify,
              step: "유형 판정",
              source: classifyPick.source,
              text: classifyPick.text
            });
            pushModelStep(modelSteps, admin, {
              label: "유형 판정",
              model: classifyRes.model_label,
              tier: "C",
              model_id: classifyRes.model_id,
              usage: classifyRes.usage
            });
            const parsed = parseClassificationJson(classifyRes.text);
            classification = resolveClassification(parsed, questionTypes, {
              forceSearch: hasManualConnectors(manualConnectorFlags)
            });
            console.log("[luna/classify]", {
              types: classification.types,
              reason: classification.reason,
              confidence: classification.confidence,
              switched: classification.switched,
              clarify_followup: Boolean(clarifyFollowupQuery)
            });
          } catch (err) {
            console.error("[luna/chat] classify", err);
            classification = emptyClassification();
          }
        }
        if (lastHadClarify && clarifyRootUser) {
          const forced = ensureClarifyFollowupTypes(
            classification.types,
            clarifyRootUser
          );
          if (forced.switched) {
            classification = {
              ...classification,
              types: forced.types,
              switched: true,
              switch_reason:
                classification.switch_reason ||
                "되묻기 답을 원래 질문에 이어 다시 검색"
            };
          }
        }
        const listingOverride = applyListingTypeOverride(
          classification.types,
          listingSourceText,
          listingQuestion
        );
        if (listingOverride.switched) {
          classification = {
            ...classification,
            types: listingOverride.types,
            switched: true,
            switch_reason:
              classification.switch_reason || "목록형 질문: 알기 우선"
          };
        }
        classifiedTypeRows = classifiedRows(questionTypes, classification.types);
        if (isLowConfidence(classification)) {
          void recordUnclassifiedQuestion(admin, {
            question: searchIntentText,
            classification,
            conversationId
          });
        }
        pushStep(
          "classify",
          "done",
          formatTypeLabels(classifiedTypeRows) || "유형 미정"
        );

        const needsSearch = typesNeedSearch(classifiedTypeRows);
        if (!hasManualConnectors(manualConnectorFlags)) {
          connectorRouting = applyTypeSearchOverride(connectorRouting, {
            needsSearch,
            manual: false,
            message: routingMessage,
            hasAttachments
          });
          notionEnabled = connectorRouting.connectors.notion;
          webEnabled = connectorRouting.connectors.web;
          nasEnabled = connectorRouting.connectors.nas;
        }

        let searchScope: SearchScope = resolveSearchScope({
          types: classification.types,
          question: searchIntentText,
          classifyConfidence: classification.confidence
        });
        searchScope = applyListingReferenceFlags(searchScope, listingQuestion);
        if (!hasManualConnectors(manualConnectorFlags)) {
          const scoped = applyScopeToConnectorFlags(
            searchScope.flags,
            { notion: notionEnabled, web: webEnabled, nas: nasEnabled },
            false
          );
          notionEnabled = scoped.notion;
          webEnabled = scoped.web;
          nasEnabled = scoped.nas;
          if (listingReferenceDisablesNas(searchScope.kind, listingQuestion)) {
            nasEnabled = false;
          }
          connectorRouting = {
            connectors: {
              nas: nasEnabled,
              notion: notionEnabled,
              web: webEnabled
            },
            reason: "search_scope",
            reasonLabel: scopeReasonLabel(searchScope)
          };
        }
        console.log("[luna/search-scope]", {
          kind: searchScope.kind,
          tier: searchScope.tier,
          flags: searchScope.flags,
          listing: listingQuestion,
          nasEnabled,
          types: classification.types
        });
        const askedWhat = parseAskedWhat(searchIntentText);
        let projectPeek = emptyProjectPeek();
        if (askedWhat.projectPhrases.length > 0) {
          projectPeek = await peekProjectFolders(admin, askedWhat);
        }
        const namedProjectLock = askedWhat.projectPhrases.length > 0;
        let evidenceCounts = { retrieved: 0, matching: 0 };
        let notFoundFromAsk = false;
        if (
          namedProjectLock &&
          projectPeek.clarify &&
          !lastHadClarify &&
          !hasAttachments &&
          !hasManualSkills(manualSkillIds)
        ) {
          const peekQuestion = projectPeek.clarify.question;
          const peekOptions = projectPeek.clarify.options;
          pushStep("clarify", "done", "폴더 확인");
          emit(controller, encoder, {
            type: "clarify",
            question: peekQuestion,
            options: peekOptions
          });
          const peekNow = Date.now();
          const peekUserMeta: Record<string, unknown> = {};
          if (attachmentMeta.length > 0) peekUserMeta.attachments = attachmentMeta;
          await admin.from("luna_messages").insert([
            {
              id: userMessageId,
              conversation_id: conversationId,
              role: "user",
              content: userText,
              engine: usedEngine,
              metadata: peekUserMeta,
              created_at: new Date(peekNow - 1000).toISOString()
            },
            {
              id: assistantMessageId,
              conversation_id: conversationId,
              role: "assistant",
              content: peekQuestion,
              engine: usedEngine,
              metadata: {
                clarify: { question: peekQuestion, options: peekOptions },
                steps,
                model_steps: modelSteps,
                model_label: tierB.model_label,
                duration_ms: Date.now() - startedAt,
                used_prompts: usageLog.all(),
                classification: classificationPublic(
                  classification,
                  questionTypes
                )
              },
              created_at: new Date(peekNow).toISOString()
            }
          ]);
          await touchConversation();
          scheduleConversationTitle(admin, conversationId);
          controller.close();
          return;
        }
        const uiQueryHint = queryHintFromQuestion(searchIntentText);
        pushUiReadStep(pushStep, searchScope.label);

        if (
          forceSimpleDepthForScope(searchScope.kind) &&
          questionDepth !== "simple"
        ) {
          questionDepth = "simple";
          llmInject = LLM_INJECT_BY_DEPTH.simple;
          console.log("[luna/inject] scope-force-simple", {
            kind: searchScope.kind,
            notion: llmInject.notion
          });
        }

        // 용어·규정은 키워드만 — 질문 임베딩·RPC 생략
        if (!scopeSkipsQueryEmbedding(searchScope.kind)) {
          knowledgeEmbPromise = retrieveKnowledgeEmbeddings(
            admin,
            searchIntentText
          );
        }

        // 범위가 허용할 때만 색인 선조회 (용어·규정은 스킵)
        if (searchScope.flags.notion) {
          speculativeNotionPromise = knowledgeEmbPromise.then((emb) =>
            searchNotionForLuna(
              admin,
              searchIntentText.slice(0, 80),
              searchIntentText,
              {
                queryEmbedding: emb.queryEmbedding,
                skipLive: listingQuestion,
                listing: listingQuestion
              }
            )
          );
        }
        if (searchScope.flags.nas) {
          speculativeNasPromise = exploreWorkserverFallback(
            admin,
            searchIntentText.slice(0, 80),
            searchIntentText
          ).catch((err) => {
            console.error("[luna/search] speculative nas", err);
            return [] as WorkserverExploreRow[];
          });
        }

        if (
          listingQuestion &&
          !hasManualConnectors(manualConnectorFlags) &&
          (searchScope.kind === "wide" ||
            searchScope.kind === "project" ||
            searchScope.kind === "find_wide" ||
            searchScope.kind === "reference")
        ) {
          // 목록형: 웹만 끈다. 범위가 허용한 색인·Work는 유지.
          webEnabled = false;
          connectorRouting = {
            connectors: {
              nas: nasEnabled,
              notion: notionEnabled,
              web: false
            },
            reason: "wiki_covers_know",
            reasonLabel: "목록형: 색인·위키로 답 (실시간 검색 생략)"
          };
        }

        const knowledgeEmb = await knowledgeEmbPromise;
        let speculativeNotion: NotionSearchOutcome = {
          status: "skipped",
          sources: [],
          queries: [],
          rounds: 0
        };
        let speculativeNas: WorkserverExploreRow[] = [];
        let preMediaProbe = {
          hits: [] as Awaited<ReturnType<typeof searchMediaForLuna>>["hits"],
          cards: [] as LunaCard[]
        };
        const imageIntentEarly =
          searchScope.flags.media && hasImageSearchIntent(searchIntentText);
        // 노션 선조회와 미디어를 병렬 — 직렬이면 사례 질문에 수 초가 더 붙는다
        const preMediaPromise =
          imageIntentEarly
            ? knowledgeEmbPromise.then((emb) =>
                searchMediaForLuna(
                  admin,
                  emb.queryEmbedding,
                  searchIntentText,
                  { asked: askedWhat }
                )
              )
            : Promise.resolve(preMediaProbe);
        {
          const [notionSpec, nasSpec, mediaSpec] = await Promise.all([
            speculativeNotionPromise,
            speculativeNasPromise,
            preMediaPromise
          ]);
          speculativeNotion = notionSpec;
          speculativeNas = nasSpec;
          preMediaProbe = mediaSpec;
          console.log("[luna/search] speculative notion", {
            status: speculativeNotion.status,
            count: speculativeNotion.sources.length,
            maxSim: maxNotionSimilarity(speculativeNotion.sources),
            listing: listingQuestion,
            scope: searchScope.kind
          });
          console.log("[luna/search] speculative nas", {
            count: speculativeNas.length,
            scope: searchScope.kind
          });
          if (imageIntentEarly) {
            console.log("[luna/media-index] pre-clarify", {
              query: searchIntentText.slice(0, 80),
              hits: preMediaProbe.hits.length,
              topSim: preMediaProbe.hits[0]?.similarity ?? null
            });
          }
        }

        const libraryHits = typesNeedLibrary(classifiedTypeRows)
          ? matchLibraryItems(
              libraryItems,
              searchIntentText,
              maxSimilarityByLibrary(knowledgeEmb.wiki)
            )
          : [];

        const imageIntent = imageIntentEarly;

        // ——— 단계 1: 되묻기 ———
        const skipClarify =
          hasAttachments ||
          lastHadClarify ||
          conversationHadClarify(recent) ||
          hasManualSkills(manualSkillIds) ||
          shouldSkipProjectClarify(userText) ||
          typesSkipClarify(classifiedTypeRows) ||
          forceSimpleDepthForScope(searchScope.kind) ||
          (!namedProjectLock && searchScope.kind === "reference") ||
          (namedProjectLock && !projectPeek.clarify);

        if (
          typesNeedLibrary(classifiedTypeRows) &&
          libraryHits.length === 0 &&
          !lastHadClarify &&
          !hasAttachments
        ) {
          pushStep("clarify", "done", "양식 확인");
          const makeQuestion = "어떤 양식으로 만들까요?";
          const makeOptions =
            libraryItems.length > 0
              ? [
                  ...libraryItems.slice(0, 3).map((i) => i.title),
                  "기타 — 직접 입력"
                ]
              : ["기존 양식을 알려 주기", "초안만 잡아 주기", "기타 — 직접 입력"];
          emit(controller, encoder, {
            type: "clarify",
            question: makeQuestion,
            options: makeOptions
          });
          const makeNow = Date.now();
          await admin.from("luna_messages").insert([
            {
              id: userMessageId,
              conversation_id: conversationId,
              role: "user",
              content: userText,
              engine: usedEngine,
              metadata: {},
              created_at: new Date(makeNow - 1000).toISOString()
            },
            {
              id: assistantMessageId,
              conversation_id: conversationId,
              role: "assistant",
              content: makeQuestion,
              engine: usedEngine,
              metadata: {
                clarify: { question: makeQuestion, options: makeOptions },
                steps,
                model_steps: modelSteps,
                model_label: tierB.model_label,
                duration_ms: Date.now() - startedAt,
                used_prompts: usageLog.all(),
                classification: classificationPublic(
                  classification,
                  questionTypes
                )
              },
              created_at: new Date(makeNow).toISOString()
            }
          ]);
          await touchConversation();
          scheduleConversationTitle(admin, conversationId);
          controller.close();
          return;
        }

        if (skipClarify) {
          pushStep("clarify", "skip", "의도 확인");
        } else {
          pushStep("clarify", "running", "의도 확인 중");
          let needsClarify = false;
          let clarifyQuestion = "";
          let clarifyOptions: string[] = [];
          try {
            const clarifyRes = await lunaLlmComplete(admin, {
              tier: "B",
              feature: "understand",
              system: clarifyPrompt,
              user: userText,
              maxTokens: 512
            });
            recordPromptUse(usageLog, {
              key: LUNA_PROMPT_KEYS.understand,
              step: "되묻기 판단",
              title: "질문 이해와 되묻기",
              row: understandPick.row
            });
            recordPromptUse(usageLog, {
              key: LUNA_PROMPT_KEYS.clarifyGuard,
              step: "되묻기 판단",
              title: "되묻기 개념 가드",
              row: guardPick.row
            });
            logPromptInject({
              key: LUNA_PROMPT_KEYS.understand,
              step: "되묻기 판단",
              source: understandPick.source,
              text: understandPick.text
            });
            logPromptInject({
              key: LUNA_PROMPT_KEYS.clarifyGuard,
              step: "되묻기 판단",
              source: guardPick.source,
              text: guardPick.text
            });
            pushModelStep(modelSteps, admin, {
              label: "되묻기 판단",
              model: clarifyRes.model_label,
              tier: "B",
              model_id: clarifyRes.model_id,
              usage: clarifyRes.usage
            });
            const raw = clarifyRes.text.trim();
            const parsed = parseJsonObject(raw);
            if (parsed) {
              needsClarify = parsed?.needs_clarify === true;
              clarifyQuestion =
                typeof parsed?.question === "string" ? parsed.question.trim() : "";
              clarifyOptions = Array.isArray(parsed?.options)
                ? parsed!.options
                    .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
                    .map((o) => o.trim())
                    .slice(0, 5)
                : [];
            } else {
              // talk.understand 번호 목록 형식 폴백
              const numbered = parseNumberedChoices(raw);
              if (numbered && numbered.options.length >= 2) {
                needsClarify = true;
                clarifyQuestion = numbered.body || "어느 쪽을 찾으시나요?";
                clarifyOptions = numbered.options.slice(0, 5);
              }
            }
            if (
              needsClarify &&
              isSpuriousProjectClarify(userText, clarifyOptions)
            ) {
              needsClarify = false;
              clarifyQuestion = "";
              clarifyOptions = [];
            }
          } catch (err) {
            console.error("[luna/chat] clarify", err);
          }

          if (needsClarify && clarifyQuestion && clarifyOptions.length >= 2) {
            pushStep("clarify", "done", "의도 확인");
            emit(controller, encoder, {
              type: "clarify",
              question: clarifyQuestion,
              options: clarifyOptions
            });

            const userMeta: Record<string, unknown> = {};
            if (attachmentMeta.length > 0) userMeta.attachments = attachmentMeta;
            if (
              perspectiveIds.length > 0 ||
              roleIds.length > 0 ||
              taskIds.length > 0
            ) {
              userMeta.skills = {
                perspective_ids: perspectiveIds,
                role_ids: roleIds,
                task_ids: taskIds
              };
            }

            const clarifyNow = Date.now();
            await admin.from("luna_messages").insert([
              {
                id: userMessageId,
                conversation_id: conversationId,
                role: "user",
                content: userText,
                engine: usedEngine,
                metadata: userMeta,
                created_at: new Date(clarifyNow - 1000).toISOString()
              },
              {
                id: assistantMessageId,
                conversation_id: conversationId,
                role: "assistant",
                content: clarifyQuestion,
                engine: usedEngine,
                metadata: {
                  clarify: { question: clarifyQuestion, options: clarifyOptions },
                  steps,
                  model_steps: modelSteps,
                  model_label: tierB.model_label,
                  duration_ms: Date.now() - startedAt,
                  used_prompts: usageLog.all(),
                  classification: classificationPublic(
                    classification,
                    questionTypes
                  )
                },
                created_at: new Date(clarifyNow).toISOString()
              }
            ]);
            await touchConversation();
            scheduleConversationTitle(admin, conversationId);
            controller.close();
            return;
          }

          pushStep("clarify", "done", "의도 확인");
        }

        // ——— 검색어: 질문 원문 고정 (LLM 추출은 재현성을 깨뜨림) ———
        // 임베딩은 이미 searchIntentText 로 생성. 키워드 매칭도 원문+고유명사.
        let keywords = searchIntentText.slice(0, 120);
        pushStep("kw", "done", "검색어 (질문 원문)");
        console.log("[luna/search] keywords from question", {
          keywords: keywords.slice(0, 80),
          speculativeMaxSim: maxNotionSimilarity(speculativeNotion.sources),
          speculativeMaxMatch: maxNotionMatchStrength(speculativeNotion.sources)
        });

        const injectKeywords = splitKeywordQuery(
          keywords,
          searchIntentText,
          glossaryRows
        );
        const knowledgeInject = pickLearningsForQuestion(
          learningsRowsAll,
          injectKeywords,
          {
            dump: knowledgeDumpRequested,
            embeddingHits: knowledgeEmb.learning,
            max: llmInject.learnings,
            matchedMax: llmInject.learnings
          }
        );
        const matchedTerms = searchScope.flags.glossary
          ? pickGlossaryForQuestion(
              glossaryRows,
              injectKeywords,
              knowledgeEmb.glossary
            )
          : [];
        let wikiSources: WikiSourceRef[] =
          searchScope.flags.wiki &&
          (typesNeedWikiLookup(classification.types) ||
            Boolean(clarifyFollowupQuery))
            ? matchWikiSections(
                wikiDocs,
                injectKeywords,
                listingQuestion ? listingSourceText : searchIntentText,
                knowledgeEmb.wiki,
                wikiLimitsForDepth(questionDepth, llmInject)
              )
            : [];
        if (namedProjectLock) {
          wikiSources = filterWikiByAsked(wikiSources, askedWhat);
        }
        if (
          shouldSkipFindConnectors({
            types: classification.types,
            wikiSources,
            listing: listingQuestion
          }) &&
          !hasManualConnectors(manualConnectorFlags)
        ) {
          // 실시간 노션 API·Work서버 도구 루프만 스킵. 범위 플래그는 유지.
          if (!webAugmentEnabled) webEnabled = false;
          connectorRouting = {
            connectors: {
              nas: nasEnabled,
              notion: notionEnabled,
              web: webEnabled
            },
            reason: "wiki_covers_know",
            reasonLabel: listingQuestion
              ? "목록형: 위키로 충분 · 색인은 범위 따름"
              : "알기: 위키로 충분 · 색인은 범위 따름"
          };
        }
        // 용어·규정 등 좁은 범위에서는 위키가 있어도 노션을 강제로 켜지 않는다.
        let { public: publicWikiSources, private: privateWikiRefs } =
          splitWikiSourcesByVisibility(wikiSources);
        const glossaryBlock = formatGlossaryBlock(matchedTerms);
        const wikiSectionsBlock = formatWikiSectionsBlock(wikiSources);
        const learnings = knowledgeInject.all.map((l) => ({
          content: l.content,
          category: l.category
        }));
        const learningsBlock = formatMatchedLearningsBlock({
          matched: knowledgeInject.matched,
          other: knowledgeInject.other
        });
        const injectedTerms = matchedTerms
          .map((t) => (t.term_ko ?? "").trim())
          .filter(Boolean);
        {
          const uiCh = uiChannelsForKind(searchScope.kind);
          if (uiCh.glossary) {
            pushUiGlossaryStep(pushStep, matchedTerms.length);
          }
          if (uiCh.wiki) {
            pushUiWikiStep(pushStep, publicWikiSources.length);
          }
        }

        let webAugmented = false;
        const listingWikiSufficient =
          listingQuestion && wikiCoversKnowIntent(wikiSources, true);
        const knowledgeCoveredForScope =
          !scopeHitsInsufficient(searchScope.kind, {
            glossary: matchedTerms.length,
            wiki: wikiSources.length,
            notion: 0,
            nas: 0,
            media: 0
          });
        if (
          !listingWikiSufficient &&
          !knowledgeCoveredForScope &&
          shouldWebAugmentKnow({
            enabled: webAugmentEnabled,
            typeSlugs: classification.types,
            matchedKnowledge: knowledgeInject.matched.length,
            matchedTerms: matchedTerms.length,
            question: searchIntentText,
            alreadyWeb: webEnabled
          })
        ) {
          webEnabled = true;
          // 웹 보강 시에도 좁은 범위(term/policy)는 노션을 바로 열지 않고 2차에서 연다
          if (
            searchScope.kind !== "term" &&
            searchScope.kind !== "policy"
          ) {
            notionEnabled = true;
          }
          webAugmented = true;
          connectorRouting = {
            connectors: {
              nas: nasEnabled,
              notion: notionEnabled,
              web: true
            },
            reason: "web_augment",
            reasonLabel: "알기: 지식 부족 · 웹 보강"
          };
        }

        if (
          listingQuestion &&
          !hasManualConnectors(manualConnectorFlags) &&
          (searchScope.kind === "wide" ||
            searchScope.kind === "project" ||
            searchScope.kind === "find_wide" ||
            searchScope.kind === "reference")
        ) {
          // 목록형: 웹만 끈다. 범위가 켠 색인·Work만 유지.
          webEnabled = false;
          webAugmented = false;
          connectorRouting = {
            connectors: {
              nas: nasEnabled,
              notion: notionEnabled,
              web: false
            },
            reason: "wiki_covers_know",
            reasonLabel: "목록형: 색인·위키로 답"
          };
        }

        // ——— 단계 2~5: 검색 루프 ———
        const isSearchRequest =
          !hasAttachments &&
          (isSearchRequestMessage(userText) ||
            (Boolean(clarifyRootUser) &&
              isSearchRequestMessage(clarifyRootUser!)));
        const scopeWantsConnectorSearch =
          searchScope.flags.notion ||
          searchScope.flags.nas ||
          searchScope.flags.media ||
          searchScope.flags.web ||
          searchScope.flags.youtube;
        let anySearch =
          scopeWantsConnectorSearch &&
          (Boolean((keywords || searchIntentText).trim()) ||
            (needsSearch && (notionEnabled || webEnabled || nasEnabled)) ||
            (webAugmented && (webEnabled || notionEnabled)));

        // 1차(위키·용어사전)만으로 부족하면 검색 전에 한 단계 넓힌다.
        // speculative 노션·미디어가 이미 충분하면 NAS 로 확대하지 않는다.
        if (
          !namedProjectLock &&
          !hasManualConnectors(manualConnectorFlags) &&
          scopeHitsInsufficient(searchScope.kind, {
            glossary: matchedTerms.length,
            wiki: wikiSources.length,
            notion: speculativeNotion.sources.length,
            nas: speculativeNas.length,
            media: preMediaProbe.cards.length
          })
        ) {
          const widened = widenSearchScope(searchScope);
          if (widened) {
            searchScope = applyListingReferenceFlags(widened, listingQuestion);
            const scoped = applyScopeToConnectorFlags(
              searchScope.flags,
              { notion: notionEnabled, web: webEnabled, nas: nasEnabled },
              false
            );
            notionEnabled = scoped.notion;
            webEnabled = scoped.web;
            nasEnabled = listingReferenceDisablesNas(
              searchScope.kind,
              listingQuestion
            )
              ? false
              : scoped.nas;
            connectorRouting = {
              connectors: {
                nas: nasEnabled,
                notion: notionEnabled,
                web: webEnabled
              },
              reason: "search_scope",
              reasonLabel: `${scopeReasonLabel(searchScope)} · 결과 부족 확대`
            };
            anySearch =
              (searchScope.flags.notion ||
                searchScope.flags.nas ||
                searchScope.flags.media ||
                searchScope.flags.web) &&
              Boolean((keywords || searchIntentText).trim());
            console.log("[luna/search-scope] widen-before-search", {
              kind: searchScope.kind,
              tier: searchScope.tier,
              flags: searchScope.flags,
              listing: listingQuestion,
              speculativeNotion: speculativeNotion.sources.length,
              preMedia: preMediaProbe.cards.length
            });
          }
        }

        let notionSources: NotionSource[] = [];
        let notionSearchOutcome: NotionSearchOutcome | null = null;
        let cards: LunaCard[] = [];
        let nasResults: NasDirectoryRow[] = [];
        let nasTextHitCount = 0;
        let nasTextSearched = false;
        const flushUiProgress = () => {
          const counts = uiProgressCountsFromState({
            glossary: matchedTerms.length,
            wiki: publicWikiSources.length,
            notionSources,
            linkAdded: notionSearchOutcome?.secondary?.link_added ?? 0,
            nasResults,
            nasTextHits: nasTextSearched ? nasTextHitCount : -1,
            cards
          });
          refreshConnectorUiSteps({
            push: pushStep,
            kind: searchScope.kind,
            hint: uiQueryHint,
            counts
          });
          ensureUiProgressZeros({
            push: pushStep,
            kind: searchScope.kind,
            hint: uiQueryHint,
            existingKeys: new Set(steps.map((s) => s.key)),
            counts
          });
        };
        let usedReportId: string | null = null;
        let usedReportContent: string | null = null;
        const previousKeywords: string[] = [];
        const wsToolCalls: Array<{
          tool: string;
          input: unknown;
          result_count: number;
        }> = [];

        const workserverExploreSystem = typeFindPrompt;

        const skippedNotionOutcome = (): NotionSearchOutcome => ({ status: "skipped", sources: [], queries: [], rounds: 0 });
        const runConnectorSearch = async (
          kw: string,
          opts?: { reuseSpeculative?: boolean }
        ) => {
          // 검색 범위 플래그로 색인·커넥터를 켠다 (처음부터 전부 뒤지지 않음)
          const runNotionIndex =
            searchScope.flags.notion && Boolean(kw || searchIntentText);
          const runNas =
            searchScope.flags.nas && Boolean(kw || searchIntentText);
          const runMedia = searchScope.flags.media;
          const runYoutube =
            searchScope.flags.youtube && isSearchRequest && Boolean(kw);
          const skipNotionLive = listingQuestion;
          const reuseNotion =
            opts?.reuseSpeculative === true &&
            runNotionIndex &&
            speculativeNotion.sources.length > 0;
          const reuseNas =
            opts?.reuseSpeculative === true &&
            runNas &&
            speculativeNas.length > 0;
          const useNasTools =
            nasEnabled &&
            runNas &&
            !listingQuestion &&
            (searchScope.kind === "find_wide" || searchScope.kind === "wide");
          const uiChRun = uiChannelsForKind(searchScope.kind);
          const hintRun = progressQueryHint(kw || searchIntentText) || uiQueryHint;
          const notionPromise = runNotionIndex
              ? (reuseNotion
                ? Promise.resolve(speculativeNotion)
                : searchNotionForLuna(
                    admin,
                    kw || searchIntentText,
                    searchIntentText,
                    {
                      queryEmbedding: knowledgeEmb.queryEmbedding,
                      skipLive: skipNotionLive,
                      listing: listingQuestion
                    }
                  )
              ).then((outcome) => {
                try {
                  if (uiChRun.notion) {
                    const primary =
                      outcome.timings?.candidates_found ??
                      outcome.sources.filter((s) => !s.link_expanded).length;
                    pushUiNotionStep(pushStep, primary, hintRun);
                    const added = outcome.secondary?.link_added ?? 0;
                    if (uiChRun.link && (added > 0 || primary > 0)) {
                      pushUiLinkStep(pushStep, added);
                    }
                  }
                } catch (err) {
                  console.error("[luna/chat] ui notion step", err);
                }
                return outcome;
              })
              : Promise.resolve(skippedNotionOutcome());
          const [notionOutcome, webRes, youtubeRes, nasRes, mediaRes] =
            await Promise.all([
            notionPromise,
            webEnabled && searchScope.flags.web
              ? (() => {
                  const q = kw || searchIntentText;
                  console.log("[luna/search] keywords", q, "→ tavily");
                  return searchTavily(q, webSearchHint);
                })()
              : Promise.resolve([] as LunaCard[]),
            runYoutube
              ? searchYoutube(kw)
              : Promise.resolve([] as LunaCard[]),
            (async () => {
              if (!runNas) {
                return [] as WorkserverExploreRow[];
              }
              if (reuseNas) {
                pushStep("ws", "done", "Work서버 탐색");
                return speculativeNas;
              }
              if (!useNasTools) {
                // 목록형·도구 오프: nas_directory DB 조회만
                pushStep("ws", "done", "Work서버 색인");
                return exploreWorkserverFallback(
                  admin,
                  kw || searchIntentText,
                  searchIntentText
                );
              }
              try {
                recordPromptUse(usageLog, {
                  key: LUNA_PROMPT_KEYS.find,
                  step: "Work서버 탐색",
                  title: "FIND 자료 찾기",
                  row: findPick.row
                });
                logPromptInject({
                  key: LUNA_PROMPT_KEYS.find,
                  step: "Work서버 탐색",
                  source: findPick.source,
                  text: workserverExploreSystem
                });
                const explored = await exploreWorkserverWithTools(
                  admin,
                  client,
                  {
                    keywords: kw,
                    queryText: searchIntentText,
                    model: tierB.model_id,
                    provider: tierBResolved.provider,
                    exploreSystem: workserverExploreSystem,
                    onToolRound: (toolName) => {
                      pushStep("ws", "running", `Work서버 탐색 · ${toolName}`);
                    },
                    onUsage: (usage) => {
                      pushModelStep(modelSteps, admin, {
                        label: "Work서버 탐색",
                        model: tierB.model_label,
                        tier: "B",
                        model_id: tierB.model_id,
                        usage: readUsage(usage)
                      });
                    }
                  }
                );
                if (explored.toolCalls.length > 0) {
                  wsToolCalls.push(...explored.toolCalls);
                  pushStep("ws", "done", "Work서버 탐색");
                }
                return explored.rows;
              } catch (err) {
                console.error(
                  "[luna/ws] tool loop failed, fallback to legacy",
                  err
                );
                pushStep("ws", "done", "Work서버 탐색 (fallback)");
                return exploreWorkserverFallback(
                  admin,
                  kw || searchIntentText,
                  searchIntentText
                );
              }
            })(),
            runMedia
              ? imageIntent && preMediaProbe.cards.length > 0
                ? Promise.resolve(preMediaProbe.cards)
                : searchMediaForLuna(
                    admin,
                    knowledgeEmb.queryEmbedding,
                    searchIntentText,
                    { asked: askedWhat }
                  ).then((r) => r.cards)
              : Promise.resolve([] as LunaCard[])
          ]);

          try {
            const uiChAfter = uiChannelsForKind(searchScope.kind);
            const hintAfter = progressQueryHint(kw || searchIntentText) || uiQueryHint;
            if (uiChAfter.work && runNas) {
              pushUiWorkStep(pushStep, nasRes.length, hintAfter);
            }
            if (uiChAfter.image && runMedia) {
              pushUiImageStep(pushStep, mediaRes.length);
            }
            if (uiChAfter.web && webEnabled && searchScope.flags.web) {
              pushUiWebStep(pushStep, webRes.length);
            }
          } catch (err) {
            console.error("[luna/chat] ui connector steps", err);
          }
          const notionRes = notionOutcome.sources;
          const notionCards: LunaCard[] = notionRes.map((s) => ({
            type: "notion" as const,
            title: s.title,
            url: s.url,
            thumbnail: null,
            description: ""
          }));
          const nasCards = nasRes.map(toNasCard);
          const merged = [
            ...notionCards,
            ...nasCards,
            ...mediaRes,
            ...webRes,
            ...youtubeRes
          ];
          return {
            notionSources: notionRes,
            notionOutcome,
            nasResults: nasRes,
            cards: orderCardsWithImagePriority(merged, searchIntentText),
            counts: {
              notion: notionRes.length,
              nas: nasRes.length,
              web: webRes.length,
              image: mediaRes.length
            }
          };
        };

        if (anySearch) {
          const searchParts: string[] = [];
          if (searchScope.flags.notion) searchParts.push("노션");
          if (searchScope.flags.nas) searchParts.push("Work서버");
          if (searchScope.flags.web && webEnabled) searchParts.push("웹");
          if (searchScope.flags.media) searchParts.push("이미지");
          const searchRunningLabel =
            searchParts.length > 0
              ? `${searchParts.join(" · ")} 검색 중`
              : "검색 중";

          pushStep("search", "running", searchRunningLabel);

          try {
            const matched = await findSimilarReport(admin, keywords);
            if (matched?.content?.trim()) {
              usedReportId = matched.id;
              usedReportContent = matched.content;
              bumpReportUse(admin, matched.id);
              pushStep("report", "done", "정리해둔 자료 참고");
            }
          } catch (err) {
            console.error("[luna/chat] report lookup", err);
          }

          const formatSearchDoneLabel = (counts: {
            notion: number;
            nas: number;
            web: number;
          }) => {
            const parts = [
              `노션 ${counts.notion}`,
              nasEnabled || listingQuestion
                ? `Work서버 ${counts.nas}`
                : null,
              webEnabled ? `웹 ${counts.web}` : null
            ].filter(Boolean) as string[];
            if (parts.length === 0) return "검색 결과 없음";
            const allZero =
              counts.notion === 0 &&
              (!(nasEnabled || listingQuestion) || counts.nas === 0) &&
              (!webEnabled || counts.web === 0);
            return allZero ? "검색 결과 없음" : parts.join(" · ");
          };

          previousKeywords.push(keywords);
          searchRounds = 1;
          let batch = await runConnectorSearch(keywords, {
            reuseSpeculative: true
          });
          notionSources = batch.notionSources;
          notionSearchOutcome = batch.notionOutcome;
          nasResults = batch.nasResults;
          cards = batch.cards;

          // Work 본문: 목록형은 생략. 노션이 이미 충분하면 프로젝트·찾기도 생략(수 초 절약).
          // Work 디렉터리 색인·nas_path 조회는 그대로 두어 Work 카드는 유지한다.
          const notionMatchEnough =
            maxNotionMatchStrength(notionSources) >= PACK_SCORE_RECOMMENDED;
          if (
            nasEnabled &&
            !listingQuestion &&
            !notionMatchEnough
          ) {
            nasTextSearched = true;
            try {
              const kwHits = await searchNasTextKeyword(
                admin,
                searchIntentText,
                { limit: 12 }
              );
              if (kwHits.length > 0) {
                nasTextHitCount = Math.max(nasTextHitCount, kwHits.length);
                const seen = new Set(
                  nasResults.map((r) =>
                    r.path.replace(/\\/g, "/").toLowerCase()
                  )
                );
                const extra: WorkserverExploreRow[] = [];
                for (const hit of kwHits) {
                  const key = hit.path.replace(/\\/g, "/").toLowerCase();
                  if (seen.has(key)) continue;
                  seen.add(key);
                  extra.push({
                    drive: hit.drive,
                    path: hit.path,
                    type: "file",
                    size_bytes: null,
                    modified_at: hit.modified_at,
                    file_summary: hit.snippet,
                    importance: hit.score
                  });
                }
                if (extra.length > 0) {
                  nasResults = finalizeNasDirectoryRows([
                    ...nasResults,
                    ...extra
                  ]);
                }
              }
            } catch (err) {
              console.error("[luna/chat] nas text keyword", err);
            }
            if (knowledgeEmb.queryEmbedding?.length) {
              try {
                const nasChunkHits = await matchNasChunkEmbeddings(
                  admin,
                  knowledgeEmb.queryEmbedding,
                  { limit: 12 }
                );
                if (nasChunkHits.length > 0) {
                  nasTextHitCount = Math.max(
                    nasTextHitCount,
                    nasChunkHits.length
                  );
                  const seen = new Set(
                    nasResults.map((r) =>
                      r.path.replace(/\\/g, "/").toLowerCase()
                    )
                  );
                  const extra: WorkserverExploreRow[] = [];
                  for (const hit of nasChunkHits) {
                    const key = hit.path.replace(/\\/g, "/").toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    extra.push({
                      drive: null,
                      path: hit.path,
                      type: "file",
                      size_bytes: null,
                      modified_at: null,
                      file_summary: hit.content?.slice(0, 200) ?? null,
                      importance: hit.similarity
                    });
                  }
                  if (extra.length > 0) {
                    nasResults = finalizeNasDirectoryRows([
                      ...nasResults,
                      ...extra
                    ]);
                  }
                }
              } catch (err) {
                console.error("[luna/chat] nas chunk match", err);
              }
            }
          }

          // 2차: 좁은 범위 결과가 부족하면 한 단계 더 넓혀 재검색
          if (
            !namedProjectLock &&
            !hasManualConnectors(manualConnectorFlags) &&
            scopeHitsInsufficient(searchScope.kind, {
              glossary: matchedTerms.length,
              wiki: wikiSources.length,
              notion: notionSources.length,
              nas: nasResults.length,
              media: cards.filter((c) => c.type === "image").length
            })
          ) {
            const widened = widenSearchScope(searchScope);
            if (widened) {
              searchScope = applyListingReferenceFlags(widened, listingQuestion);
              const scoped = applyScopeToConnectorFlags(
                searchScope.flags,
                { notion: notionEnabled, web: webEnabled, nas: nasEnabled },
                false
              );
              notionEnabled = scoped.notion;
              webEnabled = scoped.web;
              nasEnabled = listingReferenceDisablesNas(
                searchScope.kind,
                listingQuestion
              )
                ? false
                : scoped.nas;
              connectorRouting = {
                connectors: {
                  nas: nasEnabled,
                  notion: notionEnabled,
                  web: webEnabled
                },
                reason: "search_scope",
                reasonLabel: `${scopeReasonLabel(searchScope)} · 결과 부족 확대`
              };
              console.log("[luna/search-scope] widen-after-search", {
                kind: searchScope.kind,
                tier: searchScope.tier,
                flags: searchScope.flags,
                listing: listingQuestion
              });
              pushStep("search", "running", "범위 확대 재검색");
              batch = await runConnectorSearch(keywords, {
                reuseSpeculative: false
              });
              notionSources = batch.notionSources;
              notionSearchOutcome = batch.notionOutcome;
              nasResults = batch.nasResults;
              cards = batch.cards;
              searchRounds += 1;
            }
          }

          pushStep("search", "done", formatSearchDoneLabel(batch.counts));

          // 노션 nas_path → 색인 직접 조회 (목록형 사례는 Work 카드 생략)
          // 전체 히트가 아니라 LLM·카드에 쓸 상위만 — path마다 직렬 조회라 27건이면 수 초가 붙는다
          if (
            notionSources.length > 0 &&
            !listingReferenceDisablesNas(searchScope.kind, listingQuestion)
          ) {
            const topForPaths = takeTopNotionSourcesForLlm(
              notionSources,
              Math.max(llmInject.notion, 8)
            );
            const recorded = notionRecordedPaths(topForPaths);
            if (recorded.length > 0) {
              try {
                const looked = await lookupNasByRecordedPaths(admin, recorded);
                if (looked.length > 0) {
                  nasResults = finalizeNasDirectoryRows([
                    ...nasResults,
                    ...looked
                  ]);
                  cards = [
                    ...mergeCards(
                      cards.filter((c) => c.type !== "nas"),
                      []
                    ),
                    ...nasResults.map(toNasCard)
                  ];
                  console.log("[luna/search] nas_path lookup", {
                    recorded: recorded.length,
                    hits: looked.length,
                    notionTop: topForPaths.length
                  });
                }
              } catch (err) {
                console.error("[luna/search] nas_path lookup", err);
              }
            }
          }

          if (namedProjectLock) {
            try {
              const namedNas = await searchNasFoldersByName(admin, askedWhat, 40);
              if (namedNas.length > 0) {
                nasResults = finalizeNasDirectoryRows([
                  ...nasResults,
                  ...namedNas.map((r) => ({
                    drive: r.drive,
                    path: r.path,
                    type: r.type,
                    size_bytes: null,
                    modified_at: null,
                    file_summary: null,
                    importance: null
                  }))
                ]);
                cards = [
                  ...cards.filter((c) => c.type !== "nas"),
                  ...nasResults.map(toNasCard)
                ];
              }
            } catch (err) {
              console.error("[luna/search] nas-by-name", err);
            }
          }

          {
            const filtered = filterRetrievedByAsked(
              {
                cards,
                notion: notionSources,
                wiki: wikiSources,
                nas: nasResults
              },
              askedWhat
            );
            evidenceCounts = {
              retrieved: filtered.counts.retrieved,
              matching: filtered.counts.matching
            };
            cards = filtered.cards;
            notionSources = filtered.notion;
            wikiSources = filtered.wiki;
            nasResults = filtered.nas as NasDirectoryRow[];
            if (askedWhat.material !== "image") {
              cards = [
                ...cards.filter((c) => c.type !== "nas"),
                ...nasResults.map(toNasCard)
              ];
            }
            ({ public: publicWikiSources, private: privateWikiRefs } =
              splitWikiSourcesByVisibility(wikiSources));
            if (namedProjectLock && filtered.counts.matching === 0) {
              notFoundFromAsk = true;
              cards = [];
              notionSources = [];
              wikiSources = [];
              nasResults = [];
              publicWikiSources = [];
              privateWikiRefs = [];
            }
            console.log("[luna/search-filter]", {
              project: askedWhat.displayProject,
              material: askedWhat.material,
              nature: askedWhat.nature,
              retrieved: evidenceCounts.retrieved,
              matching: evidenceCounts.matching,
              notFound: notFoundFromAsk
            });
          }

          const emitSearchSnapshot = () => {
            if (streamMetaEmitted) return;
            const imageN = cards.filter((c) => c.type === "image").length;
            console.log("[luna/media-index] snapshot", {
              query: searchIntentText.slice(0, 80),
              imageCards: imageN,
              topSim:
                cards.find((c) => c.type === "image")?.similarity ?? null
            });
            emit(controller, encoder, {
              type: "search_snapshot",
              cards,
              notion_sources: notionSources,
              wiki_count: publicWikiSources.length,
              classification: classificationPublic(classification, questionTypes),
              counts: {
                wiki: publicWikiSources.length,
                notion: notionSources.length,
                work: nasResults.length,
                image: imageN
              }
            });
          };
          emitSearchSnapshot();
          flushUiProgress();

          // 자체 평가 + 재검색 (임베딩·하이브리드 합산 중 큰 값이 임계 이상이면 건너뜀)
          let sufficient = true;
          let missing = "";
          const firstMaxSim = maxNotionSimilarity(notionSources);
          const firstMaxMatch = maxNotionMatchStrength(notionSources);
          if (namedProjectLock) {
            sufficient = true;
            pushStep(
              "eval",
              "done",
              notFoundFromAsk ? "지정 프로젝트 · 해당 없음" : "지정 프로젝트 범위"
            );
          } else if (firstMaxMatch >= PACK_SCORE_RECOMMENDED) {
            pushStep(
              "eval",
              "done",
              `색인 충분 (sim ${firstMaxSim.toFixed(2)} · match ${firstMaxMatch.toFixed(2)})`
            );
            console.log("[luna/search] skip re-search", {
              firstMaxSim,
              firstMaxMatch
            });
          } else for (let round = 1; round <= MAX_SEARCH_ROUNDS; round += 1) {
            if (Date.now() - startedAt > SEARCH_BUDGET_MS) break;

            if (cards.length === 0) {
              sufficient = false;
              missing = "검색 결과가 없음";
              pushStep("eval", "done", "결과 없음");
            } else {
              pushStep("eval", "running", "결과 평가 중");
              try {
                const materialLines = cards
                  .slice(0, 40)
                  .map(formatCardLineForEval)
                  .filter(Boolean);
                const evalRes = await lunaLlmComplete(admin, {
                  tier: "B",
                  feature: "eval_grade",
                  system: selfEvalPrompt,
                  user: `질문:\r\n${searchIntentText}\r\n\r\n찾은 자료:\r\n${materialLines.join(
                    "\r\n"
                  )}`,
                  maxTokens: 256
                });
                recordPromptUse(usageLog, {
                  key: LUNA_PROMPT_KEYS.selfEval,
                  step: "자체 평가",
                  title: "자체 평가",
                  row: selfEvalPick.row
                });
                logPromptInject({
                  key: LUNA_PROMPT_KEYS.selfEval,
                  step: "자체 평가",
                  source: selfEvalPick.source,
                  text: selfEvalPrompt
                });
                pushModelStep(modelSteps, admin, {
                  label: "자체 평가",
                  model: evalRes.model_label,
                  tier: "B",
                  model_id: evalRes.model_id,
                  usage: evalRes.usage
                });
                const evalRaw = evalRes.text.trim();
                const evalParsed = parseJsonObject(evalRaw);
                if (
                  !evalParsed ||
                  typeof evalParsed.sufficient !== "boolean"
                ) {
                  sufficient = cards.length > 0;
                } else {
                  sufficient = evalParsed.sufficient;
                }
                missing =
                  typeof evalParsed?.missing === "string"
                    ? evalParsed.missing.trim()
                    : "";
              } catch (err) {
                console.error("[luna/chat] self_eval", err);
                sufficient = cards.length > 0;
              }
              pushStep("eval", "done", "결과 평가");
            }

            if (sufficient) break;
            if (round >= MAX_SEARCH_ROUNDS) break;
            if (Date.now() - startedAt > SEARCH_BUDGET_MS) break;

            pushStep("requery", "running", "검색어를 바꿔 다시 찾는 중");

            let newKeywords = "";
            try {
              const reqRes = await lunaLlmComplete(admin, {
                tier: "B",
                feature: "search_terms",
                system: requeryPrompt,
                user: `원 질문:\r\n${searchIntentText}\r\n\r\n이전 검색어:\r\n${previousKeywords.join(
                  ", "
                )}\r\n\r\n부족한 점:\r\n${missing || "관련 자료가 부족함"}`,
                maxTokens: 64
              });
              recordPromptUse(usageLog, {
                key: LUNA_PROMPT_KEYS.requery,
                step: "재검색어 생성",
                title: "재검색 키워드 재생성",
                row: requeryPick.row
              });
              logPromptInject({
                key: LUNA_PROMPT_KEYS.requery,
                step: "재검색어 생성",
                source: requeryPick.source,
                text: requeryPrompt
              });
              pushModelStep(modelSteps, admin, {
                label: "재검색어 생성",
                model: reqRes.model_label,
                tier: "B",
                model_id: reqRes.model_id,
                usage: reqRes.usage
              });
              const reqText = reqRes.text.trim();
              newKeywords = reqText.replace(/^["']|["']$/g, "").trim();
            } catch (err) {
              console.error("[luna/chat] requery", err);
              pushStep("requery", "done", "검색어를 바꿔 다시 찾는 중");
              break;
            }

            // 재검색도 질문 원문을 유지하고, missing 힌트만 뒤에 붙인다 (LLM 단독 치환 금지)
            const hint = (missing || newKeywords).slice(0, 60);
            const mergedKw = `${searchIntentText.slice(0, 80)} ${hint}`.trim();
            if (
              !mergedKw ||
              previousKeywords.some(
                (k) => k.toLowerCase() === mergedKw.toLowerCase()
              )
            ) {
              pushStep("requery", "done", "검색어를 바꿔 다시 찾는 중");
              break;
            }

            previousKeywords.push(mergedKw);
            keywords = mergedKw;
            searchRounds += 1;
            pushStep("search", "running", searchRunningLabel);
            batch = await runConnectorSearch(keywords);
            notionSearchOutcome = notionSearchOutcome ? mergeNotionSearchOutcomes(notionSearchOutcome, batch.notionOutcome) : batch.notionOutcome;
            notionSources = annotateNotionSourcesWithWorkStage(
              notionSearchOutcome.sources,
              searchIntentText
            );
            notionSearchOutcome = {
              ...notionSearchOutcome,
              sources: notionSources
            };
            nasResults = finalizeNasDirectoryRows([
              ...nasResults,
              ...batch.nasResults
            ]);
            cards = [
              ...mergeCards(
                cards.filter((c) => c.type !== "nas"),
                batch.cards.filter((c) => c.type !== "nas")
              ),
              ...nasResults.map(toNasCard)
            ];
            emitSearchSnapshot();
            const recountCounts = {
              notion: cards.filter((c) => c.type === "notion").length,
              nas: cards.filter((c) => c.type === "nas").length,
              web: cards.filter((c) => c.type === "web").length
            };
            pushStep("requery", "done", "검색어를 바꿔 다시 찾는 중");
            pushStep("search", "done", formatSearchDoneLabel(recountCounts));
            if (maxNotionMatchStrength(notionSources) >= PACK_SCORE_RECOMMENDED) {
              break;
            }
          }
        }

        flushUiProgress();

        // ——— 단계 6: 소스별 이유 + 답변 ———
        let sourceReasons: SourceReasons | null = null;
        const reasonUser = buildSourceReasonUserMessage(
          searchIntentText,
          cards,
          nasResults
        );
        const skipSourceReasons =
          maxNotionMatchStrength(notionSources) >= PACK_SCORE_RECOMMENDED;
        if (reasonUser && !skipSourceReasons) {
          try {
            const reasonRes = await lunaLlmComplete(admin, {
              tier: "B",
              feature: "chat_answer",
              system: synthesisReason,
              user: reasonUser,
              maxTokens: 256
            });
            recordPromptUse(usageLog, {
              key: LUNA_PROMPT_KEYS.synthesis,
              step: "소스 이유",
              title: "종합 사유",
              row: synthesisPick.row
            });
            logPromptInject({
              key: LUNA_PROMPT_KEYS.synthesis,
              step: "소스 이유",
              source: synthesisPick.source,
              text: synthesisReason
            });
            pushModelStep(modelSteps, admin, {
              label: "소스 이유",
              model: reasonRes.model_label,
              tier: "B",
              model_id: reasonRes.model_id,
              usage: reasonRes.usage
            });
            const reasonRaw = reasonRes.text.trim();
            const parsedReason = parseJsonObject(reasonRaw);
            if (parsedReason) {
              const next: SourceReasons = {};
              if (typeof parsedReason.notion === "string") {
                const v = clipReason(parsedReason.notion);
                if (v) next.notion = v;
              }
              if (typeof parsedReason.nas === "string") {
                const v = clipReason(parsedReason.nas);
                if (v) next.nas = v;
              }
              if (typeof parsedReason.web === "string") {
                const v = clipReason(parsedReason.web);
                if (v) next.web = v;
              }
              if (Object.keys(next).length > 0) sourceReasons = next;
            }
          } catch (err) {
            console.error("[luna/chat] source reasons", err);
          }
        }

        pushStep("answer", "running", "정리하는 중…");

        const historyMessages: Anthropic.MessageParam[] = recent
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content
          }));

        if (hasAttachments) {
          const contentBlocks: Anthropic.ContentBlockParam[] = [];
          for (const att of attachments) {
            const { data: fileData, error: downloadError } = await admin.storage
              .from("luna-files")
              .download(att.storage_path);
            if (downloadError || !fileData) {
              console.error("[luna/chat] download", att.id, downloadError);
              throw new Error(`Failed to download attachment: ${att.file_name}`);
            }
            const bytes = Buffer.from(await fileData.arrayBuffer());
            const base64 = bytes.toString("base64");
            if (att.mime_type === "application/pdf") {
              contentBlocks.push({
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64
                }
              } as Anthropic.ContentBlockParam);
            } else {
              contentBlocks.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: att.mime_type as
                    | "image/png"
                    | "image/jpeg"
                    | "image/gif"
                    | "image/webp",
                  data: base64
                }
              });
            }
          }
          contentBlocks.push({ type: "text", text: searchIntentText });
          historyMessages.push({ role: "user", content: contentBlocks });
        } else {
          historyMessages.push({ role: "user", content: searchIntentText });
        }

        const typeBlocks: string[] = [];
        for (const row of classifiedTypeRows) {
          if (!row.prompt_key) {
            const extra = [row.criteria, row.answer_form].filter(Boolean).join("\r\n");
            if (extra) typeBlocks.push(`[유형 ${row.label}]\r\n${extra}`);
            continue;
          }
          const pick = typePromptByKey[row.prompt_key];
          if (pick?.text) typeBlocks.push(pick.text);
        }
        if (libraryHits.length > 0) {
          typeBlocks.push(formatLibraryBlock(libraryHits));
        }
        if (namedProjectLock) {
          const name = askedWhat.displayProject || askedWhat.projectPhrases[0];
          typeBlocks.push(
            `[지정 프로젝트]\r\n질문한 프로젝트(${name}) 자료만 답한다. 다른 프로젝트 이름·폴더를 언급하거나 제안하지 마라. 맞는 자료가 없으면 없다고만 하고, 어디 있는지 알려달라고 한다.`
          );
        }

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
              .join("\r\n\r\n")
          : undefined;

        const slimListingPrompt = listingReferenceDisablesNas(
          searchScope.kind,
          listingQuestion
        );
        /** 용어·규정·목록형은 부서 관점 전문이 답을 거의 안 바꾸고 입력만 키운다 */
        const skipPerspectiveInject =
          slimListingPrompt ||
          searchScope.kind === "term" ||
          searchScope.kind === "policy";

        const depthRule = listingQuestion
          ? listingRule
          : questionDepth === "synthesis"
            ? SYNTHESIS_ANSWER_RULE
            : undefined;

        // 목록형 사례: listing 규칙만 — understand/know/관점/learnings 는 입력만 키운다
        const l3Prompt = slimListingPrompt
          ? buildL3PromptBlock({
              assume: talkAssume,
              depthRule: listingRule
            })
          : buildL3PromptBlock({
              understand: understandPick.text,
              assume: talkAssume,
              typeBlocks,
              answer: shouldOmitTalkAnswer(questionDepth)
                ? undefined
                : talkAnswer,
              depthRule
            });

        const systemPrompt = buildAnswerSystem(
          {
            identity,
            learningsBlock: slimListingPrompt ? undefined : learningsBlock,
            glossaryBlock,
            wikiSectionsBlock,
            skillPrompt: skipPerspectiveInject ? null : skillPrompt,
            l3Prompt,
            workserverStructure,
            notionSources,
            cards,
            nasResults,
            nasSearchAttempted: nasEnabled && anySearch,
            reportContent: usedReportContent,
            notionSearchAttempted: notionEnabled && anySearch,
            notionSearchStatus: notionSearchOutcome?.status,
            notionSearchRounds: notionSearchOutcome?.rounds ?? 0,
            webAugmented,
            clarifyFollowup: Boolean(clarifyFollowupQuery),
            questionDepth,
            listingQuestion,
            listingRule: slimListingPrompt ? undefined : listingRule,
            listingChecklist: slimListingPrompt ? undefined : listingChecklist,
            llmInject,
            userMemoryBlock: slimListingPrompt ? null : userMemoryBlock,
            slimListingPrompt
          },
          tierACfg.use_caching === true,
          tierA.model_id
        );

        recordPromptUse(usageLog, {
          key: LUNA_PROMPT_KEYS.identity,
          step: "답변 생성",
          title: "아폴론 정체성",
          row: identityPick.row
        });
        recordPromptUse(usageLog, {
          key: LUNA_PROMPT_KEYS.workserverStructure,
          step: "답변 생성",
          title: "Work서버 구조 설명",
          row: structurePick.row
        });
        for (const skill of l2SkillRows) {
          if (skipPerspectiveInject && skill.kind === "perspective") continue;
          recordPromptUse(usageLog, {
            key: skill.prompt_key || `l2:${skill.title}`,
            step: "답변 생성",
            title: skill.title,
            row: {
              level: skill.level,
              sort_order: skill.sort_order,
              title: skill.title,
              kind: skill.kind
            }
          });
          logPromptInject({
            key: skill.prompt_key || `l2:${skill.title}`,
            step: "답변 생성",
            source: "db",
            text: skillPrompt ?? skill.title
          });
        }
        recordPromptUse(usageLog, {
          key: LUNA_PROMPT_KEYS.understand,
          step: "답변 생성",
          title: "질문 이해와 되묻기",
          row: understandPick.row
        });
        if (talkAssume) {
          recordPromptUse(usageLog, {
            key: LUNA_PROMPT_KEYS.assume,
            step: "답변 생성",
            title: "가정 확인",
            row: assumePick.row
          });
        }
        for (const row of classifiedTypeRows) {
          if (!row.prompt_key) continue;
          const pick = typePromptByKey[row.prompt_key];
          if (!pick?.text) continue;
          recordPromptUse(usageLog, {
            key: row.prompt_key,
            step: "답변 생성",
            title: pick.title,
            row: pick.row
          });
          logPromptInject({
            key: row.prompt_key,
            step: "답변 생성",
            source: pick.source,
            text: pick.text
          });
        }
        if (talkAnswer && !shouldOmitTalkAnswer(questionDepth)) {
          recordPromptUse(usageLog, {
            key: LUNA_PROMPT_KEYS.answer,
            step: "답변 생성",
            title: "답변 원칙",
            row: answerPick.row
          });
        }
        logPromptInject({
          key: LUNA_PROMPT_KEYS.identity,
          step: "답변 생성",
          source: identityPick.source,
          text: identity
        });

        const usedPrompts = usageLog.all();

        const connectorRoutingMeta = connectorRouting
          ? {
              nas: nasEnabled,
              notion: notionEnabled,
              web: webEnabled,
              reason: connectorRouting.reason,
              reason_label: connectorRouting.reasonLabel,
              summary: formatConnectorRoutingSummary(connectorRouting)
            }
          : null;

        emit(controller, encoder, {
          type: "meta",
          cards,
          notion_sources: notionSources,
          search_rounds: searchRounds,
          steps,
          source_reasons: sourceReasons,
          memory_count: learnings.length,
          injected_knowledge_ids: knowledgeInject.ids,
          injected_terms: injectedTerms,
          wiki_sources: publicWikiSources,
          web_augmented: webAugmented,
          used_prompts: usedPrompts,
          auto_routing: autoRoutingUsed,
          connector_routing: connectorRoutingMeta,
          classification: classificationPublic(classification, questionTypes),
          clarify_followup: Boolean(clarifyFollowupQuery)
        });
        streamMetaEmitted = true;

        let assistantText = "";
        const maxTokens = answerMaxTokensForDepth(
          questionDepth,
          hasAttachments
        );
        let answerUsage = emptyUsage();
        const llmStartedAt = Date.now();
        let firstTokenAt: number | null = null;
        console.log("[luna/answer]", {
          depth: questionDepth,
          maxTokens,
          omitTalkAnswer: shouldOmitTalkAnswer(questionDepth)
        });

        if (notFoundFromAsk) {
          assistantText = formatNotFoundAnswer(
            askedWhat,
            projectPeek.seenFolderLabels
          );
          firstTokenAt = Date.now();
          controller.enqueue(encoder.encode(assistantText));
        } else if (tierAResolved.provider === "anthropic") {
          if (!client) {
            throw new Error("Claude API key is not configured");
          }
          const anthropicStream = client.messages.stream({
            model: tierA.model_id,
            max_tokens: maxTokens,
            system: systemPrompt.anthropic || undefined,
            messages: historyMessages
          });

          anthropicStream.on("text", (textDelta) => {
            if (firstTokenAt == null && textDelta) firstTokenAt = Date.now();
            assistantText += textDelta;
            controller.enqueue(encoder.encode(textDelta));
          });

          const finalMsg = await anthropicStream.finalMessage();
          answerUsage = readUsage(finalMsg.usage);
        } else {
          const flatUser = historyMessages
            .map((m) => {
              const role = m.role;
              let content = "";
              if (typeof m.content === "string") {
                content = m.content;
              } else if (Array.isArray(m.content)) {
                content = m.content
                  .map((c) => {
                    if (
                      typeof c === "object" &&
                      c &&
                      "type" in c &&
                      (c as { type: string }).type === "text"
                    ) {
                      return String((c as { text?: string }).text ?? "");
                    }
                    return "";
                  })
                  .join("\r\n");
              }
              return `${role}: ${content}`;
            })
            .join("\r\n\r\n");
          for await (const chunk of llmStreamText({
            provider: tierAResolved.provider,
            model_id: tierA.model_id,
            system: systemPrompt.text,
            user: flatUser || userText,
            maxTokens,
            useCaching: systemPrompt.applied
          })) {
            if (chunk.delta) {
              if (firstTokenAt == null) firstTokenAt = Date.now();
              assistantText += chunk.delta;
              controller.enqueue(encoder.encode(chunk.delta));
            }
            if (chunk.usage) answerUsage = chunk.usage;
          }
        }

        bumpUsageDaily(admin, {
          tier: "A",
          model_id: tierA.model_id,
          usage: answerUsage,
          feature: "chat_answer"
        });
        pushModelStep(modelSteps, admin, {
          label: "답변 생성",
          model: tierA.model_label,
          tier: "A",
          model_id: tierA.model_id,
          usage: answerUsage
        });
        modelSteps.push({
          label: "검색 횟수",
          model: `${searchRounds}회`,
          tier: ""
        });

        pushStep("answer", "done", "정리 완료");

        const llmMs = Date.now() - llmStartedAt;
        const firstTokenMs =
          firstTokenAt != null ? firstTokenAt - llmStartedAt : null;
        const durationMs = Date.now() - startedAt;
        const safeAssistantText = scrubLunaAnswerText(
          sanitizeKnowledgeListAnswer(assistantText, learnings)
        );
        if (safeAssistantText !== assistantText) {
          assistantText = safeAssistantText;
        }
        {
          const hideUnused =
            notFoundFromAsk || isNotFoundAnswerText(assistantText);
          const kept = keepSourcesUsedInAnswer({
            cards,
            notion: notionSources,
            wiki: publicWikiSources,
            answer: assistantText,
            notFound: hideUnused
          });
          cards = kept.cards;
          notionSources = kept.notion;
          publicWikiSources = kept.wiki;
          if (hideUnused) {
            nasResults = [];
            wikiSources = [];
            privateWikiRefs = [];
          }
        }
        const webCardsUsed = webAugmented && cards.some((c) => c.type === "web");
        if (webCardsUsed && !assistantText.includes("웹 검색으로 보강함")) {
          const note = "\r\n\r\n웹 검색으로 보강함";
          assistantText = `${assistantText.trim()}${note}`;
          controller.enqueue(encoder.encode(note));
        }
        if (knowledgeInject.matched.length > 0) {
          const nowIso = new Date().toISOString();
          void (async () => {
            try {
              await Promise.all(
                knowledgeInject.matched
                  .filter((row) =>
                    learningUsedInAnswer(row, assistantText, injectKeywords)
                  )
                  .map((row) =>
                    admin
                      .from("luna_learnings")
                      .update({
                        use_count: (row.use_count ?? 0) + 1,
                        last_used_at: nowIso
                      })
                      .eq("id", row.id)
                  )
              );
            } catch (err) {
              console.error("[luna/chat] bump learning use_count", err);
            }
          })();
        }
        const usedWikiSlugs = Array.from(
          new Set(
            wikiSources
              .filter((hit) => wikiSourceUsedInAnswer(hit, assistantText))
              .map((hit) => hit.slug)
          )
        );
        if (usedWikiSlugs.length > 0) {
          void bumpWikiUseCount(admin, usedWikiSlugs).catch((err) =>
            console.error("[luna/chat] bump wiki use_count", err)
          );
        } else if (libraryHits.length > 0) {
          void bumpWikiUseCount(
            admin,
            libraryHits.map((i) => i.slug)
          ).catch((err) => console.error("[luna/chat] bump wiki use_count", err));
        }
        const userMeta: Record<string, unknown> = {};
        const timingEmbedMs =
          (knowledgeEmb.embed_ms ?? 0) +
          (notionSearchOutcome?.timings?.embed_ms ?? 0);
        const timingSearchMs = notionSearchOutcome?.timings?.search_ms ?? 0;
        const timingRerankMs = notionSearchOutcome?.timings?.rerank_ms ?? 0;
        const timingLinkMs = notionSearchOutcome?.secondary?.link_ms ?? 0;
        const timingCandidatesFound =
          notionSearchOutcome?.timings?.candidates_found ??
          Math.max(
            0,
            notionSources.length -
              (notionSearchOutcome?.secondary?.link_added ?? 0)
          );
        const timingCandidatesAdded =
          notionSearchOutcome?.secondary?.link_added ?? 0;
        const timingCandidatesUsed = notionForLlm.length;
        const costKrw = estimateUsageKrw(
          tierA.model_id,
          {
            inputTokens: answerUsage.input_tokens,
            outputTokens: answerUsage.output_tokens,
            cacheWriteTokens: answerUsage.cache_creation_input_tokens,
            cacheReadTokens: answerUsage.cache_read_input_tokens
          },
          USD_KRW_FALLBACK
        ).krw;
        const responseTimings = {
          embed_ms: timingEmbedMs,
          search_ms: timingSearchMs,
          link_ms: timingLinkMs,
          rerank_ms: timingRerankMs,
          llm_ms: llmMs,
          first_token_ms: firstTokenMs,
          prep_ms: Math.max(0, durationMs - llmMs),
          loads_ms: Math.max(0, loadsDoneAt - startedAt),
          prep_loads: prepLoads,
          total_ms: durationMs,
          candidates_found: timingCandidatesFound,
          candidates_added: timingCandidatesAdded,
          candidates_used: timingCandidatesUsed,
          prompt_tokens: answerUsage.input_tokens,
          completion_tokens: answerUsage.output_tokens,
          model: tierA.model_id,
          cost_krw: costKrw > 0 ? costKrw : null
        };
        const assistantMeta: Record<string, unknown> = {
          model_label: tierA.model_label,
          duration_ms: durationMs,
          timings: responseTimings,
          classify_source: classifySource,
          classification_label: searchScope.label,
          progress_keywords: keywords.slice(0, 120),
          model_steps: modelSteps,
          steps,
          search_rounds: searchRounds,
          usage: {
            input_tokens: answerUsage.input_tokens,
            output_tokens: answerUsage.output_tokens,
            cache_creation_input_tokens: answerUsage.cache_creation_input_tokens,
            cache_read_input_tokens: answerUsage.cache_read_input_tokens
          }
        };
        if (clarifyFollowupQuery) {
          assistantMeta.clarify_followup = true;
          assistantMeta.search_intent = searchIntentText;
        }
        if (listingQuestion) {
          assistantMeta.listing_question = true;
        }
        assistantMeta.slim_listing_prompt = Boolean(
          listingReferenceDisablesNas(searchScope.kind, listingQuestion)
        );
        assistantMeta.search_scope = {
          kind: searchScope.kind,
          tier: searchScope.tier,
          nas: searchScope.flags.nas,
          media: searchScope.flags.media
        };
        if (
          perspectiveIds.length > 0 ||
          roleIds.length > 0 ||
          taskIds.length > 0
        ) {
          userMeta.skills = {
            perspective_ids: perspectiveIds,
            role_ids: roleIds,
            task_ids: taskIds
          };
          assistantMeta.skills = {
            perspective_ids: perspectiveIds,
            role_ids: roleIds,
            task_ids: taskIds
          };
        }
        if (notionSources.length > 0) {
          assistantMeta.notion_sources = notionSources;
        }
        const usedPrivateRefs = privateWikiRefs.filter((hit) =>
          wikiSourceUsedInAnswer(hit, assistantText)
        );
        if (publicWikiSources.length > 0) {
          assistantMeta.wiki_sources = publicWikiSources;
        }
        if (usedPrivateRefs.length > 0) {
          assistantMeta.private_wiki_refs = usedPrivateRefs;
        }

        try {
          const { data: askerProfile } = await admin
            .from("profiles")
            .select("name")
            .eq("id", user.id)
            .maybeSingle();
          const askerName =
            typeof askerProfile?.name === "string" && askerProfile.name.trim()
              ? askerProfile.name.trim()
              : null;
          await captureTermMeaningQuestion({
            admin,
            userId: user.id,
            userName: askerName,
            conversationId,
            question: userText,
            answer: assistantText,
            classifiedTypes: classification.types,
            glossaryRows,
            skipKnownSources:
              publicWikiSources.length > 0 || knowledgeInject.ids.length > 0
          });
        } catch (err) {
          console.error("[luna/chat] capture term question", err);
        }
        if (wsToolCalls.length > 0) {
          assistantMeta.ws_tool_calls = wsToolCalls;
        }
        if (usedReportId) {
          assistantMeta.used_report_id = usedReportId;
        }
        if (cards.length > 0) {
          assistantMeta.cards = cards;
        }
        if (sourceReasons) {
          assistantMeta.source_reasons = sourceReasons;
        }
        assistantMeta.used_prompts = usedPrompts;
        assistantMeta.classification = classificationPublic(
          classification,
          questionTypes
        );
        assistantMeta.search_scope = {
          kind: searchScope.kind,
          label: searchScope.label,
          tier: searchScope.tier,
          flags: searchScope.flags
        };
        if (connectorRouting) {
          assistantMeta.connector_routing = {
            nas: nasEnabled,
            notion: notionEnabled,
            web: webEnabled,
            reason: connectorRouting.reason,
            reason_label: connectorRouting.reasonLabel,
            summary: formatConnectorRoutingSummary(connectorRouting)
          };
        }
        assistantMeta.auto_routing = autoRoutingUsed;
        assistantMeta.memory_count = learnings.length;
        assistantMeta.injected_knowledge_ids = knowledgeInject.ids;
        assistantMeta.injected_terms = injectedTerms;
        if (webAugmented) assistantMeta.web_augmented = true;
        if (attachmentMeta.length > 0) {
          userMeta.attachments = attachmentMeta;
          assistantMeta.attachments = attachmentMeta;
        }

        const showScores = await isAnswerScoresVisible(admin);
        assistantMeta.answer_scores_visible = showScores;
        const selfScore = scoreEvidenceMatch({
          retrieved: evidenceCounts.retrieved,
          matching: evidenceCounts.matching,
          askedClear: namedProjectLock,
          notFound: notFoundFromAsk || isNotFoundAnswerText(assistantText)
        });
        assistantMeta.intent_score = selfScore.intent_score;
        assistantMeta.confidence_score = selfScore.confidence_score;
        assistantMeta.self_note = selfScore.self_note;

        try {
          const memoryAsk = await maybeProposeMemoryAsk(admin, {
            userId: user.id,
            userText,
            assistantText,
            memo: userMemory?.memo ?? null
          });
          if (memoryAsk) {
            assistantMeta.memory_ask = memoryAsk;
          }
        } catch (err) {
          console.error("[luna/chat] memory ask", err);
        }

        const insertNow = Date.now();
        const { error: insertError } = await admin.from("luna_messages").insert([
          {
            id: userMessageId,
            conversation_id: conversationId,
            role: "user",
            content: userText,
            engine: usedEngine,
            metadata: userMeta,
            created_at: new Date(insertNow - 1000).toISOString()
          },
          {
            id: assistantMessageId,
            conversation_id: conversationId,
            role: "assistant",
            content: assistantText,
            engine: usedEngine,
            metadata: assistantMeta,
            created_at: new Date(insertNow).toISOString()
          }
        ]);

        if (insertError) {
          console.error("[luna/chat] insert messages", insertError);
        } else {
          recordResponseTiming(admin, {
            message_id: assistantMessageId,
            conversation_id: conversationId,
            user_id: user.id,
            ...responseTimings
          });
          recordAnswerFlagsAsync(admin, {
            message_id: assistantMessageId,
            question: searchIntentText || userText,
            intent_score: selfScore?.intent_score ?? null,
            confidence_score: selfScore?.confidence_score ?? null,
            duration_ms: durationMs,
            search_ms: responseTimings.search_ms,
            embed_ms: responseTimings.embed_ms,
            link_ms: responseTimings.link_ms,
            llm_ms: responseTimings.llm_ms,
            candidates_found: responseTimings.candidates_found,
            candidates_used: responseTimings.candidates_used,
            notion_n: notionSources.length,
            wiki_n: publicWikiSources.length,
            nas_n: 0,
            glossary_n: glossaryRows.length,
            memory_n: learnings.length,
            source: "chat"
          });
          void recordAutoFailuresFromAnswer(admin, {
            messageId: assistantMessageId,
            conversationId,
            askedBy: user.id,
            question: searchIntentText,
            answer: assistantText,
            intentScore: selfScore?.intent_score ?? null,
            confidenceScore: selfScore?.confidence_score ?? null,
            selfNote: selfScore?.self_note ?? null,
            types: classification.types,
            sourcesUsed: {
              wiki: publicWikiSources.length,
              notion: notionSources.length,
              memory: learnings.length,
              cards: cards.length
            },
            durationMs,
            classifyConfidence: classification.confidence,
            searchAttempted: searchRounds > 0,
            searchResultCount:
              cards.length + notionSources.length + publicWikiSources.length,
            sourceRef: {
              last_had_clarify: lastHadClarify,
              clarify_followup: Boolean(clarifyFollowupQuery)
            }
          }).catch((err) =>
            console.error("[luna/chat] auto failures", err)
          );
        }
        if (!insertError && usedPrivateRefs.length > 0) {
          const { data: profileRow } = await admin
            .from("profiles")
            .select("name")
            .eq("id", user.id)
            .maybeSingle();
          const userName =
            typeof profileRow?.name === "string" && profileRow.name.trim()
              ? profileRow.name.trim()
              : "알 수 없음";
          void checkAndNotifyPrivateWikiOveruse(admin, {
            conversationId,
            userName,
            usedPrivateRefs
          }).catch((err) =>
            console.error("[luna/chat] private wiki overuse", err)
          );
        }

        await touchConversation();
        scheduleConversationTitle(admin, conversationId);
        scheduleUserMemoRewrite(admin, user.id);
        controller.close();
      } catch (err) {
        console.error("[luna/chat] stream", err);
        const msg = err instanceof Error ? err.message : "Stream failed";
        try {
          controller.enqueue(encoder.encode(`\r\n\r\n[오류] ${msg}`));
        } catch {
          /* already closed */
        }
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Luna-Engine": usedEngine
    }
  });
}
