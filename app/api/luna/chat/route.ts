import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { runAnalysisPipeline } from "@/lib/luna/analysis";
import { LUNA_DEFAULT_IDENTITY_PROMPT } from "@/lib/luna/constants";
import {
  bumpUsageDaily,
  getTierModel,
  readUsage,
  resolveAnthropicModel,
  type LunaUsageTokens
} from "@/lib/luna/engine";
import {
  mergeNotionSearchOutcomes,
  searchNotionPages,
  type NotionSearchOutcome,
  type NotionSearchStatus,
  type NotionSource
} from "@/lib/luna/notion";
import {
  getPrompts,
  LUNA_PROMPT_KEYS,
  LUNA_RUNTIME_PROMPT_KEYS,
  type LunaPromptKind,
  type LunaPromptLevel
} from "@/lib/luna/prompts";
import { searchTavily, type LunaCard } from "@/lib/luna/tavily";
import { scheduleConversationTitle } from "@/lib/luna/conversation-title";
import {
  bumpReportUse,
  findSimilarReport
} from "@/lib/luna/selfstudy";
import {
  listFolder,
  prepareSearchTerms,
  refineWorkserverHits,
  runWorkserverResultPipeline,
  searchAll,
  searchIn,
  searchNasLegacy,
  type WorkserverItem
} from "@/lib/luna/workserver";
import { searchYoutube } from "@/lib/luna/youtube";
import { parseNumberedChoices } from "@/lib/luna/chat-response";
import {
  hasManualConnectors,
  hasManualSkills,
  matchPerspectiveIdByDepartment,
  resolveConnectorsAuto,
  type ConnectorFlags
} from "@/lib/luna/connector-routing";
import { buildUsedPromptRefs } from "@/lib/luna/used-prompts";

export const runtime = "nodejs";

const KEYWORD_EXTRACT_FALLBACK =
  "사용자의 메시지에서 웹/노션/유튜브 검색에 쓸 핵심 키워드만 짧게 추출하세요. 검색어 문자열만 응답하고 다른 설명은 하지 마세요.";

const SYNTHESIS_OPINION_FALLBACK =
  "- 검색 결과 목록을 답변에 다시 나열하지 마세요. 화면에 이미 카드로 표시됩니다. 당신은 그 자료들을 종합한 판단과 의견만 쓰세요.";

const CLARIFY_FALLBACK =
  "사용자의 질문이 여러 방향으로 갈라질 수 있는지 판단하세요. 확실한 분기가 있을 때만 needs_clarify=true 로 하세요. JSON만 응답: {\"needs_clarify\":true|false,\"question\":\"...\",\"options\":[\"...\",\"...\",\"...\"]}";

const SELF_EVAL_FALLBACK =
  "질문과 찾은 자료 제목 목록을 보고 답변에 충분한지 판단하세요. JSON만: {\"sufficient\":true|false,\"missing\":\"부족하면 한 줄\"}";

const REQUERY_FALLBACK =
  "부족한 점을 보완할 새 검색어만 짧게 제안하세요. 검색어 문자열만 응답하세요.";

const SYNTHESIS_REASON_FALLBACK =
  "질문과 소스별 검색 결과를 보고, 각 소스를 왜 보여주는지 한 줄씩 쓰세요. JSON만: {\"notion\":\"...\",\"nas\":\"...\",\"web\":\"...\"}. 결과 없는 소스는 키를 생략. 각 값은 40자 이내. Work서버는 중요 표시가 아니라 왜 골랐는지에 집중.";

const SEARCH_REQUEST_KEYWORDS = ["찾아줘", "레퍼런스", "사례", "검색", "알려줘"] as const;
const SEARCH_BUDGET_MS = 45_000;
const MAX_SEARCH_ROUNDS = 3;
const WS_TOOL_LOOP_MS = 25_000;
const MAX_WS_TOOL_ROUNDS = 5;

const WORKSERVER_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_folder",
    description: "Work서버 특정 경로 바로 아래 항목 보기. 경로를 비우면 최상위",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        drive: { type: "string" }
      }
    }
  },
  {
    name: "search_in",
    description: "Work서버 특정 경로 아래에서만 검색",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        keywords: { type: "string" }
      },
      required: ["path", "keywords"]
    }
  },
  {
    name: "search_all",
    description: "Work서버 전체 검색. 어디를 볼지 모를 때만",
    input_schema: {
      type: "object",
      properties: {
        keywords: { type: "string" }
      },
      required: ["keywords"]
    }
  }
];

function isSearchRequestMessage(message: string): boolean {
  return SEARCH_REQUEST_KEYWORDS.some((kw) => message.includes(kw));
}

type NasDirectoryRow = {
  drive: string | null;
  path: string;
  type: string | null;
  size_bytes: number | null;
  modified_at: string | null;
  file_summary: string | null;
  importance?: number | null;
  variant_hidden?: number;
};

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

