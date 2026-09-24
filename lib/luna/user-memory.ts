import { isProductionData, safeProductionMemo } from "@/lib/luna/data-context";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lunaLlmComplete } from "@/lib/luna/llm/client";
import {
  formalTermsForMemoPrompt,
  loadGlossaryCanon,
  normalizeMemoAgainstGlossary,
  promoteMemoShorthandsAsGlossaryCandidates
} from "@/lib/luna/memo-glossary-normalize";
import {
  ANSWER_LENGTH_IDS,
  isAnswerLength,
  USER_MEMO_MAX_CHARS,
  type AnswerLength,
  type LunaUserMemory
} from "@/lib/luna/user-memory-shared";

export type {
  AnswerLength,
  LunaUserMemory
} from "@/lib/luna/user-memory-shared";
export {
  ANSWER_LENGTH_IDS,
  ANSWER_LENGTH_LABELS,
  USER_MEMO_MAX_CHARS,
  answerLengthRule,
  isAnswerLength
} from "@/lib/luna/user-memory-shared";

/**
 * 갱신 주기 근거
 * - 매 대화마다 LLM 호출은 비쌈 → 최소 15분 간격
 * - 새 사용자 메시지 2건 이상일 때만 (첫 memo 는 1건으로도)
 * - 6시간 넘고 새 대화가 있으면 1건이어도 갱신 (뜸하면 안 쌓임)
 * - 시간당 cron 이 conversation.updated_at > memo.updated_at 인 사람을 백필
 */
const REWRITE_MIN_INTERVAL_MS = 15 * 60 * 1000;
const REWRITE_STALE_MS = 6 * 60 * 60 * 1000;
const RECENT_CONVERSATIONS = 8;
const MSGS_PER_CONV = 12;
const BATCH_LIMIT = 20;

const MEMO_REWRITE_SYSTEM_BASE = `당신은 아폴론 허브의 루나다. 한 사람과의 **최근 대화**만 보고 「루나가 아는 나」 메모를 통째로 새로 쓴다.

규칙:
- 덧붙이지 마라. 이전 메모를 복사·이어 붙이지 마라. 최근 대화에서 드러난 것만으로 처음부터 다시 쓴다.
- 기존 메모는 참고용이다. 최근 대화에서 다시 나타나지 않은 주제·프로젝트·관심사는 버려라. 오래되면 자연히 사라져야 한다.
- 사람이 직접 말하지 않은 추측은 넣지 않는다.
- 구조는 글머리로 표현한다 (항목 테이블이 아니다):
  하는 일
  답할 때
  말버릇
  자주 찾는 것
- 해당 섹션에 쓸 게 없으면 그 섹션을 생략한다.
- 최대 ${USER_MEMO_MAX_CHARS}자. 넘치면 덜 중요한 것을 버린다.
- 메모 본문만 출력한다. 따옴표·설명·JSON 금지.
- 조직 공통 지식·팀 관점은 넣지 않는다. 이 사람만의 것.
- 사용자가 오타·다른 표기로 말해도, 아래에 준 정식 용어 표기로만 적는다. 오타를 그대로 배우지 않는다.`;

function buildMemoRewriteSystem(formalTerms: string): string {
  const terms = formalTerms.trim();
  if (!terms) return MEMO_REWRITE_SYSTEM_BASE;
  return `${MEMO_REWRITE_SYSTEM_BASE}

아래 용어는 정식 표기다. 사용자가 다르게 써도 이 표기로 적어라.
${terms}`;
}

function clipMemo(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^```[\w]*\r?\n?/u, "").replace(/\r?\n?```$/u, "").trim();
  if (t.length > USER_MEMO_MAX_CHARS) {
    t = t.slice(0, USER_MEMO_MAX_CHARS).trim();
  }
  return t;
}

