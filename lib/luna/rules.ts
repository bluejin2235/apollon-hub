import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  autoVerdictForSamePair,
  BUILTIN_LINK_RULES,
  classifyClientOrProject,
  humanRuleFromRejectReason,
  isDocTypeStopwordCandidate,
  isGarbageRuleCandidate,
  isSeasonMarker,
  overlappingTokens,
  projectNameTokens,
  rejectReasonKey,
  qaRuleQuestion,
  answerFlagIdFromRule,
  isAskableRuleCandidate,
  type LunaRuleRow,
  type LunaRuleStatus
} from "@/lib/luna/rules-shared";
import { ignorePendingAnswerFlagsByFlag } from "@/lib/luna/answer-flags";
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
): Promise<{ reason_rules: number; stopwords: number; dropped: number }> {
  const proper = await collectProperStopwordsAndRules(admin);
  const mined = await upsertProperCandidates(admin, proper);
  const dropped = await dropNonProperCandidates(admin, proper);
  return { ...mined, dropped };
}

/** 올바른 후보만 candidate 로 유지하고 나머지는 dropped */
async function dropNonProperCandidates(
  admin: SupabaseClient,
  proper: ProperSets
): Promise<number> {
  const rows = await listRules(admin, { status: "candidate" });
  let n = 0;
  for (const row of rows) {
    const shouldKeep =
      (row.pattern_type === "stopword" &&
        proper.stopwords.has(row.pattern_value)) ||
      (row.pattern_type === "rule" &&
        (proper.rules.has(row.pattern_value) ||
          proper.rules.has(row.pattern_value.replace(/^reason:/, ""))));
    if (shouldKeep && !isGarbageRuleCandidate(row)) continue;
    const { error } = await admin
      .from("luna_rules")
      .update({
        status: "dropped",
        evidence: {
          ...row.evidence,
          dropped_reason: "refine_2026_rule_candidates",
          dropped_at: new Date().toISOString()
        }
      })
      .eq("id", row.id)
      .eq("status", "candidate");
    if (!error) n += 1;
  }
  return n;
}

/** 올바른 후보 집합에 없는 candidate 는 dropped 로. */
export async function dropGarbageRuleCandidates(
  admin: SupabaseClient
): Promise<number> {
  const proper = await collectProperStopwordsAndRules(admin);
  return dropNonProperCandidates(admin, proper);
}

type ProperSets = {
  stopwords: Map<string, { count: number; evidence: Record<string, unknown> }>;
  rules: Map<string, { count: number; evidence: Record<string, unknown> }>;
};

async function collectProperStopwordsAndRules(
  admin: SupabaseClient
): Promise<ProperSets> {
  const stopwords = new Map<
    string,
    { count: number; evidence: Record<string, unknown> }
  >();
  const rules = new Map<
    string,
    { count: number; evidence: Record<string, unknown> }
  >();

  const rejected = await loadRejectedSamePairs(admin);
  const projectNames = await loadProjectNameSet(admin);
  const glossary = await loadGlossaryNameSet(admin);

  // ① 불용어: rejected 쌍의 겹친 토큰만 (대화 문장에서 뽑지 않음)
  const wordPairs = new Map<
    string,
    Array<{ left: string; right: string; id: string }>
  >();
  for (const row of rejected) {
    const overlap = overlappingTokens(row.left, row.right);
    for (const w of overlap) {
      const list = wordPairs.get(w) ?? [];
      list.push({ left: row.left, right: row.right, id: row.id });
      wordPairs.set(w, list);
    }
  }

  for (const [word, pairs] of wordPairs) {
    if (pairs.length < 3) continue;
    if (isSeasonMarker(word)) continue;
    // glossary 고유명사는 절대 불용어 후보가 아님
    if (glossary.has(word)) continue;
    const kind = classifyClientOrProject(
      word,
      pairs.map((p) => ({ left: p.left, right: p.right }))
    );
    // 한 계열 프로젝트명 → 불용어 아님
    if (kind === "project") continue;
    // 전역으로도 프로젝트명으로 보이는 앞말 (발주처 분류가 아닐 때)
    if (kind !== "client" && projectNames.has(word)) continue;
    // 문서유형(unknown)은 알려진 유형어만
    if (kind === "unknown" && !isDocTypeStopwordCandidate(word)) continue;
    stopwords.set(word, {
      count: pairs.length,
      evidence: {
        sample: `「${word}」이 겹쳐 잘못 연결된 것이 ${pairs.length}건 있었습니다.`,
        link_ids: pairs.slice(0, 12).map((p) => p.id),
        examples: pairs.slice(0, 3).map((p) => `${p.left} ✕ ${p.right}`),
        classify: kind
      }
    });
  }

  // ③ rule: rejected_reason 이 같은 것 3건+
  const byReason = new Map<string, string[]>();
  for (const row of rejected) {
    const reason = rejectReasonKey(row.evidence);
    if (!reason) continue;
    if (!humanRuleFromRejectReason(reason)) continue;
    const list = byReason.get(reason) ?? [];
    list.push(row.id);
    byReason.set(reason, list);
  }
  for (const [reason, ids] of byReason) {
    if (ids.length < 3) continue;
    // builtin active 와 같은 값이면 후보로 올리지 않음 (이미 활성)
    if (
      reason === "same_client_diff_target" ||
      reason === "same_date_done_marker"
    ) {
      continue;
    }
    const text = humanRuleFromRejectReason(reason)!;
    rules.set(reason, {
      count: ids.length,
      evidence: {
        reason,
        sample: `${text} (${ids.length}건에서 같은 이유로 기각됐습니다. 규칙으로 쓸까요?)`,
        link_ids: ids.slice(0, 12)
      }
    });
  }

  return { stopwords, rules };
}

