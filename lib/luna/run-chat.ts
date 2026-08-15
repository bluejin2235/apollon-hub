import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseNumberedChoices } from "@/lib/luna/chat-response";
import {
  formatConnectorRoutingSummary,
  hasManualConnectors,
  resolveConnectorsAuto,
  type ConnectorFlags
} from "@/lib/luna/connector-routing";
import { LUNA_DEFAULT_IDENTITY_PROMPT } from "@/lib/luna/constants";
import {
  isKnowledgeDumpRequest,
  KNOWLEDGE_DUMP_CLARIFY,
  KNOWLEDGE_LIST_HARD_RULE,
  sanitizeKnowledgeListAnswer,
  selectLearningsForInject
} from "@/lib/luna/knowledge-dump-guard";
import { searchNotionPages, type NotionSource } from "@/lib/luna/notion";
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

export const LUNA_MODEL = "claude-sonnet-4-6";
export const LUNA_MODEL_LABEL = "Claude Sonnet 4.6";

const KEYWORD_EXTRACT_FALLBACK =
  "사용자의 메시지에서 웹/노션/유튜브 검색에 쓸 핵심 키워드만 짧게 추출하세요. 검색어 문자열만 응답하고 다른 설명은 하지 마세요.";

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
  durationMs: number;
  modelLabel: string;
};

type NasDirectoryRow = WorkserverExploreRow;

type LearningRow = { content: string; category: string };

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

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
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
  learnings: LearningRow[];
  connectorPrompts?: string[];
  synthesisOpinion?: string;
  notionSources?: NotionSource[];
  cards?: LunaCard[];
  nasResults?: NasDirectoryRow[];
  nasSearchAttempted?: boolean;
}): string {
  const parts: string[] = [opts.identity.trim() || LUNA_DEFAULT_IDENTITY_PROMPT];

  for (const block of opts.connectorPrompts ?? []) {
    if (block.trim()) parts.push(block.trim());
  }

  if (opts.learnings.length > 0) {
    const learningBlock = opts.learnings
      .map((l) => `- ${l.content} (${l.category})`)
      .join("\n");
    parts.push(`[아폴론에 대해 알고 있는 것]\n${learningBlock}`);
  }

  if (opts.notionSources && opts.notionSources.length > 0) {
    const notionBlock = opts.notionSources
      .map((s) => `- ${s.title}: ${s.url}`)
      .join("\n");
    parts.push(`[노션 검색 결과]\n${notionBlock}`);
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
        "아래 경로만이 검증된 경로다. 이 목록에 없는 경로는 존재를 모르는 것이다.\n" +
        nasBlock
    );
  } else if (opts.nasSearchAttempted) {
    parts.push(
      "[Work서버 파일 위치]\n(검색 결과 없음 — 찾지 못했다고 명확히 답하고 경로를 추측하지 마세요)"
    );
  }

  const opinionRule = opts.synthesisOpinion?.trim() || SYNTHESIS_OPINION_FALLBACK;

  parts.push(
    "[답변 규칙]\n" +
      "- 위에 제공된 검색 결과가 있으면 그것을 근거로 답하세요.\n" +
      "- 검색 결과가 없으면 반드시 '찾지 못했다'고 명확히 답한다. 경로·파일명을 추측하지 마세요.\n" +
      "- '기능 준비 중', '연동이 안 되어 있다', '검색 실패'처럼 시스템 장애로 단정하지 마세요.\n" +
      `${opinionRule.startsWith("-") ? opinionRule : `- ${opinionRule}`}\n` +
      `${KNOWLEDGE_LIST_HARD_RULE}\n` +
      "- 답변은 아폴론의 과거 프로젝트 맥락과 연결해서 구체적으로 쓰세요."
  );

  return parts.join("\n\n");
}