type LearningRow = { content: string; category: string };
type MessageRow = {
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
};

type StepStatus = "running" | "done" | "skip";
type StepRecord = { key: string; label: string; status: StepStatus };
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

const CACHE_MIN_CHARS = 1200;

function parseIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
}

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
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
  if (card.type === "nas") {
    if (card.raw_path) return `nas:${card.raw_path}`;
    let pathPart = card.description?.split(" · ")[0] || card.title;
    if (pathPart.startsWith("★ ")) pathPart = pathPart.slice(2);
    return `nas:${pathPart}`;
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

  const parts = [`질문:\n${question}`];
  if (notionTitles.length > 0) {
    parts.push(`노션:\n${notionTitles.map((t) => `- ${t}`).join("\n")}`);
  }
  if (nasLines.length > 0) {
    parts.push(`Work서버:\n${nasLines.join("\n")}`);
  }
  if (webTitles.length > 0) {
    parts.push(`웹:\n${webTitles.map((t) => `- ${t}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

/** clarify assistant 바로 앞 user 메시지 content */
function findClarifyOriginalUser(recent: MessageRow[]): string | null {
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const m = recent[i]!;
    if (m.role !== "assistant") continue;
    const meta = m.metadata;
    if (!meta || typeof meta !== "object" || !meta.clarify) continue;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (recent[j]!.role === "user") {
        const content = recent[j]!.content?.trim();
        return content || null;
      }
    }
  }
  return null;
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

function buildStableSystemText(opts: {
  identity: string;
  learnings: LearningRow[];
  skillPrompt?: string | null;
  connectorPrompts?: string[];
}): string {
  const parts: string[] = [opts.identity.trim() || LUNA_DEFAULT_IDENTITY_PROMPT];

  if (opts.learnings.length > 0) {
    const learningBlock = opts.learnings
      .map((l) => `- ${l.content} (${l.category})`)
      .join("\n");
    parts.push(`[아폴론에 대해 알고 있는 것]\n${learningBlock}`);
  }

  for (const block of opts.connectorPrompts ?? []) {
    if (block.trim()) parts.push(block.trim());
  }

  if (opts.skillPrompt?.trim()) {
    parts.push(opts.skillPrompt.trim());
  }

  return parts.join("\n\n");
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
}): string {
  const parts: string[] = [];

  if (opts.reportContent?.trim()) {
    parts.push(`[이미 정리해둔 자료]\n${opts.reportContent.trim()}`);
  }

  if (opts.notionSources && opts.notionSources.length > 0) {
    const notionBlock = opts.notionSources
      .map((s) => `- ${s.title}: ${s.url}`)
      .join("\n");
    parts.push(`[노션 검색 결과]\n${notionBlock}`);
  } else if (opts.notionSearchAttempted) {
    if (opts.notionSearchStatus === "error") {
      parts.push("[노션 검색] 호출 실패 — 결과를 확인하지 못함");
    } else if (opts.notionSearchStatus === "empty") {
      const n = opts.notionSearchRounds ?? 0;
      parts.push(`[노션 검색] ${n}회 검색, 결과 0건`);
    }
  }

  if (opts.cards && opts.cards.length > 0) {
    const cardBlock = opts.cards
      .map((c) =>
        c.url ? `- [${c.type}] ${c.title}: ${c.url}` : `- [${c.type}] ${c.title}: ${c.description}`
      )
      .join("\n");
    parts.push(`[검색 레퍼런스]\n${cardBlock}`);
  }

  const nasResults = opts.nasResults ?? [];
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
        "아래 경로만이 실측된 경로다. 이 목록에 없는 경로는 존재를 모르는 것이다.\n" +
        nasBlock
    );
  } else if (opts.nasSearchAttempted) {
    parts.push(
      "[Work서버 파일 위치]\n(검색 결과 없음 — 아래 규칙 3 적용)"
    );
  }

  const opinionRule = opts.synthesisOpinion?.trim() || SYNTHESIS_OPINION_FALLBACK;

  parts.push(
    "[답변 규칙]\n" +
      "- 위에 제공된 검색 결과가 있으면 그것을 근거로 답하세요.\n" +
      "- 검색 결과가 없으면 반드시 '찾지 못했다'고 명확히 답한다.\n" +
      "  - 경로·파일명·폴더명을 절대 추측하거나 조합해서 만들지 않는다. 검색 결과에 없는 T:\\ 또는 P:\\ 경로를 답변에 쓰는 것은 금지다.\n" +
      "  - 대신 할 수 있는 것: ①검색 중 발견한 인접 자료(비슷한 프로젝트·상위 폴더)를 '대신 이런 것은 있다'로 제시 ②더 정확한 검색어 제안 ③담당자 확인 권유\n" +
      "  - '기능 준비 중/연동 안 됨' 같은 표현은 여전히 금지\n" +
      `${opinionRule.startsWith("-") ? opinionRule : `- ${opinionRule}`}\n` +
      "- 답변은 아폴론의 과거 프로젝트 맥락과 연결해서 구체적으로 쓰세요."
  );

  return parts.join("\n\n");
}

