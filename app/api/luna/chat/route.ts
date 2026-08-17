import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
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
import { llmStreamText } from "@/lib/luna/llm/client";
import {
  buildCachedSystem,
  formatGlossaryBlock,
  formatLearningsBlock,
  type CachedSystemPayload
} from "@/lib/luna/prompt-cache";
import {
  mergeNotionSearchOutcomes,
  searchNotionPages,
  type NotionSearchOutcome,
  type NotionSearchStatus,
  type NotionSource
} from "@/lib/luna/notion";
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
  bumpReportUse,
  findSimilarReport
} from "@/lib/luna/selfstudy";
import {
  runWorkserverResultPipeline
} from "@/lib/luna/workserver";
import {
  exploreWorkserverFallback,
  exploreWorkserverWithTools,
  type WorkserverExploreRow
} from "@/lib/luna/workserver-explore";
import { searchYoutube } from "@/lib/luna/youtube";
import { parseNumberedChoices } from "@/lib/luna/chat-response";
import {
  formatConnectorRoutingSummary,
  hasManualConnectors,
  hasManualSkills,
  resolveConnectorsAuto,
  type ConnectorFlags,
  type ConnectorRoutingResult
} from "@/lib/luna/connector-routing";
import { resolveDepartmentLens } from "@/lib/luna/department-lens";
import {
  isKnowledgeDumpRequest,
  KNOWLEDGE_DUMP_CLARIFY,
  KNOWLEDGE_LIST_HARD_RULE,
  sanitizeKnowledgeListAnswer,
  selectLearningsForInject
} from "@/lib/luna/knowledge-dump-guard";
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
  TYPE_FIND_FALLBACK,
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
  prompt_key: string | null;
  level: string | null;
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

