/**
 * 답 모순 판정 — 답 내용을 읽지 않고 지표끼리 어긋남만 잡는다.
 * 실시간은 fire-and-forget. 사람 점검·규칙 후보·아침 리포트용.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ANSWER_FLAG_HINTS,
  ANSWER_FLAG_LABELS,
  ANSWER_FLAG_THRESHOLDS as T,
  type AnswerFlagHit,
  type AnswerFlagId,
  type AnswerFlagMetrics,
  type AnswerFlagSource,
  type AnswerFlagStatus,
  type AnswerFlagVerdict
} from "@/lib/luna/answer-flags-shared";
import { insertLunaSignal } from "@/lib/luna/signals";
import { isThumbsReason, type ThumbsReason } from "@/lib/luna/signals-shared";

export type EvaluateAnswerFlagsInput = {
  question: string;
  intent_score?: number | null;
  confidence_score?: number | null;
  duration_ms?: number | null;
  search_ms?: number | null;
  embed_ms?: number | null;
  link_ms?: number | null;
  llm_ms?: number | null;
  candidates_found?: number | null;
  candidates_used?: number | null;
  notion_n?: number;
  wiki_n?: number;
  nas_n?: number;
  glossary_n?: number;
  memory_n?: number;
  /** 모드 A 전용 */
  mode_a_rank?: number | null;
  mode_a_top_n?: number | null;
};

export type AnswerFlagRow = {
  id: string;
  message_id: string | null;
  question: string;
  flags: AnswerFlagHit[];
  severity: number;
  metrics: AnswerFlagMetrics;
  status: AnswerFlagStatus;
  human_verdict: AnswerFlagVerdict | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  source: AnswerFlagSource;
  created_at: string;
};

function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: string }).code) : "";
  const msg =
    "message" in error ? String((error as { message?: string }).message) : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("luna_answer_flags") ||
    msg.includes("does not exist")
  );
}

function charLen(s: string): number {
  return Array.from(s.trim()).length;
}

function num(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n;
}

function hit(id: AnswerFlagId): AnswerFlagHit {
  return { id, label: ANSWER_FLAG_LABELS[id], hint: ANSWER_FLAG_HINTS[id] };
}