async function extractSearchKeywords(
  client: Anthropic,
  userMessage: string,
  systemPrompt: string
): Promise<string> {
  try {
    const response = await client.messages.create({
      model: LUNA_MODEL,
      max_tokens: 64,
      system: systemPrompt.trim() || KEYWORD_EXTRACT_FALLBACK,
      messages: [{ role: "user", content: userMessage }]
    });
    const text = response.content.find((p) => p.type === "text")?.text?.trim() ?? "";
    return text.replace(/^["']|["']$/g, "").trim() || userMessage.slice(0, 80);
  } catch (err) {
    console.error("[luna/run-chat] keyword extract", err);
    return userMessage.slice(0, 80);
  }
}

async function maybeClarify(
  client: Anthropic,
  userText: string,
  clarifyPrompt: string
): Promise<string | null> {
  try {
    const clarifyRes = await client.messages.create({
      model: LUNA_MODEL,
      max_tokens: 512,
      system: clarifyPrompt.trim() || CLARIFY_FALLBACK,
      messages: [{ role: "user", content: userText }]
    });
    const raw =
      clarifyRes.content.find((p) => p.type === "text")?.text?.trim() ?? "";
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
        return `${question}\n${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`;
      }
      return null;
    }
    const numbered = parseNumberedChoices(raw);
    if (numbered && numbered.options.length >= 2) {
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
  const client = getAnthropicClient();
  if (!client) {
    throw new Error("Claude API key is not configured");
  }

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
      modelLabel: LUNA_MODEL_LABEL
    };
  }

  const resolved = resolveEvalConnectors(userText, connectors);
  const notionEnabled = resolved.notion;
  const webEnabled = resolved.web;
  const nasEnabled = resolved.nas;

  const loadedPrompts = await getPrompts(admin, [...LUNA_RUNTIME_PROMPT_KEYS]);

  const identity =
    loadedPrompts[LUNA_PROMPT_KEYS.identity]?.trim() || LUNA_DEFAULT_IDENTITY_PROMPT;
  const talkSearch = loadedPrompts[LUNA_PROMPT_KEYS.search]?.trim() || "";
  const talkAnswer = loadedPrompts[LUNA_PROMPT_KEYS.answer]?.trim() || "";
  const talkAssume = loadedPrompts[LUNA_PROMPT_KEYS.assume]?.trim() || "";
  const clarifyPrompt =
    loadedPrompts[LUNA_PROMPT_KEYS.understand]?.trim() || CLARIFY_FALLBACK;
  const keywordExtractPrompt = KEYWORD_EXTRACT_FALLBACK;
  const synthesisOpinion =
    [talkAnswer, talkAssume].filter(Boolean).join("\n\n") ||
    SYNTHESIS_OPINION_FALLBACK;

  const connectorPrompts: string[] = [];
  if ((notionEnabled || nasEnabled || webEnabled) && talkSearch) {
    connectorPrompts.push(talkSearch);
  }

  const clarifyAnswer = await maybeClarify(client, userText, clarifyPrompt);
  if (clarifyAnswer) {
    return {
      answer: clarifyAnswer,
      sources: [],
      notionSources: [],
      durationMs: Date.now() - startedAt,
      modelLabel: LUNA_MODEL_LABEL
    };
  }

  // 주입 안전: status='active' 만. candidate 는 절대 주입하지 않음.
  const { data: learningsData } = await admin
    .from("luna_learnings")
    .select("content, category")
    .eq("status", "active")
    .neq("category", "identity")
    .order("importance", { ascending: false })
    .order("use_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10);

  const learnings = selectLearningsForInject(
    (learningsData ?? []) as LearningRow[],
    userText
  );
  const isSearchRequest = isSearchRequestMessage(userText);

  let notionSources: NotionSource[] = [];
  let keywords = "";
  let nasResults: NasDirectoryRow[] = [];
  let webCards: LunaCard[] = [];
  let youtubeCards: LunaCard[] = [];
  let nasSearchAttempted = false;

  if (notionEnabled || webEnabled || isSearchRequest || nasEnabled) {
    keywords = await extractSearchKeywords(client, userText, keywordExtractPrompt);
  }

  if (notionEnabled && keywords) {
    const notionOutcome = await searchNotionPages(keywords, userText);
    notionSources = notionOutcome.sources;
  }
  if (webEnabled) {
    webCards = await searchTavily(keywords || userText);
  }
  if (isSearchRequest && keywords) {
    youtubeCards = await searchYoutube(keywords);
  }
  if (nasEnabled) {
    nasSearchAttempted = true;
    const kw = keywords || userText;
    try {
      const explored = await exploreWorkserverWithTools(admin, client, {
        keywords: kw,
        queryText: userText,
        model: LUNA_MODEL,
        exploreSystem:
          talkSearch ||
          "Work서버 폴더를 단계적으로 탐색해 관련 자료를 찾으세요."
      });
      nasResults = explored.rows;
      console.log(
        "[luna/ws] eval explore done",
        { kw, toolCalls: explored.toolCalls.length },
        "→",
        nasResults.length
      );
    } catch (err) {
      console.error(
        "[luna/ws] tool loop failed, fallback to legacy",
        err
      );
      nasResults = await exploreWorkserverFallback(admin, kw, userText);
      console.log("[luna/ws] eval fallback →", nasResults.length);
    }
  }

  const notionCards: LunaCard[] = notionSources.map((s) => ({
    type: "notion" as const,
    title: s.title,
    url: s.url,
    thumbnail: null,
    description: ""
  }));
  const cards = [...notionCards, ...nasResults.map(toNasCard), ...webCards, ...youtubeCards];

  const systemPrompt = buildSystemPrompt({
    identity,
    learnings,
    connectorPrompts,
    synthesisOpinion,
    notionSources,
    cards,
    nasResults,
    nasSearchAttempted
  });

  const response = await client.messages.create({
    model: LUNA_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userText }]
  });

  const rawAnswer =
    response.content.find((p) => p.type === "text")?.text?.trim() ?? "";
  const answer = sanitizeKnowledgeListAnswer(rawAnswer, learnings);

  return {
    answer,
    sources: cards,
    notionSources,
    durationMs: Date.now() - startedAt,
    modelLabel: LUNA_MODEL_LABEL
  };
}