function asMemory(row: Record<string, unknown> | null): LunaUserMemory | null {
  if (!row || typeof row.user_id !== "string") return null;
  const length = isAnswerLength(row.answer_length)
    ? row.answer_length
    : "normal";
  return {
    user_id: row.user_id,
    memo: safeProductionMemo(row.memo),
    answer_length: length,
    source_count:
      typeof row.source_count === "number" && Number.isFinite(row.source_count)
        ? Math.max(0, Math.floor(row.source_count))
        : 0,
    updated_at:
      typeof row.updated_at === "string" && row.updated_at
        ? row.updated_at
        : new Date(0).toISOString()
  };
}

export async function getUserMemory(
  admin: SupabaseClient,
  userId: string
): Promise<LunaUserMemory | null> {
  const { data, error } = await admin
    .from("luna_user_memories")
    .select("user_id, memo, answer_length, source_count, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[luna/user-memory] get", error);
    return null;
  }
  return asMemory((data ?? null) as Record<string, unknown> | null);
}

/** 답변 프롬프트용 — memo + 답 길이. 질문과 겹치는 줄만 남길 수 있다. */
export function formatUserMemoryBlock(
  memory: LunaUserMemory | null,
  opts?: { question?: string; maxChars?: number }
): string | null {
  if (!memory) return null;
  const parts: string[] = [];
  const raw = memory.memo.trim();
  if (raw) {
    const clipped = clipMemoToQuestion(raw, opts?.question, opts?.maxChars ?? 500);
    if (clipped) {
      parts.push(
        `[이 사람에 대해 루나가 아는 것]\r\n${clipped}\r\n(조직 지식·팀 관점과 어긋나면 조직 지식을 따른다. 이 사람 것만 쓴다.)`
      );
    }
  }
  if (memory.answer_length === "short") {
    parts.push(
      "[답 길이]\r\n이 사람은 짧게를 고쳤다. 결론부터 2~4문장. 군더더기·서론 금지."
    );
  } else if (memory.answer_length === "detailed") {
    parts.push(
      "[답 길이]\r\n이 사람은 자세히를 고쳤다. 근거·경로·맥락을 충분히 보여 준다."
    );
  }
  return parts.length > 0 ? parts.join("\r\n\r\n") : null;
}