export function evaluateAnswerFlags(
  input: EvaluateAnswerFlagsInput
): { flags: AnswerFlagHit[]; metrics: AnswerFlagMetrics } {
  const question = (input.question ?? "").trim();
  const qLen = charLen(question);
  const intent = num(input.intent_score);
  const conf = num(input.confidence_score);
  const duration = num(input.duration_ms);
  const searchMs = num(input.search_ms);
  const found = num(input.candidates_found);
  const used = num(input.candidates_used);
  const notion = Math.max(0, Math.round(input.notion_n ?? 0));
  const wiki = Math.max(0, Math.round(input.wiki_n ?? 0));
  const nas = Math.max(0, Math.round(input.nas_n ?? 0));
  const glossary = Math.max(0, Math.round(input.glossary_n ?? 0));
  const memory = Math.max(0, Math.round(input.memory_n ?? 0));
  const modeTop = num(input.mode_a_top_n);

  const searchDocs = notion + wiki + nas + glossary;
  const totalDocs =
    searchDocs > 0
      ? searchDocs
      : modeTop != null
        ? Math.max(0, Math.round(modeTop))
        : found != null
          ? Math.max(0, Math.round(found))
          : 0;

  const searchRatio =
    duration != null && duration > 0 && searchMs != null
      ? searchMs / duration
      : null;
  const usedRatio =
    found != null && found > 0 && used != null ? used / found : null;

  const bySource: Array<{ key: string; n: number }> = [
    { key: "notion", n: notion },
    { key: "wiki", n: wiki },
    { key: "nas", n: nas },
    { key: "glossary", n: glossary },
    { key: "memory", n: memory }
  ].filter((x) => x.n > 0);
  const dominant = bySource.sort((a, b) => b.n - a.n)[0] ?? null;
  const dominantShare =
    dominant && totalDocs > 0 ? dominant.n / totalDocs : null;

  const flags: AnswerFlagHit[] = [];

  // 범위 과다 — 짧은 질문 + 검색 자료 많음 (지식 주입은 제외)
  if (qLen > 0 && qLen < T.short_question_chars && totalDocs >= T.scope_docs_min) {
    flags.push(hit("scope_excess"));
  }

  // 자신감 미달
  if (conf != null && conf <= T.low_confidence_max) {
    flags.push(hit("low_confidence"));
  }

  // 의도-자신감 역전
  if (intent != null && conf != null && intent - conf >= T.intent_conf_gap_min) {
    flags.push(hit("intent_conf_gap"));
  }

  // 느림
  if (
    (duration != null && duration >= T.slow_total_ms) ||
    (searchRatio != null && searchRatio >= T.slow_search_ratio)
  ) {
    flags.push(hit("slow"));
  }

  // 자료 불일치 — 붙인 후보 대비 실제 주입이 절반 미만
  if (
    found != null &&
    found >= T.unused_found_min &&
    usedRatio != null &&
    usedRatio < T.unused_ratio_max
  ) {
    flags.push(hit("unused_sources"));
  }

  // 출처 편중 — 노션 편중만 (정의형 위키 단일이 과다 오판 나지 않게)
  if (
    totalDocs >= T.skew_docs_min &&
    dominant?.key === "notion" &&
    dominantShare != null &&
    dominantShare >= T.skew_share_min
  ) {
    flags.push(hit("source_skew"));
  }

  const metrics: AnswerFlagMetrics = {
    question_len: qLen,
    intent_score: intent,
    confidence_score: conf,
    duration_ms: duration,
    search_ms: searchMs,
    embed_ms: num(input.embed_ms),
    link_ms: num(input.link_ms),
    llm_ms: num(input.llm_ms),
    candidates_found: found,
    candidates_used: used,
    notion_n: notion,
    wiki_n: wiki,
    nas_n: nas,
    glossary_n: glossary,
    memory_n: memory,
    total_docs: totalDocs,
    search_ratio:
      searchRatio == null ? null : Number(searchRatio.toFixed(3)),
    used_ratio: usedRatio == null ? null : Number(usedRatio.toFixed(3)),
    dominant_source: dominant?.key ?? null,
    dominant_share:
      dominantShare == null ? null : Number(dominantShare.toFixed(3)),
    mode_a_rank: num(input.mode_a_rank),
    mode_a_top_n: modeTop
  };

  return { flags, metrics };
}

export type RecordAnswerFlagInput = EvaluateAnswerFlagsInput & {
  message_id?: string | null;
  source?: AnswerFlagSource;
};

/** 모순이 있으면 upsert. 없으면 아무 것도 안 함. */
export async function recordAnswerFlagsIfAny(
  admin: SupabaseClient,
  input: RecordAnswerFlagInput
): Promise<AnswerFlagRow | null> {
  const { flags, metrics } = evaluateAnswerFlags(input);
  if (flags.length === 0) return null;

  const row = {
    message_id: input.message_id ?? null,
    question: (input.question ?? "").trim().slice(0, 500),
    flags,
    severity: flags.length,
    metrics,
    status: "pending" as const,
    source: input.source ?? "chat"
  };

  if (row.message_id) {
    const existing = await admin
      .from("luna_answer_flags")
      .select("id")
      .eq("message_id", row.message_id)
      .maybeSingle();
    if (existing.error && !isMissingTable(existing.error)) {
      console.error("[luna/answer-flags] lookup", existing.error);
    }
    if (existing.data?.id) {
      const { data: updated, error: uErr } = await admin
        .from("luna_answer_flags")
        .update({
          question: row.question,
          flags: row.flags,
          severity: row.severity,
          metrics: row.metrics,
          source: row.source
        })
        .eq("id", existing.data.id)
        .select("*")
        .maybeSingle();
      if (uErr) {
        if (!isMissingTable(uErr)) console.error("[luna/answer-flags] update", uErr);
        return null;
      }
      return parseRow(updated);
    }
  }

  const { data, error } = await admin
    .from("luna_answer_flags")
    .insert(row)
    .select("*")
    .maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.error("[luna/answer-flags] insert", error);
    return null;
  }
  return parseRow(data);
}

