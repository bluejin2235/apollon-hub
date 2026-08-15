import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTierModel, resolveAnthropicModel } from "@/lib/luna/engine";
import { getPrompt, LUNA_PROMPT_KEYS } from "@/lib/luna/prompts";

export type CandidateSource =
  | "chat"
  | "selfstudy"
  | "question"
  | "direct"
  | "interview";

export function resolveCandidateSource(
  source: string | null | undefined,
  origin?: string | null
): CandidateSource {
  if (
    source === "chat" ||
    source === "selfstudy" ||
    source === "question" ||
    source === "direct" ||
    source === "interview"
  ) {
    return source;
  }
  // source 비어 있는 레거시 행만 origin 으로 보정
  if (origin === "direct") return "direct";
  return "chat";
}
export type ScopeSuggestion = "org" | "personal";

export type ThreadTurn = {
  role: "luna" | "human";
  text: string;
  at: string;
};

export type CreateCandidateInput = {
  content: string;
  evidence?: string | null;
  scope_suggestion?: ScopeSuggestion | null;
  category?: string;
  source: CandidateSource;
  author_id?: string | null;
  assigned_to?: string | null;
  source_conversation_id?: string | null;
  raw_input?: string | null;
  thread?: ThreadTurn[];
  meta?: Record<string, unknown>;
};

const DIALOGUE_FALLBACK = `후보함에서 사람과 대화할 때의 원칙:

1. 내 이해를 한 문장으로 요약해 되묻는다: "~라고 이해했는데 맞아요?"
2. 사람이 고쳐주면 고친 내용을 반영해 다시 한 문장으로 정리하고 재확인한다.
3. 3번 안에 수렴하지 못하면: "제가 계속 못 알아듣네요.
   직접 한 문장으로 써 주시겠어요?" 로 전환한다.
4. 확정되면 감사를 짧게. 확정된 문장이 그대로 기억이 되므로,
   최종 문장은 나중에 검색으로 찾기 쉬운 형태(용어 포함)로 다듬는다.

사람의 시간은 비싸다. 문답은 짧게, 한 번에 하나만.`;

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
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

export function parseJsonArray(text: string): unknown[] | null {
  const trimmed = text.trim();
  const tryParse = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed;
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
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) return tryParse(trimmed.slice(start, end + 1));
  return null;
}

export function normalizeThread(raw: unknown): ThreadTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ThreadTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const role = row.role === "human" || row.role === "luna" ? row.role : null;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    const at =
      typeof row.at === "string" && row.at.trim()
        ? row.at.trim()
        : new Date().toISOString();
    if (!role || !text) continue;
    out.push({ role, text, at });
  }
  return out;
}

export function makeTurn(
  role: "luna" | "human",
  text: string,
  at?: string
): ThreadTurn {
  return {
    role,
    text: text.trim(),
    at: at ?? new Date().toISOString()
  };
}

function originForSource(source: CandidateSource): "auto" | "direct" {
  return source === "direct" ? "direct" : "auto";
}

export async function createCandidate(
  admin: SupabaseClient,
  input: CreateCandidateInput
): Promise<{ id: string; content: string; thread: ThreadTurn[] } | null> {
  const content = input.content.trim();
  if (!content) return null;

  const thread = normalizeThread(input.thread ?? []);
  let category = (input.category?.trim() || "general").slice(0, 64);
  const baseMeta =
    input.meta && typeof input.meta === "object" && !Array.isArray(input.meta)
      ? { ...input.meta }
      : {};
  // 용어 후보: term_ko 가 있을 때만 glossary — 없으면 일반 지식
  const termKo =
    typeof baseMeta.term_ko === "string" ? baseMeta.term_ko.trim() : "";
  if (category === "term" && !termKo) {
    category = "general";
    delete baseMeta.kind;
  } else if (category === "term" && termKo) {
    baseMeta.kind = "glossary";
    if (typeof baseMeta.definition !== "string" || !String(baseMeta.definition).trim()) {
      baseMeta.definition = content;
    }
  }

  const row = {
    content,
    evidence: input.evidence?.trim() || null,
    scope_suggestion: input.scope_suggestion ?? null,
    category,
    status: "candidate" as const,
    source: input.source,
    origin: originForSource(input.source),
    author_id: input.author_id ?? null,
    assigned_to: input.assigned_to ?? input.author_id ?? null,
    source_conversation_id: input.source_conversation_id ?? null,
    raw_input: input.raw_input?.trim() || null,
    thread,
    meta: baseMeta,
    confidence: 2,
    importance: 3,
    use_count: 0
  };

  const { data, error } = await admin
    .from("luna_learnings")
    .insert(row)
    .select("id, content, thread")
    .single();

  if (error) {
    console.error("[luna/candidates] create", error);
    return null;
  }

  return {
    id: data.id as string,
    content: data.content as string,
    thread: normalizeThread(data.thread)
  };
}