function buildAnswerSystem(
  opts: {
    identity: string;
    learnings: LearningRow[];
    skillPrompt?: string | null;
    connectorPrompts?: string[];
    synthesisOpinion?: string;
    notionSources?: NotionSource[];
    cards?: LunaCard[];
    nasResults?: NasDirectoryRow[];
    nasSearchAttempted?: boolean;
    reportContent?: string | null;
    notionSearchAttempted?: boolean;
    notionSearchStatus?: NotionSearchStatus;
    notionSearchRounds?: number;
  },
  useCaching: boolean
): string | Anthropic.TextBlockParam[] {
  const stable = buildStableSystemText(opts);
  const volatile = buildVolatileSystemText(opts);
  const cacheBlockLength = stable.length;
  const applied = useCaching && cacheBlockLength >= CACHE_MIN_CHARS;

  console.log("[luna/cache]", {
    useCaching,
    cacheBlockLength,
    applied
  });

  if (applied) {
    return [
      {
        type: "text",
        text: stable,
        cache_control: { type: "ephemeral" }
      },
      {
        type: "text",
        text: volatile
      }
    ];
  }

  return [stable, volatile].filter(Boolean).join("\n\n");
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
  controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const client = getAnthropicClient();
  if (!client) {
    return NextResponse.json({ error: "Claude API key is not configured" }, { status: 500 });
  }

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

  const [
    profileResult,
    perspectivesResult,
    tierACfg,
    tierBCfg,
    l3PromptResult
  ] = await Promise.all([
    admin.from("profiles").select("department").eq("id", user.id).maybeSingle(),
    admin
      .from("luna_prompts")
      .select("id, title, kind")
      .eq("level", "L2")
      .eq("kind", "perspective")
      .eq("is_active", true),
    getTierModel(admin, "A"),
    getTierModel(admin, "B"),
    admin
      .from("luna_prompts")
      .select("prompt_key, title, level, sort_order, kind")
      .in("prompt_key", [
        "talk.understand",
        "talk.assume",
        "talk.search",
        "talk.answer"
      ])
      .eq("is_active", true)
  ]);

  if (profileResult.error) {
    console.error("[luna/chat] profile", profileResult.error);
  }
  if (perspectivesResult.error) {
    console.error("[luna/chat] perspectives", perspectivesResult.error);
  }
  if (l3PromptResult.error) {
    console.error("[luna/chat] l3 prompts", l3PromptResult.error);
  }

  const profile = profileResult.data;
  const perspectives = perspectivesResult.data ?? [];
  const l3PromptRows = l3PromptResult.data ?? [];

  const manualSkillIds = {
    perspective_ids: perspectiveIds,
    role_ids: roleIds,
    task_ids: taskIds
  };

  if (!hasManualSkills(manualSkillIds)) {
    const matched = matchPerspectiveIdByDepartment(
      profile?.department,
      perspectives
    );
    if (matched) {
      perspectiveIds = [matched];
    }
  }

  if (!hasManualConnectors(manualConnectorFlags)) {
    const resolved = resolveConnectorsAuto(routingMessage, {
      hasAttachments,
      manual: manualConnectorFlags
    });
    notionEnabled = resolved.notion;
    webEnabled = resolved.web;
    nasEnabled = resolved.nas;
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
  const tierA = resolveAnthropicModel(tierACfg);
  const tierB = resolveAnthropicModel(tierBCfg);

  const loadedPrompts = await getPrompts(admin, [...LUNA_RUNTIME_PROMPT_KEYS]);

  const identity =
    loadedPrompts[LUNA_PROMPT_KEYS.identity]?.trim() || LUNA_DEFAULT_IDENTITY_PROMPT;
  const talkSearch = loadedPrompts[LUNA_PROMPT_KEYS.search]?.trim() || "";
  const talkAnswer = loadedPrompts[LUNA_PROMPT_KEYS.answer]?.trim() || "";
  const talkAssume = loadedPrompts[LUNA_PROMPT_KEYS.assume]?.trim() || "";
  // 키워드/자체평가/재검색은 구조화 출력이 필요해 FALLBACK 유지. 검색 원칙은 talk.search.
  const keywordExtractPrompt = KEYWORD_EXTRACT_FALLBACK;
  const clarifyPrompt =
    loadedPrompts[LUNA_PROMPT_KEYS.understand]?.trim() || CLARIFY_FALLBACK;
  const selfEvalPrompt = SELF_EVAL_FALLBACK;
  console.log(
    "[luna/prompt] self_eval len",
    selfEvalPrompt.length,
    selfEvalPrompt.slice(0, 60)
  );
  const requeryPrompt = REQUERY_FALLBACK;
  const synthesisOpinion =
    [talkAnswer, talkAssume].filter(Boolean).join("\n\n") ||
    SYNTHESIS_OPINION_FALLBACK;
  const synthesisReason = SYNTHESIS_REASON_FALLBACK;
  const webSearchHint = "";

  const connectorPrompts: string[] = [];
  if ((notionEnabled || nasEnabled || webEnabled) && talkSearch) {
    connectorPrompts.push(talkSearch);
  }

  // 주입 안전: status='active' 만. candidate 는 절대 주입하지 않음.
  const { data: learningsData, error: learningsError } = await admin
    .from("luna_learnings")
    .select("id, content, category, use_count")
    .eq("status", "active")
    .neq("category", "identity")
    .order("importance", { ascending: false })
    .order("use_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (learningsError) {
    console.error("[luna/chat] learnings", learningsError);
    return NextResponse.json({ error: learningsError.message }, { status: 500 });
  }
  type LearningInjectRow = LearningRow & { id: string; use_count: number | null };
  const learningsRows = (learningsData ?? []) as LearningInjectRow[];
  const learnings = learningsRows.map((l) => ({
    content: l.content,
    category: l.category
  }));

  if (learningsRows.length > 0) {
    const nowIso = new Date().toISOString();
    void (async () => {
      try {
        await Promise.all(
          learningsRows.map((row) =>
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

  let skillPrompt: string | null = null;
  const l2SkillRows: Array<{
    title: string;
    level: LunaPromptLevel;
    sort_order: number;
    kind: LunaPromptKind;
  }> = [];
  if (skillIds.length > 0) {
    const { data: skillData, error: skillError } = await admin
      .from("luna_prompts")
      .select("id, title, kind, content, is_active, sort_order")
      .in("id", skillIds)
      .eq("level", "L2");

    if (skillError) {
      console.error("[luna/chat] prompts skills", skillError);
      return NextResponse.json({ error: skillError.message }, { status: 500 });
    }
    const byId = new Map(
      ((skillData ?? []) as PromptSkillRow[])
        .filter((s) => s.is_active)
        .map((s) => [s.id, s])
    );
    const blocks: string[] = [];
    for (const id of perspectiveIds) {
      const row = byId.get(id);
      if (!row || row.kind !== "perspective") continue;
      blocks.push(`[관점 · ${row.title}]\n${row.content}`);
      l2SkillRows.push({
        title: row.title,
        level: "L2",
        sort_order: row.sort_order ?? 0,
        kind: row.kind as LunaPromptKind
      });
    }
    for (const id of roleIds) {
      const row = byId.get(id);
      if (!row || row.kind !== "role") continue;
      blocks.push(`[역할 · ${row.title}]\n${row.content}`);
      l2SkillRows.push({
        title: row.title,
        level: "L2",
        sort_order: row.sort_order ?? 0,
        kind: row.kind as LunaPromptKind
      });
    }
    for (const id of taskIds) {
      const row = byId.get(id);
      if (!row || row.kind !== "task") continue;
      blocks.push(`[작업 · ${row.title}]\n${row.content}`);
      l2SkillRows.push({
        title: row.title,
        level: "L2",
        sort_order: row.sort_order ?? 0,
        kind: row.kind as LunaPromptKind
      });
    }
    skillPrompt = blocks.length > 0 ? blocks.join("\n\n") : null;
  }

  let attachments: AttachmentRow[] = [];
  if (hasAttachments) {
    const { data: attData, error: attError } = await admin
      .from("luna_attachments")
      .select("id, storage_path, file_name, mime_type")
      .eq("user_id", user.id)
      .in("id", attachmentIds);

    if (attError) {
      console.error("[luna/chat] attachments", attError);
      return NextResponse.json({ error: attError.message }, { status: 500 });
    }
    attachments = (attData ?? []) as AttachmentRow[];
    if (attachments.length === 0) {
      return NextResponse.json({ error: "Attachments not found" }, { status: 404 });
    }
  }

  const { data: recentData, error: recentError } = await admin
    .from("luna_messages")
    .select("role, content, metadata")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (recentError) {
    console.error("[luna/chat] messages", recentError);
    return NextResponse.json({ error: recentError.message }, { status: 500 });
  }

  const recent = ((recentData ?? []) as MessageRow[]).reverse();
  const lastAssistant = [...recent].reverse().find((m) => m.role === "assistant");
  const lastHadClarify = Boolean(
    lastAssistant?.metadata &&
      typeof lastAssistant.metadata === "object" &&
      lastAssistant.metadata.clarify
  );
  const clarifyOriginalUser = lastHadClarify
    ? findClarifyOriginalUser(recent)
    : null;

  const userText =
    message || (hasAttachments ? "첨부한 파일을 분석해 주세요." : "");
  const searchIntentText =
    lastHadClarify && clarifyOriginalUser
      ? `원래 질문: ${clarifyOriginalUser}\n확인된 조건: ${userText}`
      : userText;
  const attachmentMeta = attachments.map((a) => ({
    id: a.id,
    file_name: a.file_name,
    mime_type: a.mime_type
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const steps: StepRecord[] = [];
      const modelSteps: ModelStep[] = [];
      let searchRounds = 0;
      let clarifyRan = false;
      let searchRan = false;

      const pushStep = (key: string, status: StepStatus, label: string) => {
        const idx = steps.findIndex((s) => s.key === key);
        const rec = { key, status, label };
        if (idx >= 0) steps[idx] = rec;
        else steps.push(rec);
        emit(controller, encoder, { type: "step", key, status, label });
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
        if (perspectiveIds.length + roleIds.length >= 2) {
          await runAnalysisPipeline({
            controller,
            encoder,
            client,
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
            tierB,
            perspectiveIds,
            roleIds,
            taskIds,
            notionEnabled,
            webEnabled,
            nasEnabled,
            hasAttachments,
            attachments,
            attachmentMeta
          });
          return;
        }

        // ——— 단계 1: 되묻기 ———
        const skipClarify =
          hasAttachments || lastHadClarify || skillIds.length > 0;

        if (skipClarify) {
          pushStep("clarify", "skip", "의도 확인");
        } else {
          clarifyRan = true;
          pushStep("clarify", "running", "의도 확인 중");
          let needsClarify = false;
          let clarifyQuestion = "";
          let clarifyOptions: string[] = [];
          try {
            const clarifyRes = await client.messages.create({
              model: tierB.model_id,
              max_tokens: 512,
              system: clarifyPrompt,
              messages: [{ role: "user", content: userText }]
            });
            pushModelStep(modelSteps, admin, {
              label: "되묻기 판단",
              model: tierB.model_label,
              tier: "B",
              model_id: tierB.model_id,
              usage: readUsage(clarifyRes.usage)
            });
            const raw =
              clarifyRes.content.find((p) => p.type === "text")?.text?.trim() ?? "";
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
                conversation_id: conversationId,
                role: "user",
                content: userText,
                engine: usedEngine,
                metadata: userMeta,
                created_at: new Date(clarifyNow - 1000).toISOString()
              },
              {
                conversation_id: conversationId,
                role: "assistant",
                content: clarifyQuestion,
                engine: usedEngine,
                metadata: {
                  clarify: { question: clarifyQuestion, options: clarifyOptions },
                  steps,
                  model_steps: modelSteps,
                  model_label: tierB.model_label,
                  duration_ms: Date.now() - startedAt
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

        // ——— 단계 2~5: 검색 루프 ———
        const isSearchRequest =
          !hasAttachments &&
          (isSearchRequestMessage(userText) ||
            (Boolean(clarifyOriginalUser) &&
              isSearchRequestMessage(clarifyOriginalUser!)));
        const anySearch =
          notionEnabled || webEnabled || nasEnabled || isSearchRequest;

        let notionSources: NotionSource[] = [];
        let notionSearchOutcome: NotionSearchOutcome | null = null;
        let cards: LunaCard[] = [];
        let nasResults: NasDirectoryRow[] = [];
        let keywords = "";
        let usedReportId: string | null = null;
        let usedReportContent: string | null = null;
        const previousKeywords: string[] = [];
        const wsToolCalls: Array<{
          tool: string;
          input: unknown;
          result_count: number;
        }> = [];

        const workserverExploreSystem =
          talkSearch ||
          "Work서버 폴더를 단계적으로 탐색해 관련 자료를 찾으세요.";

        const itemToNasRow = (item: WorkserverItem): NasDirectoryRow => ({
          drive: item.drive,
          path: item.path,
          type: item.type,
          size_bytes: null,
          modified_at: item.modified_at,
          file_summary: item.file_summary,
          importance: item.importance,
          variant_hidden: item.variant_hidden
        });

        const exploreWorkserverWithTools = async (
          kw: string
        ): Promise<NasDirectoryRow[]> => {
          const loopStarted = Date.now();
          const collected = new Map<string, NasDirectoryRow>();
          const seedTerms = prepareSearchTerms(kw, searchIntentText);
          const hintKeywords =
            seedTerms.join(" ") || kw.trim() || searchIntentText;

          if (seedTerms.length > 0) {
            try {
              const seeded = await searchAll(
                admin,
                hintKeywords,
                searchIntentText
              );
              for (const item of seeded) {
                const key = `${item.drive ?? ""}::${item.path}`;
                if (!collected.has(key)) {
                  collected.set(key, itemToNasRow(item));
                }
              }
              console.log("[luna/ws] seed search", { hintKeywords }, "→", seeded.length);
            } catch (seedErr) {
              console.error("[luna/ws] seed search", seedErr);
            }
          }

          const messages: Anthropic.MessageParam[] = [
            {
              role: "user",
              content: `질문: ${searchIntentText}\n검색 키워드 힌트: ${hintKeywords}\n(프로젝트명·문서명만 space로 구분해 search_all/search_in keywords에 넣으세요. 위치·알려줘 등은 제외)`
            }
          ];

          for (let round = 0; round < MAX_WS_TOOL_ROUNDS; round += 1) {
            if (Date.now() - loopStarted > WS_TOOL_LOOP_MS) break;

            const res = await client.messages.create({
              model: tierB.model_id,
              max_tokens: 1024,
              system:
                workserverExploreSystem ||
                "Work서버 폴더를 단계적으로 탐색해 관련 자료를 찾으세요.",
              tools: WORKSERVER_TOOLS,
              messages
            });

            pushModelStep(modelSteps, admin, {
              label: "Work서버 탐색",
              model: tierB.model_label,
              tier: "B",
              model_id: tierB.model_id,
              usage: readUsage(res.usage)
            });

            const toolUses = res.content.filter(
              (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
            );

            if (toolUses.length === 0) break;

            messages.push({ role: "assistant", content: res.content });

            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const tu of toolUses) {
              pushStep(
                "ws",
                "running",
                `Work서버 탐색 · ${tu.name}`
              );

              const input =
                tu.input && typeof tu.input === "object"
                  ? (tu.input as Record<string, unknown>)
                  : {};

              let items: WorkserverItem[] = [];
              try {
                if (tu.name === "list_folder") {
                  items = await listFolder(
                    admin,
                    typeof input.path === "string" ? input.path : "",
                    typeof input.drive === "string" ? input.drive : undefined
                  );
                } else if (tu.name === "search_in") {
                  items = await searchIn(
                    admin,
                    typeof input.path === "string" ? input.path : "",
                    typeof input.keywords === "string" ? input.keywords : "",
                    typeof input.drive === "string" ? input.drive : undefined,
                    searchIntentText
                  );
                } else if (tu.name === "search_all") {
                  items = await searchAll(
                    admin,
                    typeof input.keywords === "string" ? input.keywords : "",
                    searchIntentText
                  );
                }
              } catch (toolErr) {
                console.error("[luna/ws] tool exec", tu.name, toolErr);
                items = [];
              }

              wsToolCalls.push({
                tool: tu.name,
                input,
                result_count: items.length
              });
              console.log("[luna/ws] tool", tu.name, input, "→", items.length);

              for (const item of items) {
                const key = `${item.drive ?? ""}::${item.path}`;
                if (!collected.has(key)) {
                  collected.set(key, itemToNasRow(item));
                }
              }

              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify(items)
              });
            }

            messages.push({ role: "user", content: toolResults });
          }

          if (wsToolCalls.length > 0) {
            pushStep("ws", "done", "Work서버 탐색");
          }

          return finalizeNasDirectoryRows(
            refineWorkserverHits(
              Array.from(collected.values()),
              searchIntentText
            )
          );
        };

        const skippedNotionOutcome = (): NotionSearchOutcome => ({ status: "skipped", sources: [], queries: [], rounds: 0 });
        const runConnectorSearch = async (kw: string) => {
          const [notionOutcome, webRes, youtubeRes, nasRes] = await Promise.all([
            notionEnabled && kw
              ? searchNotionPages(kw, searchIntentText)
              : Promise.resolve(skippedNotionOutcome()),
            webEnabled
              ? (() => {
                  const q = kw || searchIntentText;
                  console.log("[luna/search] keywords", q, "→ tavily");
                  return searchTavily(q, webSearchHint);
                })()
              : Promise.resolve([] as LunaCard[]),
            isSearchRequest && kw
              ? searchYoutube(kw)
              : Promise.resolve([] as LunaCard[]),
            (async () => {
              if (!nasEnabled) return [] as NasDirectoryRow[];
              try {
                return await exploreWorkserverWithTools(kw);
              } catch (err) {
                console.error(
                  "[luna/ws] tool loop failed, fallback to legacy",
                  err
                );
                pushStep("ws", "done", "Work서버 탐색 (fallback)");
                const legacy = await searchNasLegacy(
                  admin,
                  kw || searchIntentText,
                  searchIntentText
                );
                return finalizeNasDirectoryRows(
                  refineWorkserverHits(legacy, searchIntentText)
                );
              }
            })()
          ]);

          const notionRes = notionOutcome.sources;
          const notionCards: LunaCard[] = notionRes.map((s) => ({
            type: "notion" as const,
            title: s.title,
            url: s.url,
            thumbnail: null,
            description: ""
          }));
          const nasCards = nasRes.map(toNasCard);
          return {
            notionSources: notionRes,
            notionOutcome,
            nasResults: nasRes,
            cards: [...notionCards, ...nasCards, ...webRes, ...youtubeRes],
            counts: {
              notion: notionRes.length,
              nas: nasRes.length,
              web: webRes.length
            }
          };
        };

        if (anySearch) {
          searchRan = true;
          const searchParts: string[] = [];
          if (notionEnabled) searchParts.push("노션");
          if (nasEnabled) searchParts.push("Work서버");
          if (webEnabled) searchParts.push("웹");
          const searchRunningLabel =
            searchParts.length > 0
              ? `${searchParts.join(" · ")} 검색 중`
              : "검색 중";

          pushStep("search", "running", searchRunningLabel);

          try {
            const kwRes = await client.messages.create({
              model: tierB.model_id,
              max_tokens: 64,
              system: keywordExtractPrompt,
              messages: [{ role: "user", content: searchIntentText || "문서" }]
            });
            pushModelStep(modelSteps, admin, {
              label: "검색어 추출",
              model: tierB.model_label,
              tier: "B",
              model_id: tierB.model_id,
              usage: readUsage(kwRes.usage)
            });
            const kwText =
              kwRes.content.find((p) => p.type === "text")?.text?.trim() ?? "";
            keywords =
              kwText.replace(/^["']|["']$/g, "").trim() ||
              searchIntentText.slice(0, 80);
          } catch (err) {
            console.error("[luna/chat] keyword extract", err);
            keywords = searchIntentText.slice(0, 80);
          }

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
              notionEnabled ? `노션 ${counts.notion}` : null,
              nasEnabled ? `Work서버 ${counts.nas}` : null,
              webEnabled ? `웹 ${counts.web}` : null
            ].filter(Boolean) as string[];
            if (parts.length === 0) return "검색 결과 없음";
            const allZero =
              (!notionEnabled || counts.notion === 0) &&
              (!nasEnabled || counts.nas === 0) &&
              (!webEnabled || counts.web === 0);
            return allZero ? "검색 결과 없음" : parts.join(" · ");
          };

          previousKeywords.push(keywords);
          searchRounds = 1;
          let batch = await runConnectorSearch(keywords);
          notionSources = batch.notionSources;
          notionSearchOutcome = batch.notionOutcome;
          nasResults = batch.nasResults;
          cards = batch.cards;

          pushStep("search", "done", formatSearchDoneLabel(batch.counts));

          // 자체 평가 + 재검색
          let sufficient = true;
          let missing = "";
          for (let round = 1; round <= MAX_SEARCH_ROUNDS; round += 1) {
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
                const evalRes = await client.messages.create({
                  model: tierB.model_id,
                  max_tokens: 256,
                  system: selfEvalPrompt,
                  messages: [
                    {
                      role: "user",
                      content: `질문:\n${searchIntentText}\n\n찾은 자료:\n${materialLines.join(
                        "\n"
                      )}`
                    }
                  ]
                });
                pushModelStep(modelSteps, admin, {
                  label: "자체 평가",
                  model: tierB.model_label,
                  tier: "B",
                  model_id: tierB.model_id,
                  usage: readUsage(evalRes.usage)
                });
                const evalRaw =
                  evalRes.content.find((p) => p.type === "text")?.text?.trim() ?? "";
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
              const reqRes = await client.messages.create({
                model: tierB.model_id,
                max_tokens: 64,
                system: requeryPrompt,
                messages: [
                  {
                    role: "user",
                    content: `원 질문:\n${searchIntentText}\n\n이전 검색어:\n${previousKeywords.join(
                      ", "
                    )}\n\n부족한 점:\n${missing || "관련 자료가 부족함"}`
                  }
                ]
              });
              pushModelStep(modelSteps, admin, {
                label: "재검색어 생성",
                model: tierB.model_label,
                tier: "B",
                model_id: tierB.model_id,
                usage: readUsage(reqRes.usage)
              });
              const reqText =
                reqRes.content.find((p) => p.type === "text")?.text?.trim() ?? "";
              newKeywords = reqText.replace(/^["']|["']$/g, "").trim();
            } catch (err) {
              console.error("[luna/chat] requery", err);
              pushStep("requery", "done", "검색어를 바꿔 다시 찾는 중");
              break;
            }

            if (
              !newKeywords ||
              previousKeywords.some(
                (k) => k.toLowerCase() === newKeywords.toLowerCase()
              )
            ) {
              pushStep("requery", "done", "검색어를 바꿔 다시 찾는 중");
              break;
            }

            previousKeywords.push(newKeywords);
            keywords = newKeywords;
            searchRounds += 1;
            pushStep("search", "running", searchRunningLabel);
            batch = await runConnectorSearch(keywords);
            notionSearchOutcome = notionSearchOutcome ? mergeNotionSearchOutcomes(notionSearchOutcome, batch.notionOutcome) : batch.notionOutcome;
            notionSources = [
              ...notionSources,
              ...batch.notionSources.filter(
                (s) => !notionSources.some((x) => x.url === s.url)
              )
            ];
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
            const recountCounts = {
              notion: cards.filter((c) => c.type === "notion").length,
              nas: cards.filter((c) => c.type === "nas").length,
              web: cards.filter((c) => c.type === "web").length
            };
            pushStep("requery", "done", "검색어를 바꿔 다시 찾는 중");
            pushStep("search", "done", formatSearchDoneLabel(recountCounts));
          }
        }

        // ——— 단계 6: 소스별 이유 + 답변 ———
        let sourceReasons: SourceReasons | null = null;
        const reasonUser = buildSourceReasonUserMessage(
          searchIntentText,
          cards,
          nasResults
        );
        if (reasonUser) {
          try {
            const reasonRes = await client.messages.create({
              model: tierB.model_id,
              max_tokens: 256,
              system: synthesisReason,
              messages: [{ role: "user", content: reasonUser }]
            });
            pushModelStep(modelSteps, admin, {
              label: "소스 이유",
              model: tierB.model_label,
              tier: "B",
              model_id: tierB.model_id,
              usage: readUsage(reasonRes.usage)
            });
            const reasonRaw =
              reasonRes.content.find((p) => p.type === "text")?.text?.trim() ??
              "";
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

        pushStep("answer", "running", "정리하는 중");

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
          contentBlocks.push({ type: "text", text: userText });
          historyMessages.push({ role: "user", content: contentBlocks });
        } else {
          historyMessages.push({ role: "user", content: userText });
        }

        const systemPrompt = buildAnswerSystem(
          {
            identity,
            learnings,
            skillPrompt,
            connectorPrompts,
            synthesisOpinion,
            notionSources,
            cards,
            nasResults,
            nasSearchAttempted: nasEnabled && anySearch,
            reportContent: usedReportContent,
            notionSearchAttempted: notionEnabled && anySearch,
            notionSearchStatus: notionSearchOutcome?.status,
            notionSearchRounds: notionSearchOutcome?.rounds ?? 0
          },
          tierACfg.use_caching === true
        );

        const usedPrompts = buildUsedPromptRefs({
          clarifyRan: steps.some(
            (s) => s.key === "clarify" && s.status === "done"
          ),
          searchRan:
            searchRounds > 0 || notionSources.length + cards.length > 0,
          answerRan: true,
          l3Rows: l3PromptRows,
          l2Skills: l2SkillRows
        });

        emit(controller, encoder, {
          type: "meta",
          cards,
          notion_sources: notionSources,
          search_rounds: searchRounds,
          steps,
          source_reasons: sourceReasons,
          memory_count: learningsRows.length,
          used_prompts: usedPrompts,
          auto_routing: autoRoutingUsed
        });

        let assistantText = "";
        const maxTokens = hasAttachments ? 8192 : 4096;
        const anthropicStream = client.messages.stream({
          model: tierA.model_id,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: historyMessages
        });

        anthropicStream.on("text", (textDelta) => {
          assistantText += textDelta;
          controller.enqueue(encoder.encode(textDelta));
        });

        const finalMsg = await anthropicStream.finalMessage();
        const answerUsage = readUsage(finalMsg.usage);
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

        const durationMs = Date.now() - startedAt;
        const userMeta: Record<string, unknown> = {};
        const assistantMeta: Record<string, unknown> = {
          model_label: tierA.model_label,
          duration_ms: durationMs,
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
        assistantMeta.auto_routing = autoRoutingUsed;
        assistantMeta.memory_count = learningsRows.length;
        if (attachmentMeta.length > 0) {
          userMeta.attachments = attachmentMeta;
          assistantMeta.attachments = attachmentMeta;
        }

        const insertNow = Date.now();
        const { error: insertError } = await admin.from("luna_messages").insert([
          {
            conversation_id: conversationId,
            role: "user",
            content: userText,
            engine: usedEngine,
            metadata: userMeta,
            created_at: new Date(insertNow - 1000).toISOString()
          },
          {
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
        }

        await touchConversation();
        scheduleConversationTitle(admin, conversationId);
        controller.close();
      } catch (err) {
        console.error("[luna/chat] stream", err);
        const msg = err instanceof Error ? err.message : "Stream failed";
        try {
          controller.enqueue(encoder.encode(`\n\n[오류] ${msg}`));
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
