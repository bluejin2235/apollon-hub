import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  autoVerdictForSamePair,
  BUILTIN_LINK_RULES,
  ruleQuestionText,
  type LunaRuleRow,
  type LunaRuleStatus
} from "@/lib/luna/rules-shared";
import { evidenceTitle } from "@/lib/luna-admin/links";

function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: string }).code) : "";
  const msg =
    "message" in error ? String((error as { message?: string }).message) : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("luna_rules") ||
    msg.includes("does not exist")
  );
}

export async function listRules(
  admin: SupabaseClient,
  opts?: { status?: LunaRuleStatus | LunaRuleStatus[] }
): Promise<LunaRuleRow[]> {
  let q = admin.from("luna_rules").select("*").order("created_at", { ascending: false });
  if (opts?.status) {
    if (Array.isArray(opts.status)) q = q.in("status", opts.status);
    else q = q.eq("status", opts.status);
  }
  const { data, error } = await q;
  if (error) {
    if (!isMissingTable(error)) console.error("[luna/rules] list", error);
    return [];
  }
  return (data ?? []) as LunaRuleRow[];
}

export async function ensureBuiltinLinkRules(
  admin: SupabaseClient
): Promise<number> {
  let n = 0;
  for (const rule of BUILTIN_LINK_RULES) {
    const { data: existing } = await admin
      .from("luna_rules")
      .select("id, status")
      .eq("scope", "link")
      .eq("pattern_type", rule.pattern_type)
      .eq("pattern_value", rule.pattern_value)
      .maybeSingle();
    if (existing?.id) {
      if (rule.auto && existing.status === "candidate") {
        await admin
          .from("luna_rules")
          .update({
            status: "active",
            confirmed_at: new Date().toISOString(),
            evidence: {
              builtin: true,
              auto: true,
              question: rule.question
            }
          })
          .eq("id", existing.id);
        n += 1;
      }
      continue;
    }
    const { error } = await admin.from("luna_rules").insert({
      scope: "link",
      pattern_type: rule.pattern_type,
      pattern_value: rule.pattern_value,
      signal_count: 0,
      status: rule.auto ? "active" : "candidate",
      confirmed_at: rule.auto ? new Date().toISOString() : null,
      evidence: { builtin: true, auto: rule.auto, question: rule.question }
    });
    if (error) {
      if (!isMissingTable(error)) console.error("[luna/rules] builtin", error);
      continue;
    }
    n += 1;
  }
  return n;
}

export type RejudgeNeedReport = {
  scanned: number;
  confirmed: number;
  rejected: number;
  left: number;
};

/** 확인 필요(비인간·비기각) same 링크에 내장 규칙 적용 */
export async function rejudgeNeedWithBuiltinRules(
  admin: SupabaseClient
): Promise<RejudgeNeedReport> {
  await ensureBuiltinLinkRules(admin);
  const report: RejudgeNeedReport = {
    scanned: 0,
    confirmed: 0,
    rejected: 0,
    left: 0
  };

  const { data, error } = await admin
    .from("luna_links")
    .select("*")
    .eq("kind", "same")
    .neq("source", "human")
    .neq("status", "rejected")
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  report.scanned = rows.length;
  const now = new Date().toISOString();

  for (const row of rows) {
    const left = evidenceTitle(row as never, "from");
    const right = evidenceTitle(row as never, "to");
    const verdict = autoVerdictForSamePair(left, right);
    if (verdict === "confirm") {
      const ev = {
        ...((row.evidence as Record<string, unknown>) ?? {}),
        auto_rule: "same_date_done_marker",
        note: "자동 확정 · 날짜코드+완료표기"
      };
      const { error: upErr } = await admin
        .from("luna_links")
        .update({
          status: "active",
          source: "human",
          confidence: Math.max(Number(row.confidence) || 0, 0.9),
          evidence: ev,
          confirmed_at: now
        })
        .eq("id", row.id);
      if (upErr) throw new Error(upErr.message);
      await admin
        .from("luna_questions")
        .update({
          status: "answered",
          answer: "같아요",
          answered_at: now
        })
        .eq("link_id", row.id)
        .eq("status", "pending");
      report.confirmed += 1;
      continue;
    }
    if (verdict === "reject") {
      const ev = {
        ...((row.evidence as Record<string, unknown>) ?? {}),
        auto_rule: "same_client_diff_target"
      };
      const { error: upErr } = await admin
        .from("luna_links")
        .update({
          status: "rejected",
          evidence: ev
        })
        .eq("id", row.id);
      if (upErr) throw new Error(upErr.message);
      // 연결된 질문도 닫기
      await admin
        .from("luna_questions")
        .update({
          status: "answered",
          answer: "달라요",
          answered_at: now
        })
        .eq("link_id", row.id)
        .eq("status", "pending");
      report.rejected += 1;
      continue;
    }
    report.left += 1;
  }
  return report;
}