/**
 * 미응답 질문(source=question, status=candidate)이 이미 있는지.
 * snooze 중·만료 모두 미응답으로 셈 → 추가 생성 skip.
 */
export async function hasOpenAssignedQuestion(
  admin: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { count, error } = await admin
    .from("luna_learnings")
    .select("id", { count: "exact", head: true })
    .eq("source", "question")
    .eq("status", "candidate")
    .eq("assigned_to", userId);

  if (error) {
    console.error("[luna/candidates] hasOpenAssignedQuestion", error);
    return true; // 안전하게 생성 막기
  }
  return (count ?? 0) > 0;
}

type DialogueMode = "first" | "revise" | "confirm";

/**
 * learn.dialogue 규칙으로 한 턴/최종 문장을 생성.
 * 실패 시 null (호출측에서 템플릿 폴백).
 */
export async function runDialogueTurn(
  admin: SupabaseClient,
  opts: {
    mode: DialogueMode;
    content: string;
    thread?: ThreadTurn[];
    humanText?: string;
    evidence?: string | null;
  }
): Promise<string | null> {
  const client = getAnthropicClient();
  if (!client) return null;

  const system =
    (await getPrompt(admin, LUNA_PROMPT_KEYS.dialogue)).trim() ||
    DIALOGUE_FALLBACK;
  const tierA = resolveAnthropicModel(await getTierModel(admin, "A"));

  const thread = normalizeThread(opts.thread ?? []);
  const threadBlock =
    thread.length > 0
      ? thread.map((t) => `${t.role}: ${t.text}`).join("\n")
      : "(아직 문답 없음)";

  let instruction = "";
  if (opts.mode === "first") {
    instruction = `사람이 알려준/포착한 지식을 한 문장으로 이해하고 되묻으세요.
JSON만: { "text": "이렇게 이해했어요: … 맞아요?" }`;
  } else if (opts.mode === "revise") {
    instruction = `사람의 수정을 반영해 이해를 한 문장으로 다시 정리하고 재확인하세요.
JSON만: { "text": "…라고 이해했는데 맞아요?" }`;
  } else {
    instruction = `확정할 최종 지식 문장을 검색하기 쉬운 형태(용어 포함)로 다듬으세요.
JSON만: { "text": "확정 지식 한 문장" }`;
  }

  const userPayload = [
    instruction,
    `현재 지식 초안:\n${opts.content}`,
    opts.evidence ? `근거:\n${opts.evidence}` : null,
    `문답 스레드:\n${threadBlock}`,
    opts.humanText ? `사람 최근 발화:\n${opts.humanText}` : null
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const res = await client.messages.create({
      model: tierA.model_id,
      max_tokens: 512,
      system,
      messages: [{ role: "user", content: userPayload }]
    });
    const raw =
      res.content.find((p) => p.type === "text")?.text?.trim() ?? "";
    const parsed = parseJsonObject(raw);
    const text =
      typeof parsed?.text === "string" ? parsed.text.trim() : "";
    if (text) return text;
    // JSON 실패 시 모델이 문장만 준 경우
    if (raw && !raw.includes("{")) return raw.slice(0, 500);
    return null;
  } catch (err) {
    console.error("[luna/candidates] dialogue", err);
    return null;
  }
}

export function firstTurnFallback(content: string): string {
  return `이렇게 이해했어요: ${content.trim()} 맞아요?`;
}
