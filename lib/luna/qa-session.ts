import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAnswerFlags, reviewAnswerFlag } from "@/lib/luna/answer-flags";
import { groupAnswerFlagsByQuestion } from "@/lib/luna/answer-flags-shared";
import { lunaLlmComplete } from "@/lib/luna/llm/client";
import {
  answerOptions,
  ruleOptions,
  skipOptions,
  type QaAnswer,
  type QaItem,
  type QaPair,
  type QaPending,
  type QaSessionView,
  type QaSummary
} from "@/lib/luna/qa-options";
import { confirmRule, listRules } from "@/lib/luna/rules";
import {
  QA_DAILY_LIMIT,
  QA_LIST_VERSION,
  answerFlagIdFromRule,
  isAskableRuleCandidate,
  qaRuleQuestion
} from "@/lib/luna/rules-shared";
import {
  excludeTonightItem,
  loadTonightState
} from "@/lib/luna-admin/tonight";
import { evidencePath, evidenceTitle } from "@/lib/luna-admin/links";
import { typeLabel } from "@/lib/luna-admin/pair-view";
import type { AnswerFlagRow } from "@/lib/luna/answer-flags";

export type QaSessionRow = QaSessionView;

function parseExamples(raw: unknown): QaPair[] {
  if (!Array.isArray(raw)) return [];
  const pairs: QaPair[] = [];
  for (const row of raw) {
    if (typeof row !== "string") continue;
    const parts = row.split(/\s*[✕×xX]\s*/);
    if (parts.length < 2) continue;
    pairs.push({
      left: { name: parts[0]!.trim(), path: "" },
      right: { name: parts[1]!.trim(), path: "" }
    });
    if (pairs.length >= 2) break;
  }
  return pairs;
}

async function pairsFromLinks(
  admin: SupabaseClient,
  ids: unknown
): Promise<QaPair[]> {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const uuid = ids.filter((x): x is string => typeof x === "string").slice(0, 2);
  if (uuid.length === 0) return [];
  const { data } = await admin.from("luna_links").select("*").in("id", uuid);
  return (data ?? []).map((row) => {
    const r = row as Parameters<typeof evidenceTitle>[0];
    return {
      left: {
        name: evidenceTitle(r, "from"),
        path:
          evidencePath(r, "from") ||
          typeLabel(String((row as { from_type?: string }).from_type ?? ""))
      },
      right: {
        name: evidenceTitle(r, "to"),
        path:
          evidencePath(r, "to") ||
          typeLabel(String((row as { to_type?: string }).to_type ?? ""))
      }
    };
  });
}

function formatMetrics(m: Record<string, unknown>, extra?: string): string {
  const docs = typeof m.total_docs === "number" ? `문서 ${m.total_docs}` : "";
  const ms =
    typeof m.duration_ms === "number"
      ? `${(m.duration_ms / 1000).toFixed(1)}초`
      : "";
  return [docs, ms, extra].filter(Boolean).join(" · ");
}

function flagMetricScore(row: AnswerFlagRow): number {
  const m = row.metrics ?? {};
  let n = 0;
  if (typeof m.duration_ms === "number") n += 4;
  if (typeof m.search_ms === "number") n += 2;
  if (typeof m.total_docs === "number") n += 1;
  if (typeof m.notion_n === "number" || typeof m.nas_n === "number") n += 1;
  return n;
}

function pickFlag(rows: AnswerFlagRow[], flagId: string): AnswerFlagRow | undefined {
  const hits = rows.filter((r) => r.flags.some((f) => f.id === flagId));
  if (hits.length === 0) return undefined;
  return [...hits].sort((a, b) => flagMetricScore(b) - flagMetricScore(a))[0]!;
}

function sessionListVersion(session: QaSessionRow): number {
  const v = session.items[0]?.list_version;
  return typeof v === "number" ? v : 0;
}

function stampItems(items: QaItem[]): QaItem[] {
  return items.map((item) => ({ ...item, list_version: QA_LIST_VERSION }));
}

async function closeOpenSession(
  admin: SupabaseClient,
  sessionId: string
): Promise<void> {
  await admin
    .from("luna_qa_sessions")
    .update({ finished_at: new Date().toISOString(), pending: null })
    .eq("id", sessionId);
}

