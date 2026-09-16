import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type QuestionTargetKind = "project" | "term" | "general";

export type QuestionTargetInput = {
  question: string;
  context: Record<string, unknown>;
  category?: string | null;
  source?: string | null;
};

function asText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function compact(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "");
}

/** 「제목」 형태의 토큰 + from/to_title */
export function questionTopicTokens(input: QuestionTargetInput): string[] {
  const ctx = input.context;
  const quoted = [
    ...input.question.matchAll(/[「『“"]([^」』”"]+)[」』”"]/g)
  ]
    .map((m) => asText(m[1]))
    .filter((t) => t.length >= 2);
  const titles = [
    asText(ctx.from_title),
    asText(ctx.to_title),
    ...quoted
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const title of titles) {
    const key = compact(title);
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}

export function classifyQuestionTarget(
  input: QuestionTargetInput
): QuestionTargetKind {
  const ctx = input.context;
  const kind = asText(ctx.kind);
  const fromType = asText(ctx.from_type);
  const toType = asText(ctx.to_type);
  const category = asText(input.category);
  if (
    kind === "same" ||
    fromType === "nas_path" ||
    fromType === "notion_page" ||
    fromType === "project" ||
    toType === "nas_path" ||
    toType === "notion_page" ||
    toType === "project"
  ) {
    return "project";
  }
  if (
    kind === "term" ||
    category === "term" ||
    category === "용어" ||
    fromType === "term" ||
    toType === "term"
  ) {
    return "term";
  }
  const tokens = questionTopicTokens(input);
  if (tokens.length >= 2 && tokens.every((t) => compact(t).length <= 12)) {
    return "term";
  }
  if (tokens.length === 0) return "general";
  return "project";
}

function pickNotionAssigneeName(properties: unknown): string {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return "";
  }
  const props = properties as Record<string, unknown>;
  for (const [name, value] of Object.entries(props)) {
    const n = name.replace(/\s+/g, "").toLowerCase();
    if (!["담당", "assignee", "owner", "파트"].some((k) => n.includes(k))) {
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const p = value as Record<string, unknown>;
    if (p.type === "people" && Array.isArray(p.people)) {
      const names = p.people
        .map((row) =>
          row && typeof row === "object"
            ? asText((row as { name?: string }).name)
            : ""
        )
        .filter(Boolean);
      if (names[0]) return names[0]!;
    }
    if (p.type === "rich_text" && Array.isArray(p.rich_text)) {
      const t = p.rich_text
        .map((row) =>
          row && typeof row === "object"
            ? asText((row as { plain_text?: string }).plain_text)
            : ""
        )
        .join("");
      if (t) return t;
    }
    if (p.type === "select" && p.select && typeof p.select === "object") {
      const t = asText((p.select as { name?: string }).name);
      if (t) return t;
    }
  }
  return "";
}

async function matchProfileByName(
  admin: SupabaseClient,
  name: string
): Promise<string | null> {
  const needle = name.replace(/\s+/g, "");
  if (needle.length < 2) return null;
  const { data } = await admin.from("profiles").select("id, name").limit(80);
  const rows = (data ?? []) as Array<{ id: string; name: string | null }>;
  const compactNeedle = compact(needle);
  const hit = rows.find((r) => {
    const n = compact(r.name ?? "");
    return n && (n === compactNeedle || n.includes(compactNeedle) || compactNeedle.includes(n));
  });
  return hit?.id ?? null;
}

export type RecentUserMessage = {
  conversation_id: string;
  content: string | null;
  created_at: string;
};

export async function loadRecentUserMessages(
  admin: SupabaseClient
): Promise<RecentUserMessage[]> {
  const { data } = await admin
    .from("luna_messages")
    .select("conversation_id, content, created_at")
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []) as RecentUserMessage[];
}

function conversationIdForTokens(
  messages: RecentUserMessage[],
  tokens: string[]
): string | null {
  const needles = tokens
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 4);
  if (needles.length === 0) return null;
  const compactNeedles = needles.map(compact);
  return (
    messages.find((row) => {
      const hay = compact(row.content ?? "");
      return compactNeedles.some((n) => n.length >= 2 && hay.includes(n));
    })?.conversation_id ?? null
  );
}

async function userIdForConversation(
  admin: SupabaseClient,
  conversationId: string,
  cache: Map<string, string | null>
): Promise<string | null> {
  if (cache.has(conversationId)) return cache.get(conversationId) ?? null;
  const { data: conv } = await admin
    .from("luna_conversations")
    .select("user_id")
    .eq("id", conversationId)
    .maybeSingle();
  const userId = asText(conv?.user_id) || null;
  cache.set(conversationId, userId);
  return userId;
}

async function notionAssigneeUserId(
  admin: SupabaseClient,
  input: QuestionTargetInput
): Promise<string | null> {
  const ids = [asText(input.context.from_id), asText(input.context.to_id)].filter(
    Boolean
  );
  const types = [asText(input.context.from_type), asText(input.context.to_type)];
  const pageIds = ids.filter((_, i) => types[i] === "notion_page");
  if (pageIds.length === 0) return null;
  const { data } = await admin
    .from("luna_notion_pages")
    .select("page_id, properties")
    .in("page_id", pageIds);
  for (const row of data ?? []) {
    const name = pickNotionAssigneeName(
      (row as { properties?: unknown }).properties
    );
    const userId = await matchProfileByName(admin, name);
    if (userId) return userId;
  }
  return null;
}

/**
 * 질문마다 답할 사람.
 * 프로젝트: 최근에 그 프로젝트를 물어본 사람 → 노션 담당자
 * 용어: 그 용어를 최근에 쓴 사람
 * 일반: 아무나 (null)
 * 대화가 없으면 null. 호출 쪽에서 슈퍼관리자(블루진)로 둔다.
 */
export async function resolveQuestionTargetUserId(
  admin: SupabaseClient,
  input: QuestionTargetInput,
  opts?: {
    messages?: RecentUserMessage[];
    conversationUsers?: Map<string, string | null>;
  }
): Promise<{ userId: string | null; kind: QuestionTargetKind; reason: string }> {
  const kind = classifyQuestionTarget(input);
  const tokens = questionTopicTokens(input);

  if (kind === "general") {
    return { userId: null, kind, reason: "일반 — 먼저 보는 사람" };
  }

  const messages = opts?.messages ?? (await loadRecentUserMessages(admin));
  const convCache = opts?.conversationUsers ?? new Map<string, string | null>();
  const convId = conversationIdForTokens(messages, tokens);
  const recent = convId
    ? await userIdForConversation(admin, convId, convCache)
    : null;
  if (recent) {
    return {
      userId: recent,
      kind,
      reason:
        kind === "term"
          ? "그 용어를 최근에 쓴 사람"
          : "그 프로젝트를 최근에 물어본 사람"
    };
  }

  if (kind === "project") {
    const assignee = await notionAssigneeUserId(admin, input);
    if (assignee) {
      return { userId: assignee, kind, reason: "노션 담당자" };
    }
  }

  return { userId: null, kind, reason: "기록 없음 — 블루진 유지" };
}

export function isRelatedToTopic(
  tokens: string[],
  haystack: string
): boolean {
  const hay = compact(haystack);
  if (!hay) return false;
  return tokens.some((t) => {
    const key = compact(t);
    return key.length >= 2 && hay.includes(key);
  });
}