/** 질문 토큰과 겹치는 글머리만. 없으면 앞에서 maxChars. */
export function clipMemoToQuestion(
  memo: string,
  question: string | undefined,
  maxChars: number
): string {
  const text = memo.trim();
  if (!text) return "";
  if (text.length <= maxChars && !question?.trim()) return text;

  const qTokens = (question ?? "")
    .replace(/[\s\u300c\u300d\u300e\u300f"'\u201c\u201d\u2018\u2019]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const lines = text.split(/\r?\n/);
  if (qTokens.length === 0) {
    return text.length <= maxChars ? text : `${text.slice(0, maxChars).trim()}…`;
  }

  const scored = lines
    .map((line) => {
      const hit = qTokens.reduce(
        (n, tok) => (line.includes(tok) ? n + 1 : n),
        0
      );
      return { line, hit };
    })
    .filter((x) => x.hit > 0 || /^(하는 일|답할 때|말버릇|자주 찾는 것)/.test(x.line.trim()));

  let out = scored.map((x) => x.line).join("\n").trim();
  if (!out) {
    out = text.length <= maxChars ? text : `${text.slice(0, maxChars).trim()}…`;
  } else if (out.length > maxChars) {
    out = `${out.slice(0, maxChars).trim()}…`;
  }
  return out;
}

async function countConversationsForUser(
  admin: SupabaseClient,
  userId: string
): Promise<number> {
  const { count, error } = await admin
    .from("luna_conversations")
    .select("id", { count: "exact", head: true })
    .eq("data_context", "production")
    .eq("user_id", userId);
  if (error) {
    console.error("[luna/user-memory] count conv", error);
    return 0;
  }
  return count ?? 0;
}

async function countUserMessagesSince(
  admin: SupabaseClient,
  userId: string,
  sinceIso: string | null
): Promise<number> {
  const { data: convs, error: convErr } = await admin
    .from("luna_conversations")
    .select("id, title, data_context")
    .eq("data_context", "production")
    .eq("user_id", userId)
    .limit(200);
  if (convErr) {
    console.error("[luna/user-memory] count msgs convs", convErr);
    return 0;
  }
  const ids = (convs ?? []).filter(isProductionData).map((c) => c.id as string).filter(Boolean);
  if (ids.length === 0) return 0;

  let q = admin
    .from("luna_messages")
    .select("id", { count: "exact", head: true })
    .in("conversation_id", ids)
    .eq("role", "user");
  if (sinceIso) {
    q = q.gt("created_at", sinceIso);
  }
  const { count, error } = await q;
  if (error) {
    console.error("[luna/user-memory] count msgs", error);
    return 0;
  }
  return count ?? 0;
}

async function loadRecentDialogue(
  admin: SupabaseClient,
  userId: string
): Promise<{ text: string; conversationCount: number }> {
  const { data: convs, error: convErr } = await admin
    .from("luna_conversations")
    .select("id, title, updated_at, data_context")
    .eq("data_context", "production")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(RECENT_CONVERSATIONS);

  if (convErr || !convs?.length) {
    if (convErr) console.error("[luna/user-memory] convs", convErr);
    return { text: "", conversationCount: 0 };
  }

  const blocks: string[] = [];
  for (const c of convs.filter(isProductionData)) {
    const { data: msgs } = await admin
      .from("luna_messages")
      .select("role, content, created_at")
      .eq("conversation_id", c.id)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true })
      .limit(MSGS_PER_CONV);

    if (!msgs?.length) continue;
    const lines = msgs
      .map((m) => {
        const role = m.role === "user" ? "사람" : "루나";
        const content =
          typeof m.content === "string" ? m.content.trim().slice(0, 600) : "";
        return content ? `${role}: ${content}` : null;
      })
      .filter(Boolean);
    if (lines.length === 0) continue;
    const title =
      typeof c.title === "string" && c.title.trim() ? c.title.trim() : "대화";
    blocks.push(`## ${title}\r\n${lines.join("\r\n")}`);
  }

  return {
    text: blocks.join("\r\n\r\n").slice(0, 12_000),
    conversationCount: convs.filter(isProductionData).length
  };
}

export type RewriteDecision =
  | { run: false; reason: string }
  | { run: true; reason: string; force: boolean };

export async function shouldRewriteUserMemo(
  admin: SupabaseClient,
  userId: string,
  opts?: { force?: boolean }
): Promise<RewriteDecision> {
  if (opts?.force) return { run: true, reason: "force", force: true };

  const existing = await getUserMemory(admin, userId);
  const now = Date.now();
  const updatedAt = existing ? Date.parse(existing.updated_at) : 0;
  const ageMs = existing ? now - updatedAt : Number.POSITIVE_INFINITY;

  if (existing && ageMs < REWRITE_MIN_INTERVAL_MS) {
    return { run: false, reason: "cooldown_15m" };
  }

  const since = existing?.updated_at ?? null;
  const newMsgs = await countUserMessagesSince(admin, userId, since);
  const hasMemo = Boolean(existing?.memo?.trim());

  if (!hasMemo && newMsgs >= 1) {
    return { run: true, reason: "first_memo", force: false };
  }
  if (newMsgs >= 2) {
    return { run: true, reason: "new_msgs_2+", force: false };
  }
  if (newMsgs >= 1 && ageMs >= REWRITE_STALE_MS) {
    return { run: true, reason: "stale_6h", force: false };
  }

  // memo 없고 메시지도 없으면 skip
  if (!existing) {
    const total = await countUserMessagesSince(admin, userId, null);
    if (total >= 1) return { run: true, reason: "backfill", force: false };
  }

  return { run: false, reason: "no_new_signal" };
}