function flagStats(flagId: string, row: AnswerFlagRow | undefined): {
  title: string;
  stats: string[];
} {
  const m = row?.metrics ?? {};
  const notion = typeof m.notion_n === "number" ? m.notion_n : 0;
  const nas = typeof m.nas_n === "number" ? m.nas_n : 0;
  const wiki = typeof m.wiki_n === "number" ? m.wiki_n : 0;
  const docs = typeof m.total_docs === "number" ? m.total_docs : 0;
  const share =
    typeof m.dominant_share === "number"
      ? Math.round(m.dominant_share * 100)
      : null;
  const dur =
    typeof m.duration_ms === "number" ? (m.duration_ms / 1000).toFixed(1) : null;
  const search =
    typeof m.search_ms === "number" ? Math.round(m.search_ms) : null;

  if (flagId === "source_skew") {
    return {
      title: "이렇게 찾았습니다",
      stats: [
        `이 답은 노션에서만 ${notion || docs}건을 가져왔습니다`,
        `Work서버 ${nas} · 위키 ${wiki}${share != null ? ` · 노션 ${share}%` : ""}`
      ].filter((s) => s.trim().length > 0)
    };
  }
  if (flagId === "slow") {
    const line = [
      dur ? `${dur}초` : null,
      search != null ? `검색 ${search}ms` : null,
      docs ? `문서 ${docs}건` : null
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      title: "이렇게 오래 걸렸습니다",
      stats: line ? [line] : []
    };
  }
  if (flagId === "scope_excess") {
    return {
      title: "이렇게 넓게 찾았습니다",
      stats: docs ? [`짧은 질문인데 문서 ${docs}건을 가져왔습니다`] : []
    };
  }
  const extra = formatMetrics(m as Record<string, unknown>);
  return {
    title: "이렇게 나왔습니다",
    stats: extra ? [extra] : []
  };
}

export async function buildQaItems(admin: SupabaseClient): Promise<QaItem[]> {
  const [rules, flags, tonight] = await Promise.all([
    listRules(admin, { status: "candidate" }),
    listAnswerFlags(admin, { status: "pending", limit: 200 }),
    loadTonightState(admin)
  ]);
  const sortedRules = [...rules]
    .filter(isAskableRuleCandidate)
    .sort((a, b) => (b.signal_count ?? 0) - (a.signal_count ?? 0));

  const coveredFlags = new Set<string>();
  const ruleItems: QaItem[] = [];
  for (const row of sortedRules) {
    const n = row.signal_count ?? 0;
    const flagId = answerFlagIdFromRule(row.pattern_value);
    if (flagId) coveredFlags.add(flagId);
    const fromExamples = parseExamples(row.evidence?.examples);
    const fromLinks = await pairsFromLinks(admin, row.evidence?.link_ids);
    const pairs = fromLinks.length > 0 ? fromLinks.slice(0, 2) : fromExamples;
    const stats = flagId ? flagStats(flagId, pickFlag(flags, flagId)) : null;
    const isPairRule = !flagId && pairs.length > 0;
    const flagStatsLines = (stats?.stats ?? []).filter((s) => s.trim().length > 0);
    ruleItems.push({
      kind: "rule",
      ref_id: row.id,
      pattern_value: row.pattern_value,
      question: qaRuleQuestion(row),
      why: flagId
        ? `${n}번 있었습니다. 규칙을 정하면 하나씩은 안 묻습니다.`
        : undefined,
      impact: n,
      options: ruleOptions({
        pattern_type: row.pattern_type,
        pattern_value: row.pattern_value,
        n
      }),
      pairs: isPairRule ? pairs : undefined,
      evidence_title: flagId
        ? stats?.title ?? "이렇게 나왔습니다"
        : isPairRule
          ? "이렇게 잘못 연결한 것이 있었어요"
          : undefined,
      stats: flagId
        ? flagStatsLines.length > 0
          ? flagStatsLines
          : [`이 모순이 ${n}번 있었습니다`]
        : undefined
    });
  }

  const grouped = groupAnswerFlagsByQuestion(
    flags.filter((f) => !f.flags.some((hit) => coveredFlags.has(hit.id)))
  );
  const answerItems: QaItem[] = grouped.map((g) => {
    const m = (g.latest.metrics ?? {}) as Record<string, unknown>;
    const flagIds = g.latest.flags.map((f) => f.id);
    const slow = flagIds.includes("slow");
    const skew = flagIds.includes("source_skew");
    const stats = slow
      ? flagStats("slow", g.latest).stats
      : skew
        ? flagStats("source_skew", g.latest).stats
        : undefined;
    return {
      kind: "answer",
      ref_id: g.latest.id,
      ref_ids: g.items.map((x) => x.id),
      question: `“${g.question}” 이 답이 맞았나요?`,
      options: answerOptions(),
      samples: [g.question],
      flags: g.latest.flags.map((f) => f.label),
      metrics: stats?.length ? undefined : formatMetrics(m, g.count > 1 ? `같은 질문 ${g.count}번` : ""),
      evidence_title: slow
        ? "이렇게 오래 걸렸습니다"
        : skew
          ? "이렇게 찾았습니다"
          : undefined,
      stats,
      impact: g.count
    };
  });

  const skips = (tonight.items ?? []).filter(
    (i) => !i.excluded && (i.when === "tomorrow" || i.verifiable === false)
  );
  const skipItems: QaItem[] = skips.map((item) => ({
    kind: "skip",
    ref_id: item.id,
    question: item.title,
    why: item.skip_reason ?? item.why,
    options: skipOptions({
      skip_reason: item.skip_reason,
      why: item.why
    })
  }));

  const out: QaItem[] = [];
  for (const item of [...ruleItems, ...answerItems, ...skipItems]) {
    if (out.length >= QA_DAILY_LIMIT) break;
    out.push(item);
  }
  return stampItems(out);
}