function buildL3PromptBlock(opts: {
  understand?: string;
  assume?: string;
  search?: string;
  answer?: string;
}): string {
  return [opts.understand, opts.assume, opts.search, opts.answer]
    .map((s) => s?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

function buildAnswerSystem(
  opts: {
    identity: string;
    learnings: LearningRow[];
    glossaryBlock?: string;
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
  },
  useCaching: boolean,
  modelId: string
): CachedSystemPayload {
  const identity = opts.identity.trim() || LUNA_DEFAULT_IDENTITY_PROMPT;
  const structure =
    opts.workserverStructure?.trim() || WORKSERVER_STRUCTURE_FALLBACK;
  const block1 = [identity, structure].filter(Boolean).join("\n\n");
  const block2 = [opts.skillPrompt?.trim() ?? "", opts.l3Prompt?.trim() ?? ""]
    .filter(Boolean)
    .join("\n\n");
  const block3 = [
    formatLearningsBlock(opts.learnings),
    opts.glossaryBlock?.trim() ?? "",
    `[답변 안전]\n${KNOWLEDGE_LIST_HARD_RULE}`
  ]
    .filter(Boolean)
    .join("\n\n");
  const volatile = buildVolatileSystemText(opts);

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
    cacheChars: payload.cacheChars
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
}): string {
  const parts: string[] = [];

  if (opts.reportContent?.trim()) {
    parts.push(`[이미 정리해둔 자료]\n${opts.reportContent.trim()}`);
  }

  if (opts.notionSources && opts.notionSources.length > 0) {
    const notionBlock = opts.notionSources
      .map((s) => `- ${s.title} — ${s.url}`)
      .join("\n");
    parts.push(
      `[노션 검색 결과]\n${notionBlock}\n(답변 본문에 위 각 항목의 제목과 URL을 반드시 포함할 것. URL 없이 '노션에 정리되어 있다'고만 쓰지 말 것)`
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

  parts.push(
    "[답변 규칙]\n" +
      "- 위에 제공된 검색 결과가 있으면 그것을 근거로 답하세요.\n" +
      "- [노션 검색 결과]가 제공되면 각 페이지 제목과 URL을 답변 본문에 반드시 함께 쓴다.\n" +
      "- 검색 결과가 없으면 반드시 '찾지 못했다'고 명확히 답한다.\n" +
      "  - 경로·파일명·폴더명을 절대 추측하거나 조합해서 만들지 않는다. 검색 결과에 없는 T:\\ 또는 P:\\ 경로를 답변에 쓰는 것은 금지다.\n" +
      "  - 대신 할 수 있는 것: ①검색 중 발견한 인접 자료(비슷한 프로젝트·상위 폴더)를 '대신 이런 것은 있다'로 제시 ②더 정확한 검색어 제안 ③담당자 확인 권유\n" +
      "  - '기능 준비 중/연동 안 됨' 같은 표현은 여전히 금지\n" +
      `${SYNTHESIS_OPINION_FALLBACK}\n` +
      "- 답변은 아폴론의 과거 프로젝트 맥락과 연결해서 구체적으로 쓰세요."
  );

  return parts.join("\n\n");
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
    tierBCfg
  ] = await Promise.all([
    admin.from("profiles").select("department").eq("id", user.id).maybeSingle(),
    admin
      .from("luna_prompts")
      .select("id, title, kind, prompt_key")
      .eq("level", "L2")
      .eq("kind", "perspective")
      .eq("is_active", true),
    getTierModel(admin, "A"),
    getTierModel(admin, "B")
  ]);

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
    const resolved = await resolveDepartmentLens(admin, profile?.department);
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

  const promptRows = await getPromptRows(admin, [...LUNA_RUNTIME_PROMPT_KEYS]);
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
    .join("\n\n");
  const webSearchHint = "";

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
  const learningsRowsAll = (learningsData ?? []) as LearningInjectRow[];

  let glossaryBlock = "";
  {
    let gq = await admin
      .from("glossary_terms")
      .select("term_ko, definition")
      .is("deleted_at", null)
      .order("term_ko")
      .limit(60);
    if (gq.error) {
      gq = await admin
        .from("glossary_terms")
        .select("term_ko, definition")
        .order("term_ko")
        .limit(60);
    }
    if (gq.error) {
      console.error("[luna/chat] glossary", gq.error);
    } else {
      glossaryBlock = formatGlossaryBlock(
        (gq.data ?? []) as Array<{ term_ko?: string | null; definition?: string | null }>
      );
    }
  }

  if (learningsRowsAll.length > 0) {
    const nowIso = new Date().toISOString();
    void (async () => {
      try {
        await Promise.all(
          learningsRowsAll.slice(0, 10).map((row) =>
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
    prompt_key: string | null;
  }> = [];
  if (skillIds.length > 0) {
    const { data: skillData, error: skillError } = await admin
      .from("luna_prompts")
      .select("id, title, kind, content, is_active, sort_order, prompt_key, level")
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
        kind: row.kind as LunaPromptKind,
        prompt_key: row.prompt_key
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
        kind: row.kind as LunaPromptKind,
        prompt_key: row.prompt_key
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
        kind: row.kind as LunaPromptKind,
        prompt_key: row.prompt_key
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
  const knowledgeDumpRequested = isKnowledgeDumpRequest(userText);
  const learningsRows = selectLearningsForInject(learningsRowsAll, userText);
  const learnings = learningsRows.map((l) => ({
    content: l.content,
    category: l.category
  }));
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

        // ——— 단계 1: 되묻기 ———
        const skipClarify =
          hasAttachments ||
          lastHadClarify ||
          hasManualSkills(manualSkillIds) ||
          shouldSkipProjectClarify(userText);

        if (skipClarify) {
          pushStep("clarify", "skip", "의도 확인");
        } else {
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
                  used_prompts: usageLog.all()
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

        const workserverExploreSystem = typeFindPrompt;

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
            recordPromptUse(usageLog, {
              key: LUNA_PROMPT_KEYS.keywordExtract,
              step: "검색어 추출",
              title: "검색어 추출",
              row: keywordPick.row
            });
            logPromptInject({
              key: LUNA_PROMPT_KEYS.keywordExtract,
              step: "검색어 추출",
              source: keywordPick.source,
              text: keywordExtractPrompt
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

        const l3Prompt = buildL3PromptBlock({
          understand: understandPick.text,
          assume: talkAssume,
          search: anySearch ? typeFindPrompt : "",
          answer: talkAnswer
        });

        const systemPrompt = buildAnswerSystem(
          {
            identity,
            learnings,
            glossaryBlock,
            skillPrompt,
            l3Prompt,
            workserverStructure,
            notionSources,
            cards,
            nasResults,
            nasSearchAttempted: nasEnabled && anySearch,
            reportContent: usedReportContent,
            notionSearchAttempted: notionEnabled && anySearch,
            notionSearchStatus: notionSearchOutcome?.status,
            notionSearchRounds: notionSearchOutcome?.rounds ?? 0
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
        if (anySearch && typeFindPrompt) {
          recordPromptUse(usageLog, {
            key: LUNA_PROMPT_KEYS.find,
            step: "답변 생성",
            title: "FIND 자료 찾기",
            row: findPick.row
          });
          logPromptInject({
            key: LUNA_PROMPT_KEYS.find,
            step: "답변 생성",
            source: findPick.source,
            text: typeFindPrompt
          });
        }
        if (talkAnswer) {
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
          memory_count: learningsRows.length,
          used_prompts: usedPrompts,
          auto_routing: autoRoutingUsed,
          connector_routing: connectorRoutingMeta
        });

        let assistantText = "";
        const maxTokens = hasAttachments ? 8192 : 4096;
        let answerUsage = emptyUsage();

        if (tierAResolved.provider === "anthropic") {
          const anthropicStream = client.messages.stream({
            model: tierA.model_id,
            max_tokens: maxTokens,
            system: systemPrompt.anthropic || undefined,
            messages: historyMessages
          });

          anthropicStream.on("text", (textDelta) => {
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
                  .join("\n");
              }
              return `${role}: ${content}`;
            })
            .join("\n\n");
          for await (const chunk of llmStreamText({
            provider: tierAResolved.provider,
            model_id: tierA.model_id,
            system: systemPrompt.text,
            user: flatUser || userText,
            maxTokens,
            useCaching: systemPrompt.applied
          })) {
            if (chunk.delta) {
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

        const durationMs = Date.now() - startedAt;
        const safeAssistantText = sanitizeKnowledgeListAnswer(
          assistantText,
          learnings
        );
        if (safeAssistantText !== assistantText) {
          assistantText = safeAssistantText;
        }
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
        assistantMeta.memory_count = learningsRows.length;
        if (attachmentMeta.length > 0) {
          userMeta.attachments = attachmentMeta;
          assistantMeta.attachments = attachmentMeta;
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