async function upsertProperCandidates(
  admin: SupabaseClient,
  proper: ProperSets
): Promise<{ reason_rules: number; stopwords: number }> {
  let reasonRules = 0;
  let stopwords = 0;

  for (const [word, info] of proper.stopwords) {
    const ok = await upsertCandidateRule(admin, {
      scope: "link",
      pattern_type: "stopword",
      pattern_value: word,
      signal_count: info.count,
      evidence: info.evidence
    });
    if (ok) stopwords += 1;
  }

  for (const [reason, info] of proper.rules) {
    const ok = await upsertCandidateRule(admin, {
      scope: "link",
      pattern_type: "rule",
      pattern_value: reason,
      signal_count: info.count,
      evidence: info.evidence
    });
    if (ok) reasonRules += 1;
  }

  return { reason_rules: reasonRules, stopwords };
}

type RejectedPair = {
  id: string;
  left: string;
  right: string;
  evidence: Record<string, unknown>;
};

async function loadRejectedSamePairs(
  admin: SupabaseClient
): Promise<RejectedPair[]> {
  const rows: RejectedPair[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("luna_links")
      .select("id, evidence, from_id, to_id")
      .eq("kind", "same")
      .eq("status", "rejected")
      .order("id")
      .range(from, from + 499);
    if (error) {
      if (!isMissingTable(error)) console.error("[luna/rules] rejected", error);
      break;
    }
    const part = data ?? [];
    for (const row of part) {
      const left = evidenceTitle(row as never, "from");
      const right = evidenceTitle(row as never, "to");
      rows.push({
        id: row.id as string,
        left,
        right,
        evidence: (row.evidence as Record<string, unknown>) ?? {}
      });
    }
    if (part.length < 500) break;
    from += 500;
  }
  return rows;
}

/**
 * 프로젝트 고유명사 집합.
 * - glossary 는 별도 로드
 * - 전역으로 「앞말 + 의미 있는 뒷말이 거의 하나」인 토큰만 프로젝트명
 *   (문서유형만 다른 시리즈명 포함)
 */
async function loadProjectNameSet(admin: SupabaseClient): Promise<Set<string>> {
  const prefixTails = new Map<string, Set<string>>();
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("luna_links")
      .select("evidence")
      .eq("kind", "same")
      .order("id")
      .range(from, from + 499);
    if (error) {
      if (!isMissingTable(error)) console.error("[luna/rules] projects", error);
      break;
    }
    const part = data ?? [];
    for (const row of part) {
      for (const side of ["from", "to"] as const) {
        const title = evidenceTitle(row as never, side);
        const tokens = projectNameTokens(title);
        if (tokens.length === 0) continue;
        const head = tokens[0]!;
        // 문서유형을 뺀 뒷말 — 없으면 시리즈 단독
        const rest = tokens.slice(1).filter((t) => {
          const noise = [
            "콘텐츠",
            "컨텐츠",
            "제안서",
            "프로젝트",
            "리뉴얼",
            "제작",
            "구축",
            "최종",
            "tj",
            "eb",
            "bl"
          ];
          return !noise.includes(t);
        });
        const tail = rest.join(" ") || "(series)";
        const set = prefixTails.get(head) ?? new Set<string>();
        set.add(tail);
        prefixTails.set(head, set);
      }
    }
    if (part.length < 500) break;
    from += 500;
  }

  const out = new Set<string>();
  for (const [head, tails] of prefixTails) {
    // 의미 있는 뒷말 종류 ≤1 → 프로젝트/시리즈명
    if (tails.size <= 1) out.add(head);
  }
  return out;
}

async function loadGlossaryNameSet(admin: SupabaseClient): Promise<Set<string>> {
  const set = new Set<string>();
  const { data } = await admin
    .from("glossary_terms")
    .select("term_ko")
    .limit(2000);
  for (const row of data ?? []) {
    const t = typeof row.term_ko === "string" ? row.term_ko.trim().toLowerCase() : "";
    if (t.length >= 2) set.add(t);
  }
  return set;
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
    if (existing.status === "active") return false;
    // dropped 였어도 정제 기준에 맞으면 candidate 로 다시 연다
    await admin
      .from("luna_rules")
      .update({
        status: "candidate",
        signal_count: row.signal_count,
        evidence: row.evidence,
        confirmed_at: null,
        confirmed_by: null
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
  const content = qaRuleQuestion(rule);
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

  const flagId = answerFlagIdFromRule(rule.pattern_value);
  if (flagId) {
    await ignorePendingAnswerFlagsByFlag(admin, flagId, userId);
    return;
  }

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
  const rows = (await listRules(admin, { status: "candidate" })).filter(
    isAskableRuleCandidate
  );
  return rows.map((r) => ({
    id: r.id,
    title: "🌙 루나가 규칙을 물어봅니다",
    body: qaRuleQuestion(r),
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