function asSession(row: Record<string, unknown>): QaSessionRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    conversation_id:
      typeof row.conversation_id === "string" ? row.conversation_id : null,
    items: Array.isArray(row.items) ? (row.items as QaItem[]) : [],
    cursor: typeof row.cursor === "number" ? row.cursor : 0,
    answers: Array.isArray(row.answers) ? (row.answers as QaAnswer[]) : [],
    pending:
      row.pending && typeof row.pending === "object"
        ? (row.pending as QaPending)
        : null,
    started_at: String(row.started_at),
    finished_at:
      typeof row.finished_at === "string" ? row.finished_at : null,
    summary:
      row.summary && typeof row.summary === "object"
        ? (row.summary as QaSummary)
        : null
  };
}

async function ensureConversation(
  admin: SupabaseClient,
  userId: string,
  existing: string | null
): Promise<string | null> {
  if (existing) return existing;
  const { data, error } = await admin
    .from("luna_conversations")
    .insert({
      user_id: userId,
      title: "문답",
      engine: "auto"
    })
    .select("id")
    .single();
  if (error) {
    console.error("[luna/qa] conversation", error);
    return null;
  }
  return typeof data?.id === "string" ? data.id : null;
}

export async function getOpenQaSession(
  admin: SupabaseClient,
  userId: string
): Promise<QaSessionRow | null> {
  const { data, error } = await admin
    .from("luna_qa_sessions")
    .select("*")
    .eq("user_id", userId)
    .is("finished_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[luna/qa] open", error);
    return null;
  }
  return data ? asSession(data as Record<string, unknown>) : null;
}

export async function restartQaSession(
  admin: SupabaseClient,
  userId: string
): Promise<QaSessionRow> {
  const open = await getOpenQaSession(admin, userId);
  if (open) await closeOpenSession(admin, open.id);
  return startQaSession(admin, userId);
}

export async function startQaSession(
  admin: SupabaseClient,
  userId: string
): Promise<QaSessionRow> {
  const open = await getOpenQaSession(admin, userId);
  if (open) {
    const stale = sessionListVersion(open) !== QA_LIST_VERSION;
    if (stale) {
      await closeOpenSession(admin, open.id);
    } else if (open.items.length === 0) {
      await closeOpenSession(admin, open.id);
    } else if (open.cursor >= open.items.length) {
      return finishIfDone(admin, open);
    } else if (open.cursor === 0 && open.answers.length === 0) {
      const items = await buildQaItems(admin);
      if (items.length === 0) {
        return saveRow(admin, open.id, {
          items: [],
          finished_at: new Date().toISOString(),
          pending: null
        });
      }
      return saveRow(admin, open.id, { items, pending: null, summary: null });
    } else {
      return open;
    }
  }
  const items = await buildQaItems(admin);
  if (items.length === 0) {
    return {
      id: "",
      user_id: userId,
      conversation_id: null,
      items: [],
      cursor: 0,
      answers: [],
      pending: null,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      summary: null
    };
  }
  const conversationId = await ensureConversation(admin, userId, null);
  const { data, error } = await admin
    .from("luna_qa_sessions")
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      items,
      cursor: 0,
      answers: []
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "세션을 만들지 못했습니다");
  }
  return asSession(data as Record<string, unknown>);
}