export async function rewriteUserMemo(
  admin: SupabaseClient,
  userId: string,
  opts?: { force?: boolean }
): Promise<{
  ok: boolean;
  skipped?: string;
  memoChars?: number;
  sourceCount?: number;
  reason?: string;
}> {
  try {
    const decision = await shouldRewriteUserMemo(admin, userId, opts);
    if (!decision.run) {
      return { ok: true, skipped: decision.reason };
    }

    const existing = await getUserMemory(admin, userId);
    const dialogue = await loadRecentDialogue(admin, userId);
    if (!dialogue.text.trim()) {
      return { ok: true, skipped: "no_dialogue" };
    }

    const prevMemo = existing?.memo?.trim() ?? "";
    const [formalTerms, canon] = await Promise.all([
      formalTermsForMemoPrompt(admin),
      loadGlossaryCanon(admin)
    ]);
    // 최근 대화를 본문으로. 기존 메모는 짧은 참고만 — 「유지」 지시 금지.
    const userPrompt = [
      "최근 대화 (이것만으로 메모를 새로 써라):",
      dialogue.text,
      "",
      prevMemo
        ? `이전 메모(참고만. 최근 대화에 없는 내용은 넣지 마라):\n${prevMemo.slice(0, 600)}`
        : "이전 메모: (없음)"
    ].join("\n");

    let memo = "";
    try {
      const result = await lunaLlmComplete(admin, {
        tier: "B",
        feature: "user_memory",
        system: buildMemoRewriteSystem(formalTerms),
        user: userPrompt,
        maxTokens: 900
      });
      memo = clipMemo(result.text);
    } catch (err) {
      console.error("[luna/user-memory] llm", err);
      return { ok: false, skipped: "llm_error" };
    }

    if (!memo) {
      return { ok: true, skipped: "empty_memo" };
    }

    const normalized = normalizeMemoAgainstGlossary(memo, canon);
    memo = clipMemo(normalized.text);
    if (normalized.fixes.length > 0 || normalized.skippedFuzzy.length > 0) {
      console.log("[luna/user-memory] glossary normalize", {
        userId,
        fixes: normalized.fixes.slice(0, 12),
        skippedFuzzy: normalized.skippedFuzzy.slice(0, 12)
      });
    }

    try {
      const promoted = await promoteMemoShorthandsAsGlossaryCandidates(admin, {
        userId,
        memo,
        canon
      });
      if (promoted > 0) {
        console.log("[luna/user-memory] shorthand candidates", {
          userId,
          promoted
        });
      }
    } catch (err) {
      console.error("[luna/user-memory] shorthand promote", err);
    }

    const sourceCount = await countConversationsForUser(admin, userId);
    const answerLength: AnswerLength =
      existing && isAnswerLength(existing.answer_length)
        ? existing.answer_length
        : "normal";
    const nowIso = new Date().toISOString();

    const { error } = await admin.from("luna_user_memories").upsert(
      {
        user_id: userId,
        memo,
        answer_length: answerLength,
        source_count: sourceCount,
        updated_at: nowIso
      },
      { onConflict: "user_id" }
    );

    if (error) {
      console.error("[luna/user-memory] upsert", error);
      return { ok: false, skipped: "upsert_error" };
    }

    console.log("[luna/user-memory] rewritten", {
      userId,
      chars: memo.length,
      sourceCount,
      reason: decision.reason
    });
    return {
      ok: true,
      memoChars: memo.length,
      sourceCount,
      reason: decision.reason
    };
  } catch (err) {
    console.error("[luna/user-memory] rewrite", err);
    return { ok: false, skipped: "exception" };
  }
}

/** fire-and-forget — 답변을 늦추지 않는다 */
export function scheduleUserMemoRewrite(
  admin: SupabaseClient,
  userId: string
): void {
  void rewriteUserMemo(admin, userId).catch((err) =>
    console.error("[luna/user-memory] schedule", err)
  );
}