export async function mineRuleCandidatesFromSignals(
  admin: SupabaseClient
): Promise<{ reason_rules: number; stopwords: number }> {
  const { data, error } = await admin
    .from("luna_signals")
    .select("id, reason, note, context, source")
    .eq("kind", "negative")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    if (!isMissingTable(error)) console.error("[luna/rules] mine", error);
    return { reason_rules: 0, stopwords: 0 };
  }

  const byReason = new Map<string, string[]>();
  const wordHits = new Map<string, string[]>();

  for (const row of data ?? []) {
    const id = row.id as string;
    const reason = typeof row.reason === "string" ? row.reason.trim() : "";
    if (reason && reason !== "other") {
      const list = byReason.get(reason) ?? [];
      list.push(id);
      byReason.set(reason, list);
    }
    const ctx = (row.context ?? {}) as Record<string, unknown>;
    const blob = [
      typeof ctx.from_title === "string" ? ctx.from_title : "",
      typeof ctx.to_title === "string" ? ctx.to_title : "",
      typeof row.note === "string" ? row.note : ""
    ]
      .join(" ")
      .toLowerCase();
    const words = blob.match(/[가-힣]{2,12}/g) ?? [];
    const uniq = [...new Set(words)];
    for (const w of uniq) {
      if (w.length < 3) continue;
      const list = wordHits.get(w) ?? [];
      if (list.length < 20) list.push(id);
      wordHits.set(w, list);
    }
  }

  let reasonRules = 0;
  for (const [reason, ids] of byReason) {
    if (ids.length < 3) continue;
    const patternValue = `reason:${reason}`;
    const upserted = await upsertCandidateRule(admin, {
      scope: "link",
      pattern_type: "rule",
      pattern_value: patternValue,
      signal_count: ids.length,
      evidence: {
        reason,
        signal_ids: ids.slice(0, 12),
        sample: ruleQuestionText({
          pattern_type: "rule",
          pattern_value: patternValue,
          signal_count: ids.length,
          evidence: { sample: `같은 이유「${reason}」가 ${ids.length}건` }
        })
      }
    });
    if (upserted) reasonRules += 1;
  }

  let stopwords = 0;
  for (const [word, ids] of wordHits) {
    if (ids.length < 3) continue;
    const upserted = await upsertCandidateRule(admin, {
      scope: "link",
      pattern_type: "stopword",
      pattern_value: word,
      signal_count: ids.length,
      evidence: {
        signal_ids: ids.slice(0, 12),
        sample: `「${word}」이 겹쳐 잘못 연결된 것이 ${ids.length}건 있었습니다.`
      }
    });
    if (upserted) stopwords += 1;
  }

  return { reason_rules: reasonRules, stopwords };
}