function mapVoiceAccept(
  kind: QaItem["kind"],
  accept: boolean | null
): string {
  if (kind === "answer") {
    return accept === true ? "good" : accept === false ? "bad" : "inspect";
  }
  if (kind === "skip") {
    return accept === true ? "ack" : "hold";
  }
  return accept === true ? "accept" : accept === false ? "reject" : "inspect";
}

async function applyChoice(
  admin: SupabaseClient,
  userId: string,
  item: QaItem,
  optionId: string,
  transcript?: string
): Promise<{ impact: number }> {
  if (item.kind === "rule") {
    if (optionId === "accept") {
      const row = await confirmRule(admin, item.ref_id, userId, true);
      return { impact: item.impact ?? row?.signal_count ?? 0 };
    }
    if (optionId === "reject") {
      await confirmRule(admin, item.ref_id, userId, false);
      return { impact: 0 };
    }
    return { impact: 0 };
  }
  if (item.kind === "answer") {
    const ids = item.ref_ids ?? [item.ref_id];
    if (optionId === "inspect") return { impact: 0 };
    const verdict =
      optionId === "good" ? "good" : optionId === "ack" ? "unclear" : "bad";
    const reason =
      optionId === "wrong_answer" || optionId === "bad" ? "wrong_answer" : null;
    for (const id of ids) {
      await reviewAnswerFlag(admin, {
        id,
        userId,
        verdict,
        reason,
        note: transcript ?? null
      });
    }
    return { impact: ids.length };
  }
  if (optionId === "ack" || optionId === "hold") {
    await excludeTonightItem(admin, item.ref_id);
  }
  return { impact: 0 };
}

async function insertCandidateFromVoice(
  admin: SupabaseClient,
  userId: string,
  summary: string
): Promise<void> {
  const slug = `voice:${summary.slice(0, 40)}`;
  await admin.from("luna_rules").insert({
    scope: "link",
    pattern_type: "rule",
    pattern_value: slug,
    signal_count: 0,
    status: "candidate",
    evidence: {
      sample: summary,
      from_voice: true,
      confirmed_by: userId
    }
  });
}

export async function interpretQaVoice(
  admin: SupabaseClient,
  item: QaItem,
  transcript: string
): Promise<QaPending> {
  const result = await lunaLlmComplete(admin, {
    tier: "C",
    feature: "understand",
    system: `사람은 루나 문답에서 선택지 대신 말로 답했다. JSON만 출력.
{"current":{"summary":"지금 질문에 대한 한 줄 이해","accept":true},
 "extra":{"summary":"질문에 없는 새 규칙. 없으면 null"}}
accept 는 규칙/답이 맞다(true) / 아니다(false) / 불명(null). extra 는 새로 알려준 규칙만.`,
    user: `질문: ${item.question}\n말한 것: ${transcript}`,
    maxTokens: 400
  });
  let current = { summary: transcript.slice(0, 120), accept: null as boolean | null };
  let extra: { summary: string } | null = null;
  try {
    const json = JSON.parse(result.text.replace(/```json|```/g, "").trim()) as {
      current?: { summary?: string; accept?: boolean | null };
      extra?: { summary?: string } | null;
    };
    if (json.current?.summary) {
      current = {
        summary: String(json.current.summary).slice(0, 200),
        accept:
          json.current.accept === true
            ? true
            : json.current.accept === false
              ? false
              : null
      };
    }
    if (json.extra?.summary) extra = { summary: String(json.extra.summary).slice(0, 200) };
  } catch {
    /* 원문 유지 */
  }
  return { transcript, current, extra };
}