export async function updateAnswerLength(
  admin: SupabaseClient,
  userId: string,
  length: AnswerLength
): Promise<{ ok: boolean; error?: string }> {
  if (!(ANSWER_LENGTH_IDS as readonly string[]).includes(length)) {
    return { ok: false, error: "invalid_length" };
  }
  const existing = await getUserMemory(admin, userId);
  const nowIso = new Date().toISOString();
  const { error } = await admin.from("luna_user_memories").upsert(
    {
      user_id: userId,
      memo: existing?.memo ?? "",
      answer_length: length,
      source_count: existing?.source_count ?? 0,
      updated_at: existing?.updated_at ?? nowIso
    },
    { onConflict: "user_id" }
  );
  if (error) {
    console.error("[luna/user-memory] answer_length", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function saveUserMemoText(
  admin: SupabaseClient,
  userId: string,
  memo: string
): Promise<{ ok: boolean; error?: string }> {
  const canon = await loadGlossaryCanon(admin);
  const normalized = normalizeMemoAgainstGlossary(memo, canon);
  const clipped = clipMemo(normalized.text);
  if (normalized.fixes.length > 0 || normalized.skippedFuzzy.length > 0) {
    console.log("[luna/user-memory] save normalize", {
      userId,
      fixes: normalized.fixes.slice(0, 12),
      skippedFuzzy: normalized.skippedFuzzy.slice(0, 12)
    });
  }
  try {
    await promoteMemoShorthandsAsGlossaryCandidates(admin, {
      userId,
      memo: clipped,
      canon
    });
  } catch (err) {
    console.error("[luna/user-memory] save shorthand", err);
  }
  const existing = await getUserMemory(admin, userId);
  const nowIso = new Date().toISOString();
  const { error } = await admin.from("luna_user_memories").upsert(
    {
      user_id: userId,
      memo: clipped,
      answer_length: existing?.answer_length ?? "normal",
      source_count: existing?.source_count ?? 0,
      updated_at: nowIso
    },
    { onConflict: "user_id" }
  );
  if (error) {
    console.error("[luna/user-memory] save memo", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function clearUserMemo(
  admin: SupabaseClient,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin
    .from("luna_user_memories")
    .delete()
    .eq("user_id", userId);
  if (error) {
    console.error("[luna/user-memory] clear", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** cron — 대화가 memo 보다 최신인 사람만 */
export async function runUserMemoRewriteBatch(
  admin: SupabaseClient,
  opts?: { limit?: number; force?: boolean }
): Promise<{
  checked: number;
  rewritten: number;
  skipped: number;
  errors: number;
}> {
  const limit = opts?.limit ?? BATCH_LIMIT;
  const { data: recentConvs, error } = await admin
    .from("luna_conversations")
    .select("user_id, updated_at, title, data_context")
    .eq("data_context", "production")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[luna/user-memory] batch list", error);
    return { checked: 0, rewritten: 0, skipped: 0, errors: 1 };
  }

  const latestByUser = new Map<string, string>();
  for (const row of (recentConvs ?? []).filter(isProductionData)) {
    if (typeof row.user_id !== "string") continue;
    if (!latestByUser.has(row.user_id)) {
      latestByUser.set(row.user_id, row.updated_at as string);
    }
  }

  let checked = 0;
  let rewritten = 0;
  let skipped = 0;
  let errors = 0;

  for (const [userId, convUpdated] of latestByUser) {
    if (checked >= limit) break;
    checked += 1;

    if (!opts?.force) {
      const mem = await getUserMemory(admin, userId);
      if (mem?.updated_at && Date.parse(mem.updated_at) >= Date.parse(convUpdated)) {
        skipped += 1;
        continue;
      }
    }

    const result = await rewriteUserMemo(admin, userId, {
      force: opts?.force === true
    });
    if (!result.ok) errors += 1;
    else if (result.skipped) skipped += 1;
    else rewritten += 1;
  }

  return { checked, rewritten, skipped, errors };
}