/** 답 경로를 막지 않도록 fire-and-forget */
export function recordAnswerFlagsAsync(
  admin: SupabaseClient,
  input: RecordAnswerFlagInput
): void {
  void recordAnswerFlagsIfAny(admin, input).then(async (row) => {
    if (row && row.severity > 0) {
      try {
        await promoteAnswerFlagRules(admin);
      } catch (err) {
        console.error("[luna/answer-flags] promote", err);
      }
    }
  });
}

function parseRow(raw: unknown): AnswerFlagRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const flagsRaw = Array.isArray(r.flags) ? r.flags : [];
  const flags: AnswerFlagHit[] = flagsRaw
    .map((f) => {
      if (!f || typeof f !== "object") return null;
      const id = String((f as { id?: string }).id ?? "") as AnswerFlagId;
      if (!(id in ANSWER_FLAG_LABELS)) return null;
      return hit(id);
    })
    .filter((x): x is AnswerFlagHit => Boolean(x));
  return {
    id: String(r.id),
    message_id: typeof r.message_id === "string" ? r.message_id : null,
    question: String(r.question ?? ""),
    flags,
    severity: Number(r.severity) || flags.length,
    metrics:
      r.metrics && typeof r.metrics === "object"
        ? (r.metrics as AnswerFlagMetrics)
        : {},
    status: (r.status as AnswerFlagStatus) || "pending",
    human_verdict:
      r.human_verdict === "good" ||
      r.human_verdict === "bad" ||
      r.human_verdict === "unclear"
        ? r.human_verdict
        : null,
    reviewed_at: typeof r.reviewed_at === "string" ? r.reviewed_at : null,
    reviewed_by: typeof r.reviewed_by === "string" ? r.reviewed_by : null,
    source: (r.source as AnswerFlagSource) || "chat",
    created_at: String(r.created_at ?? "")
  };
}

export async function listAnswerFlags(
  admin: SupabaseClient,
  opts?: {
    status?: AnswerFlagStatus | "all";
    flagId?: AnswerFlagId | null;
    limit?: number;
  }
): Promise<AnswerFlagRow[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  let q = admin
    .from("luna_answer_flags")
    .select("*")
    .order("severity", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (opts?.status && opts.status !== "all") {
    q = q.eq("status", opts.status);
  }
  const { data, error } = await q;
  if (error) {
    if (!isMissingTable(error)) console.error("[luna/answer-flags] list", error);
    return [];
  }
  let rows = (data ?? []).map(parseRow).filter((x): x is AnswerFlagRow => Boolean(x));
  if (opts?.flagId) {
    rows = rows.filter((r) => r.flags.some((f) => f.id === opts.flagId));
  }
  return rows;
}

export async function countPendingAnswerFlags(
  admin: SupabaseClient
): Promise<number> {
  const { count, error } = await admin
    .from("luna_answer_flags")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) {
    if (!isMissingTable(error)) console.error("[luna/answer-flags] count", error);
    return 0;
  }
  return count ?? 0;
}

/** 아침 리포트·사람 점검용 — 심각도 높은 순, 하루 상한 */
export async function listPendingAnswerFlagsForHuman(
  admin: SupabaseClient,
  opts?: { sinceIso?: string; limit?: number }
): Promise<AnswerFlagRow[]> {
  const limit = Math.min(
    opts?.limit ?? T.max_human_per_day,
    T.max_human_per_day
  );
  let q = admin
    .from("luna_answer_flags")
    .select("*")
    .eq("status", "pending")
    .order("severity", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (opts?.sinceIso) {
    q = q.gte("created_at", opts.sinceIso);
  }
  const { data, error } = await q;
  if (error) {
    if (!isMissingTable(error)) console.error("[luna/answer-flags] pending", error);
    return [];
  }
  return (data ?? []).map(parseRow).filter((x): x is AnswerFlagRow => Boolean(x));
}

export async function reviewAnswerFlag(
  admin: SupabaseClient,
  opts: {
    id: string;
    userId: string;
    verdict: AnswerFlagVerdict;
    /** bad 일 때 thumbs 이유 */
    reason?: string | null;
    note?: string | null;
  }
): Promise<AnswerFlagRow | null> {
  const verdict = opts.verdict;
  const status: AnswerFlagStatus =
    verdict === "unclear" ? "ignored" : "reviewed";
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("luna_answer_flags")
    .update({
      status,
      human_verdict: verdict,
      reviewed_at: now,
      reviewed_by: opts.userId
    })
    .eq("id", opts.id)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    if (error && !isMissingTable(error)) {
      console.error("[luna/answer-flags] review", error);
    }
    return null;
  }
  const row = parseRow(data);
  if (!row) return null;

  if (verdict === "good") {
    await insertLunaSignal(admin, {
      kind: "positive",
      source: "question_answer",
      subject_type: "answer",
      subject_id: row.message_id ?? row.id,
      reason: "answer_flag_good",
      note: "모순 지표가 있어도 답은 좋았음",
      context: {
        flag_id: row.id,
        flags: row.flags.map((f) => f.id),
        metrics: row.metrics,
        question: row.question.slice(0, 200)
      },
      user_id: opts.userId
    });
  } else if (verdict === "bad") {
    const reason: ThumbsReason | "other" = isThumbsReason(opts.reason)
      ? opts.reason
      : "other";
    await insertLunaSignal(admin, {
      kind: "negative",
      source: "question_answer",
      subject_type: "answer",
      subject_id: row.message_id ?? row.id,
      reason,
      note: opts.note?.trim() || null,
      context: {
        flag_id: row.id,
        flags: row.flags.map((f) => f.id),
        metrics: row.metrics,
        question: row.question.slice(0, 200)
      },
      user_id: opts.userId
    });
  }

  return row;
}

