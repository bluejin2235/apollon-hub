import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lunaLlmComplete } from "@/lib/luna/llm/client";
import type { MemoryAskPayload } from "@/lib/luna/memory-ask-shared";
import { getUserMemory, rewriteUserMemo, saveUserMemoText } from "@/lib/luna/user-memory";
import { insertLunaSignal } from "@/lib/luna/signals";
import { upsertOpenQuestion } from "@/lib/luna/open-questions";

export type { MemoryAskPayload } from "@/lib/luna/memory-ask-shared";

const MAX_ASKS_PER_DAY = 2;
const ASK_TIMEOUT_MS = 1800;

const ASK_SYSTEM = `당신은 루나다. 방금 답한 뒤, 이 사람의 선호가 갈리는지 본다.
확신이 서면 묻지 않는다. JSON 만 출력.

묻지 않을 때: {"ask":false}
물을 때:
{"ask":true,"topic":"짧은주제","question":"「동선」이라고 하시면 관람객 흐름 쪽을 먼저 볼까요?","options":["네, 그게 맞아요","아니요, 그때그때 달라요"],"accept_line":"「동선」은 관람객 흐름을 먼저 본다.","reject_as":"case_by_case"}

규칙:
- 하루에 자주 물으면 안 되므로, 정말 갈릴 때만.
- question 은 한 줄. options 는 정확히 2개.
- accept_line 은 memo 「답할 때」에 넣을 한 문장.
- reject_as 는 case_by_case(개인만) 또는 open_question(팀마다 다르면 블루진 질문함).
- 조직 공통 지식·이미 memo 에 있는 것은 묻지 않는다.`;

function startOfKstDayIso(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  const utc = Date.UTC(y, m, d) - 9 * 60 * 60 * 1000;
  return new Date(utc).toISOString();
}

export async function countMemoryAsksToday(
  admin: SupabaseClient,
  userId: string
): Promise<number> {
  const since = startOfKstDayIso();
  const { data: convs } = await admin
    .from("luna_conversations")
    .select("id")
    .eq("user_id", userId)
    .limit(100);
  const ids = (convs ?? []).map((c) => c.id as string);
  if (ids.length === 0) return 0;

  const { data: msgs } = await admin
    .from("luna_messages")
    .select("metadata")
    .in("conversation_id", ids)
    .eq("role", "assistant")
    .gte("created_at", since)
    .limit(80);

  let n = 0;
  for (const m of msgs ?? []) {
    const meta =
      m.metadata && typeof m.metadata === "object" && !Array.isArray(m.metadata)
        ? (m.metadata as Record<string, unknown>)
        : null;
    if (meta && meta.memory_ask && typeof meta.memory_ask === "object") n += 1;
  }
  return n;
}

function parseAsk(raw: string): MemoryAskPayload | null {
  const t = raw.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
    if (obj.ask !== true) return null;
    const question = typeof obj.question === "string" ? obj.question.trim() : "";
    const topic = typeof obj.topic === "string" ? obj.topic.trim() : "";
    const accept =
      typeof obj.accept_line === "string" ? obj.accept_line.trim() : "";
    const opts = Array.isArray(obj.options)
      ? obj.options.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
    if (!question || !accept || opts.length < 2) return null;
    const reject_as =
      obj.reject_as === "open_question" ? "open_question" : "case_by_case";
    return {
      question,
      options: [opts[0]!.trim(), opts[1]!.trim()],
      accept_line: accept,
      reject_as,
      topic: topic || question.slice(0, 40)
    };
  } catch {
    return null;
  }
}