async function upsertCandidateRule(
  admin: SupabaseClient,
  row: {
    scope: "link";
    pattern_type: "rule" | "stopword";
    pattern_value: string;
    signal_count: number;
    evidence: Record<string, unknown>;
  }
): Promise<boolean> {
  const { data: existing } = await admin
    .from("luna_rules")
    .select("id, status, signal_count")
    .eq("scope", row.scope)
    .eq("pattern_type", row.pattern_type)
    .eq("pattern_value", row.pattern_value)
    .maybeSingle();
  if (existing?.id) {
    if (existing.status === "dropped" || existing.status === "active") return false;
    await admin
      .from("luna_rules")
      .update({
        signal_count: Math.max(existing.signal_count ?? 0, row.signal_count),
        evidence: row.evidence
      })
      .eq("id", existing.id);
    return true;
  }
  const { error } = await admin.from("luna_rules").insert({
    ...row,
    status: "candidate"
  });
  if (error) {
    if (!isMissingTable(error)) console.error("[luna/rules] upsert", error);
    return false;
  }
  return true;
}

export async function confirmRule(
  admin: SupabaseClient,
  ruleId: string,
  userId: string,
  accept: boolean
): Promise<LunaRuleRow | null> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("luna_rules")
    .update({
      status: accept ? "active" : "dropped",
      confirmed_at: now,
      confirmed_by: userId
    })
    .eq("id", ruleId)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    if (error && !isMissingTable(error)) console.error("[luna/rules] confirm", error);
    return null;
  }
  const rule = data as LunaRuleRow;
  if (accept) {
    await applyActiveRule(admin, rule, userId);
  }
  return rule;
}

async function applyActiveRule(
  admin: SupabaseClient,
  rule: LunaRuleRow,
  userId: string
): Promise<void> {
  // 검색·답변에도 쓰이도록 판단 기준 저장
  const content =
    typeof rule.evidence?.sample === "string" && rule.evidence.sample
      ? String(rule.evidence.sample)
      : ruleQuestionText(rule);
  await admin.from("luna_learnings").insert({
    category: "criterion",
    content: content.slice(0, 800),
    status: "active",
    source: "self",
    origin: "rule",
    author_id: userId,
    meta: {
      from_rule: true,
      rule_id: rule.id,
      scope: rule.scope,
      pattern_type: rule.pattern_type,
      pattern_value: rule.pattern_value
    },
    confidence: 4,
    importance: 4
  });

  if (rule.scope !== "link") return;

  if (rule.pattern_type === "stopword") {
    // stopword 는 다음 build-links / rejudge 에서 SAME_STOPWORDS 와 합쳐 쓰도록 evidence 만 남김
    return;
  }

  if (
    rule.pattern_value === "same_date_done_marker" ||
    rule.pattern_value === "same_client_diff_target" ||
    rule.pattern_value.startsWith("reason:")
  ) {
    await rejudgeNeedWithBuiltinRules(admin);
  }
}

export async function listCandidateRuleQuestions(
  admin: SupabaseClient
): Promise<
  Array<{
    id: string;
    title: string;
    body: string;
    signal_count: number;
    pattern_type: string;
    pattern_value: string;
  }>
> {
  const rows = await listRules(admin, { status: "candidate" });
  return rows.map((r) => ({
    id: r.id,
    title: "🌙 루나가 규칙을 물어봅니다",
    body: ruleQuestionText(r),
    signal_count: r.signal_count,
    pattern_type: r.pattern_type,
    pattern_value: r.pattern_value
  }));
}

export async function countRulesByStatus(
  admin: SupabaseClient
): Promise<Record<LunaRuleStatus, number>> {
  const out: Record<LunaRuleStatus, number> = {
    candidate: 0,
    active: 0,
    dropped: 0
  };
  for (const status of Object.keys(out) as LunaRuleStatus[]) {
    const { count, error } = await admin
      .from("luna_rules")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    if (error) {
      if (!isMissingTable(error)) console.error("[luna/rules] count", error);
      continue;
    }
    out[status] = count ?? 0;
  }
  return out;
}