/** 같은 모순 패턴 3건+ → luna_rules 후보 */
export async function promoteAnswerFlagRules(
  admin: SupabaseClient
): Promise<number> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("luna_answer_flags")
    .select("flags, metrics, question, human_verdict, status")
    .gte("created_at", since)
    .limit(500);
  if (error) {
    if (!isMissingTable(error)) console.error("[luna/answer-flags] promote select", error);
    return 0;
  }

  const counts = new Map<AnswerFlagId, { n: number; samples: string[] }>();
  for (const raw of data ?? []) {
    const flags = Array.isArray(raw.flags) ? raw.flags : [];
    for (const f of flags) {
      const id = String((f as { id?: string })?.id ?? "") as AnswerFlagId;
      if (!(id in ANSWER_FLAG_LABELS)) continue;
      const cur = counts.get(id) ?? { n: 0, samples: [] };
      cur.n += 1;
      if (cur.samples.length < 3 && typeof raw.question === "string") {
        cur.samples.push(raw.question.slice(0, 80));
      }
      counts.set(id, cur);
    }
  }

  let created = 0;
  for (const [flagId, info] of counts) {
    if (info.n < T.rule_promote_min) continue;
    const pattern_value = `answer_flag:${flagId}`;
    const questionText = promoteQuestionText(flagId, info.n, info.samples);
    const { data: existing } = await admin
      .from("luna_rules")
      .select("id, status, signal_count")
      .eq("scope", "search")
      .eq("pattern_type", "rule")
      .eq("pattern_value", pattern_value)
      .maybeSingle();
    if (existing?.id) {
      if (existing.status === "active") continue;
      await admin
        .from("luna_rules")
        .update({
          status: "candidate",
          signal_count: info.n,
          evidence: {
            sample: questionText,
            flag_id: flagId,
            samples: info.samples
          }
        })
        .eq("id", existing.id);
      created += 1;
      continue;
    }
    const { error: insErr } = await admin.from("luna_rules").insert({
      scope: "search",
      pattern_type: "rule",
      pattern_value,
      signal_count: info.n,
      status: "candidate",
      evidence: {
        sample: questionText,
        flag_id: flagId,
        samples: info.samples
      }
    });
    if (insErr) {
      if (!isMissingTable(insErr)) console.error("[luna/answer-flags] rule insert", insErr);
      continue;
    }
    created += 1;
  }
  return created;
}