async function saveRow(
  admin: SupabaseClient,
  id: string,
  patch: Record<string, unknown>
): Promise<QaSessionRow> {
  const { data, error } = await admin
    .from("luna_qa_sessions")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "세션 저장 실패");
  return asSession(data as Record<string, unknown>);
}

function buildSummary(session: QaSessionRow): QaSummary {
  const rules: QaSummary["rules"] = [];
  let good = 0;
  let bad = 0;
  let skip = 0;
  let resolved = 0;
  for (const a of session.answers) {
    if (a.kind === "rule" && a.option_id === "accept") {
      const item = session.items[a.index];
      rules.push({
        text: item?.question ?? "규칙",
        impact: a.impact ?? item?.impact ?? 0
      });
      resolved += a.impact ?? item?.impact ?? 0;
    }
    if (a.kind === "answer") {
      if (a.option_id === "good") good += 1;
      else if (a.option_id === "inspect") skip += 1;
      else bad += 1;
      resolved += a.impact ?? 1;
    }
    if (a.kind === "skip") skip += 1;
  }
  return {
    asked: session.items.length,
    resolved,
    rules,
    answers: { good, bad, skip }
  };
}

export async function finishIfDone(
  admin: SupabaseClient,
  session: QaSessionRow
): Promise<QaSessionRow> {
  if (session.cursor < session.items.length) return session;
  if (session.finished_at) return session;
  const summary = buildSummary(session);
  return saveRow(admin, session.id, {
    finished_at: new Date().toISOString(),
    pending: null,
    summary
  });
}

export async function answerQaChoice(opts: {
  admin: SupabaseClient;
  userId: string;
  sessionId: string;
  optionId: string;
  transcript?: string;
}): Promise<QaSessionRow> {
  const { data, error } = await opts.admin
    .from("luna_qa_sessions")
    .select("*")
    .eq("id", opts.sessionId)
    .eq("user_id", opts.userId)
    .maybeSingle();
  if (error || !data) throw new Error("세션이 없습니다");
  let session = asSession(data as Record<string, unknown>);
  if (session.finished_at) return session;

  if (session.pending) {
    if (opts.optionId === "retry") {
      return saveRow(opts.admin, session.id, { pending: null });
    }
    const pending = session.pending;
    const item = session.items[session.cursor];
    if (!item) return finishIfDone(opts.admin, session);
    const takeExtra = opts.optionId === "both" && pending.extra;
    const accept =
      opts.optionId === "both" || opts.optionId === "first_only"
        ? pending.current.accept
        : null;
    const mapped = mapVoiceAccept(item.kind, accept);
    const applied = await applyChoice(
      opts.admin,
      opts.userId,
      item,
      mapped,
      pending.transcript
    );
    if (takeExtra && pending.extra) {
      await insertCandidateFromVoice(opts.admin, opts.userId, pending.extra.summary);
    }
    const answers = [
      ...session.answers,
      {
        index: session.cursor,
        kind: item.kind,
        ref_id: item.ref_id,
        option_id: mapped,
        transcript: pending.transcript,
        applied: true,
        impact: applied.impact
      }
    ];
    session = await saveRow(opts.admin, session.id, {
      cursor: session.cursor + 1,
      answers,
      pending: null
    });
    return finishIfDone(opts.admin, session);
  }

  const item = session.items[session.cursor];
  if (!item) return finishIfDone(opts.admin, session);

  if (opts.optionId === "other") {
    return session;
  }

  if (opts.transcript && opts.optionId === "voice") {
    const pending = await interpretQaVoice(opts.admin, item, opts.transcript);
    return saveRow(opts.admin, session.id, { pending });
  }

  const applied = await applyChoice(
    opts.admin,
    opts.userId,
    item,
    opts.optionId,
    opts.transcript
  );
  const answers = [
    ...session.answers,
    {
      index: session.cursor,
      kind: item.kind,
      ref_id: item.ref_id,
      option_id: opts.optionId,
      transcript: opts.transcript,
      applied: opts.optionId !== "inspect",
      impact: applied.impact
    }
  ];
  session = await saveRow(opts.admin, session.id, {
    cursor: session.cursor + 1,
    answers,
    pending: null
  });
  return finishIfDone(opts.admin, session);
}
