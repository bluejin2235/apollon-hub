import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LUNA_DEFAULT_IDENTITY_PROMPT } from "@/lib/luna/constants";
import { searchNotionPages, type NotionSource } from "@/lib/luna/notion";
import {
  getPrompts,
  LUNA_PROMPT_KEYS,
  LUNA_RUNTIME_PROMPT_KEYS
} from "@/lib/luna/prompts";
import { searchTavily, type LunaCard } from "@/lib/luna/tavily";
import { searchYoutube } from "@/lib/luna/youtube";

export const LUNA_MODEL = "claude-sonnet-4-6";
export const LUNA_MODEL_LABEL = "Claude Sonnet 4.6";

const KEYWORD_EXTRACT_FALLBACK =
  "사용자의 메시지에서 웹/노션/유튜브 검색에 쓸 핵심 키워드만 짧게 추출하세요. 검색어 문자열만 응답하고 다른 설명은 하지 마세요.";

const SYNTHESIS_OPINION_FALLBACK =
  "- 검색 결과 목록을 답변에 다시 나열하지 마세요. 화면에 이미 카드로 표시됩니다. 당신은 그 자료들을 종합한 판단과 의견만 쓰세요.";

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

type NasDirectoryRow = {
  drive: string | null;
  path: string;
  type: string | null;
  size_bytes: number | null;
  modified_at: string | null;
  file_summary: string | null;
};

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
  return {
    type: "nas",
    title,
    url: null,
    thumbnail: null,
    description: summary ? `${row.path} · ${summary}` : row.path,
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

function buildSystemPrompt(opts: {
  identity: string;
  learnings: LearningRow[];
  connectorPrompts?: string[];
  synthesisOpinion?: string;
  notionSources?: NotionSource[];
  cards?: LunaCard[];
  nasResults?: NasDirectoryRow[];
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

  if (opts.nasResults && opts.nasResults.length > 0) {
    const nasBlock = opts.nasResults
      .map((row) => {
        const name = pathLastSegment(row.path);
        return `- ${name} → T:\\${row.path.replace(/\//g, "\\")}`;
      })
      .join("\n");
    parts.push(`[Work서버 파일 위치]\n${nasBlock}`);
  }

  const opinionRule = opts.synthesisOpinion?.trim() || SYNTHESIS_OPINION_FALLBACK;

  parts.push(
    "[답변 규칙]\n" +
      "- 위에 제공된 검색 결과가 있으면 그것을 근거로 답하세요.\n" +
      "- 검색 결과가 없으면 '기능 준비 중', '연동이 안 되어 있다', '실시간으로 불러올 수 없다' 같은 말은 절대 하지 마세요. 대신 아폴론 관점에서 아는 내용으로 답하거나, 검색어를 어떻게 바꾸면 좋을지 제안하세요.\n" +
      `${opinionRule.startsWith("-") ? opinionRule : `- ${opinionRule}`}\n` +
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

/**
 * 단일 턴 LUNA 실행 (대화 이력/스킬/첨부 없음). 회귀 테스트용.
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

  const notionEnabled = connectors.notion === true;
  const webEnabled = connectors.web === true;
  const nasEnabled = connectors.nas === true;
  const userText = message.trim();
  if (!userText) {
    throw new Error("message is required");
  }

  const loadedPrompts = await getPrompts(admin, [...LUNA_RUNTIME_PROMPT_KEYS]);

  const identity =
    loadedPrompts[LUNA_PROMPT_KEYS.identity]?.trim() || LUNA_DEFAULT_IDENTITY_PROMPT;
  const talkSearch = loadedPrompts[LUNA_PROMPT_KEYS.search]?.trim() || "";
  const talkAnswer = loadedPrompts[LUNA_PROMPT_KEYS.answer]?.trim() || "";
  const talkAssume = loadedPrompts[LUNA_PROMPT_KEYS.assume]?.trim() || "";
  const keywordExtractPrompt = KEYWORD_EXTRACT_FALLBACK;
  const synthesisOpinion =
    [talkAnswer, talkAssume].filter(Boolean).join("\n\n") ||
    SYNTHESIS_OPINION_FALLBACK;

  const connectorPrompts: string[] = [];
  if ((notionEnabled || nasEnabled || webEnabled) && talkSearch) {
    connectorPrompts.push(talkSearch);
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

  const learnings = (learningsData ?? []) as LearningRow[];
  const isSearchRequest = isSearchRequestMessage(userText);

  let notionSources: NotionSource[] = [];
  let keywords = "";
  let nasResults: NasDirectoryRow[] = [];
  let webCards: LunaCard[] = [];
  let youtubeCards: LunaCard[] = [];

  if (notionEnabled || webEnabled || isSearchRequest || nasEnabled) {
    keywords = await extractSearchKeywords(client, userText, keywordExtractPrompt);
  }

  if (notionEnabled && keywords) {
    notionSources = await searchNotionPages(keywords);
  }
  if (webEnabled) {
    webCards = await searchTavily(keywords || userText);
  }
  if (isSearchRequest && keywords) {
    youtubeCards = await searchYoutube(keywords);
  }
  if (nasEnabled && keywords) {
    const terms = keywords
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .slice(0, 3);
    if (terms.length > 0) {
      const orFilter = terms.map((t) => `path.ilike.%${t}%`).join(",");
      const { data: nasData } = await admin
        .from("nas_directory")
        .select("drive, path, type, size_bytes, modified_at, file_summary")
        .or(orFilter)
        .limit(6);
      nasResults = (nasData ?? []) as NasDirectoryRow[];
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
    nasResults
  });

  const response = await client.messages.create({
    model: LUNA_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userText }]
  });

  const answer =
    response.content.find((p) => p.type === "text")?.text?.trim() ?? "";

  return {
    answer,
    sources: cards,
    notionSources,
    durationMs: Date.now() - startedAt,
    modelLabel: LUNA_MODEL_LABEL
  };
}