function promoteQuestionText(
  flagId: AnswerFlagId,
  n: number,
  samples: string[]
): string {
  const label = ANSWER_FLAG_LABELS[flagId];
  if (flagId === "scope_excess") {
    return (
      `정의·짧은 질문에서 범위 과다가 ${n}건 나왔습니다. ` +
      `용어 질문은 위키·용어사전만 보게 할까요?` +
      (samples[0] ? ` (예: ${samples[0]})` : "")
    );
  }
  if (flagId === "slow") {
    return (
      `응답이 30초 넘는 모순이 ${n}건입니다. ` +
      `검색 타임아웃·폴백을 먼저 고칠까요?`
    );
  }
  if (flagId === "low_confidence") {
    return (
      `자신감 ≤7 모순이 ${n}건입니다. ` +
      `쉬운 정의형에서는 검색 범위를 줄이도록 할까요?`
    );
  }
  return (
    `${label} 모순이 ${n}건 쌓였습니다. ` +
    `검색·답변 규칙을 손볼까요?` +
    (samples[0] ? ` (예: ${samples[0]})` : "")
  );
}

/** 메타·타이밍에서 판정 입력 조립 */
export function metricsFromAssistantMeta(
  question: string,
  meta: Record<string, unknown>,
  timing?: {
    search_ms?: number | null;
    embed_ms?: number | null;
    link_ms?: number | null;
    llm_ms?: number | null;
    total_ms?: number | null;
    candidates_found?: number | null;
    candidates_used?: number | null;
  } | null
): EvaluateAnswerFlagsInput {
  const timings =
    meta.timings && typeof meta.timings === "object"
      ? (meta.timings as Record<string, unknown>)
      : {};
  const notion = Array.isArray(meta.notion_sources)
    ? meta.notion_sources.length
    : 0;
  const wiki = Array.isArray(meta.wiki_sources) ? meta.wiki_sources.length : 0;
  const nas = Array.isArray(meta.nas_sources)
    ? meta.nas_sources.length
    : Array.isArray(meta.workserver_sources)
      ? meta.workserver_sources.length
      : 0;
  const glossary = Array.isArray(meta.glossary_hits)
    ? meta.glossary_hits.length
    : Array.isArray(meta.glossary_sources)
      ? meta.glossary_sources.length
      : 0;
  const memory =
    typeof meta.memory_count === "number"
      ? meta.memory_count
      : Array.isArray(meta.injected_knowledge_ids)
        ? meta.injected_knowledge_ids.length
        : 0;

  return {
    question,
    intent_score: num(meta.intent_score),
    confidence_score: num(meta.confidence_score),
    duration_ms:
      timing?.total_ms ??
      num(meta.duration_ms) ??
      num(timings.total_ms),
    search_ms: timing?.search_ms ?? num(timings.search_ms),
    embed_ms: timing?.embed_ms ?? num(timings.embed_ms),
    link_ms: timing?.link_ms ?? num(timings.link_ms),
    llm_ms: timing?.llm_ms ?? num(timings.llm_ms),
    candidates_found:
      timing?.candidates_found ?? num(timings.candidates_found),
    candidates_used:
      timing?.candidates_used ?? num(timings.candidates_used),
    notion_n: notion,
    wiki_n: wiki,
    nas_n: nas,
    glossary_n: glossary,
    memory_n: memory
  };
}

/** 소급·배치 — 기간 내 assistant 메시지에 판정 */
export async function backfillAnswerFlags(
  admin: SupabaseClient,
  opts: { sinceIso: string; untilIso?: string; limit?: number }
): Promise<{ scanned: number; flagged: number; samples: AnswerFlagRow[] }> {
  const limit = Math.min(opts.limit ?? 200, 500);
  let q = admin
    .from("luna_messages")
    .select("id, conversation_id, content, metadata, created_at")
    .eq("role", "assistant")
    .gte("created_at", opts.sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (opts.untilIso) q = q.lt("created_at", opts.untilIso);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  let flagged = 0;
  const samples: AnswerFlagRow[] = [];
  for (const row of data ?? []) {
    const meta =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {};
    const { data: userRow } = await admin
      .from("luna_messages")
      .select("content")
      .eq("conversation_id", row.conversation_id)
      .eq("role", "user")
      .lte("created_at", row.created_at)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const question = String(userRow?.content ?? "").trim() || "(질문 없음)";
    const input = metricsFromAssistantMeta(question, meta);
    const saved = await recordAnswerFlagsIfAny(admin, {
      ...input,
      message_id: String(row.id),
      source: "backfill"
    });
    if (saved) {
      flagged += 1;
      if (samples.length < 10) samples.push(saved);
    }
  }
  await promoteAnswerFlagRules(admin);
  return { scanned: data?.length ?? 0, flagged, samples };
}