/** 답변을 거의 늦추지 않도록 짧은 타임아웃 */
export async function maybeProposeMemoryAsk(
  admin: SupabaseClient,
  opts: {
    userId: string;
    userText: string;
    assistantText: string;
    memo: string | null;
  }
): Promise<MemoryAskPayload | null> {
  try {
    const today = await countMemoryAsksToday(admin, opts.userId);
    if (today >= MAX_ASKS_PER_DAY) return null;

    const userPrompt = [
      opts.memo?.trim()
        ? `기존 memo:\n${opts.memo.trim().slice(0, 800)}`
        : "기존 memo: (없음)",
      "",
      `질문: ${opts.userText.slice(0, 400)}`,
      `답: ${opts.assistantText.slice(0, 600)}`
    ].join("\n");

    const work = lunaLlmComplete(admin, {
      tier: "B",
      feature: "user_memory",
      system: ASK_SYSTEM,
      user: userPrompt,
      maxTokens: 220
    }).then((r) => parseAsk(r.text));

    const result = await Promise.race([
      work,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), ASK_TIMEOUT_MS)
      )
    ]);
    return result;
  } catch (err) {
    console.error("[luna/memory-ask] propose", err);
    return null;
  }
}

export async function applyMemoryAskAnswer(
  admin: SupabaseClient,
  opts: {
    userId: string;
    messageId: string;
    answer: "accept" | "reject";
  }
): Promise<{ ok: boolean; error?: string }> {
  const { data: message, error } = await admin
    .from("luna_messages")
    .select("id, conversation_id, metadata")
    .eq("id", opts.messageId)
    .maybeSingle();
  if (error || !message) {
    return { ok: false, error: error?.message ?? "not_found" };
  }

  const { data: conv } = await admin
    .from("luna_conversations")
    .select("user_id")
    .eq("id", message.conversation_id)
    .maybeSingle();
  if (!conv || conv.user_id !== opts.userId) {
    return { ok: false, error: "forbidden" };
  }

  const meta =
    message.metadata &&
    typeof message.metadata === "object" &&
    !Array.isArray(message.metadata)
      ? { ...(message.metadata as Record<string, unknown>) }
      : {};
  const askRaw = meta.memory_ask;
  if (!askRaw || typeof askRaw !== "object" || Array.isArray(askRaw)) {
    return { ok: false, error: "no_ask" };
  }
  if (meta.memory_ask_answer) {
    return { ok: true };
  }

  const ask = askRaw as MemoryAskPayload;
  meta.memory_ask_answer = opts.answer;
  meta.memory_ask_answered_at = new Date().toISOString();

  await admin
    .from("luna_messages")
    .update({ metadata: meta })
    .eq("id", opts.messageId);

  if (opts.answer === "accept") {
    const existing = await getUserMemory(admin, opts.userId);
    const prev = existing?.memo?.trim() ?? "";
    const line = ask.accept_line.trim();
    const next = prev.includes(line)
      ? prev
      : prev
        ? `${prev}\n\n답할 때\n${line}`
        : `답할 때\n${line}`;
    await saveUserMemoText(admin, opts.userId, next);
    void rewriteUserMemo(admin, opts.userId).catch(() => undefined);
    await insertLunaSignal(admin, {
      kind: "correction",
      source: "followup",
      subject_type: "answer",
      subject_id: opts.messageId,
      reason: "memory_ask_accept",
      note: line,
      user_id: opts.userId,
      context: { topic: ask.topic }
    });
  } else if (ask.reject_as === "open_question") {
    await upsertOpenQuestion(admin, {
      title: ask.topic || ask.question,
      why: "팀마다 다르게 씀 · 물어봤는데 그때그때 다르다고 함",
      preview: ask.question,
      bumpRelated: 1
    });
    await insertLunaSignal(admin, {
      kind: "correction",
      source: "followup",
      subject_type: "question",
      subject_id: opts.messageId,
      reason: "memory_ask_reject_open",
      note: ask.question,
      user_id: opts.userId,
      context: { topic: ask.topic }
    });
  } else {
    const existing = await getUserMemory(admin, opts.userId);
    const prev = existing?.memo?.trim() ?? "";
    const line = `「${ask.topic}」은 그때그때 다르다.`;
    const next = prev.includes(line)
      ? prev
      : prev
        ? `${prev}\n\n답할 때\n${line}`
        : `답할 때\n${line}`;
    await saveUserMemoText(admin, opts.userId, next);
    await insertLunaSignal(admin, {
      kind: "correction",
      source: "followup",
      subject_type: "answer",
      subject_id: opts.messageId,
      reason: "memory_ask_reject",
      note: line,
      user_id: opts.userId,
      context: { topic: ask.topic }
    });
  }

  return { ok: true };
}
