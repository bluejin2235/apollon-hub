import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTierModel, resolveAnthropicModel } from "@/lib/luna/engine";
import { LUNA_LINKS, lunaNotify } from "@/lib/luna/notify";
import {
  runLunaTurn,
  type LunaConnectors
} from "@/lib/luna/run-chat";

export type EvalExamTrigger =
  | "manual"
  | "prompt_change"
  | "consolidation"
  | "cron_light"
  | "cron_heavy";

export type EvalTier = "light" | "heavy";

export type EvalFailKind = "must_pass" | "quality";

export type EvalGrade = {
  score: 0 | 0.5 | 1;
  pass: boolean;
  fail_kind: EvalFailKind | null;
  reason: string;
  must_pass_ok: boolean;
  quality_ok: boolean | null;
};

export type EvalExamResult = {
  skipped: boolean;
  reason?: string;
  run_id?: string;
  tier?: string | null;
  total?: number;
  passed?: number;
  failed?: number;
  score_sum?: number;
  score_max?: number;
  previous_passed?: number | null;
  previous_total?: number | null;
  previous_score_sum?: number | null;
  previous_score_max?: number | null;
  score_dropped?: boolean;
  must_pass_violations?: number;
};

const COOLDOWN_MS = 10 * 60 * 1000;

/** 프롬프트 키 → 관련 시험 category */
export const PROMPT_KEY_TO_EVAL_CATEGORIES: Record<string, string[]> = {
  "talk.understand": ["되묻기"],
  "talk.assume": ["되묻기"],
  "talk.search": ["찾기", "환각 방지"],
  "talk.answer": ["경계", "판단"],
  "learn.capture": ["용어·지식"],
  "learn.dialogue": ["용어·지식"],
  "learn.selfstudy": ["용어·지식"]
};

const LENS_PREFIX = "lens.";

const AUTO_GRADE_SYSTEM = `당신은 LUNA 시험 채점관입니다.
문항의 must_pass(필수)와 quality(품질) 기준, 루나 답변을 대조해 채점하세요.

규칙:
1) must_pass를 먼저 본다. 하나라도 어기면 즉시 실패. score=0, fail_kind="must_pass". quality는 판정하지 않는다(quality_ok=null).
2) must_pass를 통과하면 quality를 본다. 충족이면 score=1·fail_kind=null, 미달이면 score=0.5·fail_kind="quality".
3) reason에는 한두 문장으로 판정 근거를 남긴다.

아래 JSON만 응답하세요:
{
  "must_pass_ok": true,
  "quality_ok": true,
  "score": 1,
  "fail_kind": null,
  "reason": "한두 문장 사유"
}
설명 문장 없이 JSON만 출력하세요.`;

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function parseJsonObject(text: string): Record<string, unknown> | null {
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

function formatRunLabel(date = new Date()): string {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yy}${mm}${dd} ${hh}:${mi}`;
}

function triggerLabel(trigger: EvalExamTrigger): string {
  if (trigger === "prompt_change") return "프롬프트 변경";
  if (trigger === "consolidation") return "정리 완료";
  if (trigger === "cron_light") return "매일 light";
  if (trigger === "cron_heavy") return "주간 heavy";
  return "수동 시험";
}

export function categoriesForPromptKey(promptKey: string): string[] {
  const key = promptKey.trim();
  if (!key) return [];
  if (PROMPT_KEY_TO_EVAL_CATEGORIES[key]) {
    return [...PROMPT_KEY_TO_EVAL_CATEGORIES[key]!];
  }
  if (key.startsWith(LENS_PREFIX) || key.startsWith("perspective.")) {
    return ["판단"];
  }
  if (key.startsWith("learn.")) return ["용어·지식"];
  if (key.startsWith("talk.")) return ["경계", "판단", "되묻기"];
  return [];
}

function normalizeGrade(parsed: Record<string, unknown> | null): EvalGrade {
  if (!parsed) {
    return {
      score: 0,
      pass: false,
      fail_kind: "must_pass",
      reason: "자동 채점 응답 파싱 실패",
      must_pass_ok: false,
      quality_ok: null
    };
  }

  const mustOk = parsed.must_pass_ok === true;
  if (!mustOk) {
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : "필수 조건 위반";
    return {
      score: 0,
      pass: false,
      fail_kind: "must_pass",
      reason,
      must_pass_ok: false,
      quality_ok: null
    };
  }

  const qualityOk = parsed.quality_ok === true;
  const reason =
    typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : qualityOk
        ? "필수·품질 기준 충족"
        : "품질 기준 미달";

  if (qualityOk) {
    return {
      score: 1,
      pass: true,
      fail_kind: null,
      reason,
      must_pass_ok: true,
      quality_ok: true
    };
  }

  return {
    score: 0.5,
    pass: false,
    fail_kind: "quality",
    reason,
    must_pass_ok: true,
    quality_ok: false
  };
}

export async function autoGradeAnswer(
  question: string,
  expectation: string | null,
  answer: string,
  opts?: {
    mustPass?: string | null;
    quality?: string | null;
    admin?: SupabaseClient;
  }
): Promise<EvalGrade> {
  const client = getAnthropicClient();
  if (!client) {
    return {
      score: 0,
      pass: false,
      fail_kind: "must_pass",
      reason: "채점 모델 API 키 없음",
      must_pass_ok: false,
      quality_ok: null
    };
  }

  let modelId = "claude-haiku-4-5-20251001";
  if (opts?.admin) {
    const tierB = resolveAnthropicModel(await getTierModel(opts.admin, "B"));
    modelId = tierB.model_id;
  }

  const mustPass =
    (opts?.mustPass && opts.mustPass.trim()) ||
    (expectation && expectation.trim()) ||
    "(필수 기준 없음 — 명백한 환각·허위만 실패)";
  const quality =
    (opts?.quality && opts.quality.trim()) ||
    "(품질 기준 없음 — 필수만 통과하면 합격)";

  const response = await client.messages.create({
    model: modelId,
    max_tokens: 512,
    system: AUTO_GRADE_SYSTEM,
    messages: [
      {
        role: "user",
        content: JSON.stringify(
          {
            question,
            must_pass: mustPass,
            quality,
            answer
          },
          null,
          2
        )
      }
    ]
  });

  const raw =
    response.content.find((p) => p.type === "text")?.text?.trim() ?? "";
  return normalizeGrade(parseJsonObject(raw));
}

/** @deprecated 호환 — boolean pass만 필요하면 score===1 */
export async function autoGradeAnswerLegacy(
  question: string,
  expectation: string | null,
  answer: string
): Promise<{ pass: boolean; reason: string }> {
  const g = await autoGradeAnswer(question, expectation, answer);
  return { pass: g.score === 1, reason: g.reason };
}

export async function shouldSkipExamForCooldown(
  admin: SupabaseClient
): Promise<{ skip: boolean; lastStartedAt?: string }> {
  const { data, error } = await admin
    .from("luna_eval_runs")
    .select("started_at, status")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[luna/eval-exam] cooldown", error);
    return { skip: false };
  }
  if (!data?.started_at) return { skip: false };
  const started = new Date(data.started_at as string).getTime();
  if (Number.isNaN(started)) return { skip: false };
  if (Date.now() - started < COOLDOWN_MS) {
    return { skip: true, lastStartedAt: data.started_at as string };
  }
  return { skip: false };
}

async function recomputeRunCountsFromAuto(
  admin: SupabaseClient,
  runId: string
): Promise<{
  passed: number;
  failed: number;
  total: number;
  score_sum: number;
  score_max: number;
  must_pass_violations: number;
  quality_misses: number;
}> {
  const { data: rows, error } = await admin
    .from("luna_eval_results")
    .select("auto_pass, score, fail_kind, verdict")
    .eq("run_id", runId);

  if (error) {
    throw new Error(error.message);
  }

  let passed = 0;
  let failed = 0;
  let score_sum = 0;
  let must_pass_violations = 0;
  let quality_misses = 0;
  let scored = 0;
  for (const row of rows ?? []) {
    // 채점/저장 실패(error)는 점수·합격 집계에서 제외
    if (row.verdict === "error") continue;
    scored += 1;
    const score =
      typeof row.score === "number"
        ? Number(row.score)
        : row.auto_pass === true
          ? 1
          : 0;
    score_sum += score;
    if (score >= 1) passed += 1;
    else failed += 1;
    if (row.fail_kind === "must_pass") must_pass_violations += 1;
    if (row.fail_kind === "quality") quality_misses += 1;
  }
  const total = (rows ?? []).length;
  const score_max = scored;
  await admin
    .from("luna_eval_runs")
    .update({
      passed,
      failed,
      total,
      score_sum,
      score_max
    })
    .eq("id", runId);
  return {
    passed,
    failed,
    total,
    score_sum,
    score_max,
    must_pass_violations,
    quality_misses
  };
}

export async function assignDailyMicroEvals(
  admin: SupabaseClient,
  runId: string
): Promise<number> {
  const { data: results, error: resError } = await admin
    .from("luna_eval_results")
    .select("id")
    .eq("run_id", runId);

  if (resError) {
    console.error("[luna/eval-exam] assign results", resError);
    return 0;
  }
  const resultIds = (results ?? []).map((r) => r.id as string);
  if (resultIds.length === 0) return 0;

  const { data: users, error: userError } = await admin
    .from("profiles")
    .select("id")
    .eq("status", "근무");

  if (userError) {
    console.error("[luna/eval-exam] assign users", userError);
    return 0;
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayStartIso = dayStart.toISOString();

  let assigned = 0;
  for (const u of users ?? []) {
    const userId = u.id as string;

    const { data: pending } = await admin
      .from("luna_eval_daily")
      .select("id")
      .eq("user_id", userId)
      .is("answered_at", null)
      .limit(1)
      .maybeSingle();
    if (pending) continue;

    const { count: todayCount } = await admin
      .from("luna_eval_daily")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("assigned_at", dayStartIso);
    if ((todayCount ?? 0) > 0) continue;

    const pick = resultIds[Math.floor(Math.random() * resultIds.length)]!;
    const { error: insError } = await admin.from("luna_eval_daily").insert({
      user_id: userId,
      result_id: pick
    });
    if (insError) {
      console.error("[luna/eval-exam] assign insert", userId, insError);
      continue;
    }
    assigned += 1;
  }
  return assigned;
}

type FailedCaseBrief = {
  question: string;
  reason: string;
  fail_kind: string | null;
};

async function loadFailedCaseBriefs(
  admin: SupabaseClient,
  runId: string,
  limit = 3
): Promise<FailedCaseBrief[]> {
  const { data, error } = await admin
    .from("luna_eval_results")
    .select(
      "auto_reason, fail_kind, score, case:luna_eval_cases(question)"
    )
    .eq("run_id", runId)
    .or("auto_pass.eq.false,score.lt.1")
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    console.error("[luna/eval-exam] failed briefs", error);
    return [];
  }

  const out: FailedCaseBrief[] = [];
  for (const row of data ?? []) {
    const caseObj = row.case as { question?: string } | null;
    const q =
      caseObj && typeof caseObj.question === "string"
        ? caseObj.question.trim()
        : "";
    if (!q) continue;
    out.push({
      question: q,
      reason: typeof row.auto_reason === "string" ? row.auto_reason : "",
      fail_kind: typeof row.fail_kind === "string" ? row.fail_kind : null
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function finalizeEvalExam(
  admin: SupabaseClient,
  runId: string,
  trigger: EvalExamTrigger,
  opts?: { tier?: string | null; notify?: boolean }
): Promise<{
  passed: number;
  failed: number;
  total: number;
  score_sum: number;
  score_max: number;
  score_dropped: boolean;
  previous_passed: number | null;
  previous_total: number | null;
  previous_score_sum: number | null;
  previous_score_max: number | null;
  must_pass_violations: number;
}> {
  const counts = await recomputeRunCountsFromAuto(admin, runId);
  const notify = opts?.notify !== false;
  const tier = opts?.tier ?? null;

  const { data: prevRows } = await admin
    .from("luna_eval_runs")
    .select("id, passed, total, score_sum, score_max, tier, status")
    .eq("status", "done")
    .neq("id", runId)
    .order("finished_at", { ascending: false })
    .limit(8);
  const prev =
    (prevRows ?? []).find((r) => {
      if (!tier) return true;
      const t = typeof r.tier === "string" ? r.tier : null;
      return t === tier || t == null;
    }) ?? null;

  const previous_passed =
    prev && typeof prev.passed === "number" ? (prev.passed as number) : null;
  const previous_total =
    prev && typeof prev.total === "number" ? (prev.total as number) : null;
  const previous_score_sum =
    prev && typeof prev.score_sum === "number"
      ? Number(prev.score_sum)
      : previous_passed;
  const previous_score_max =
    prev && typeof prev.score_max === "number"
      ? Number(prev.score_max)
      : previous_total;

  let score_dropped = false;
  const currRate =
    counts.score_max > 0 ? counts.score_sum / counts.score_max : 0;
  const prevRate =
    previous_score_max != null &&
    previous_score_max > 0 &&
    previous_score_sum != null
      ? previous_score_sum / previous_score_max
      : null;

  if (prevRate != null && currRate < prevRate) {
    score_dropped = true;
  }

  if (notify) {
    const briefs = await loadFailedCaseBriefs(admin, runId, 3);
    const briefText = briefs
      .map(
        (b, i) =>
          `${i + 1}. [${b.fail_kind === "must_pass" ? "필수" : "품질"}] ${b.question.slice(0, 60)}\n   → ${b.reason.slice(0, 100)}`
      )
      .join("\n");

    const prevLabel =
      previous_score_sum != null && previous_score_max != null
        ? `${previous_score_sum}/${previous_score_max}`
        : previous_passed != null && previous_total != null
          ? `${previous_passed}/${previous_total}`
          : null;
    const currLabel = `${counts.score_sum}/${counts.score_max}`;
    const isHeavy = tier === "heavy";
    const shouldNotifyImmediate =
      isHeavy || score_dropped || counts.must_pass_violations > 0;

    if (shouldNotifyImmediate) {
      let title: string;
      if (isHeavy) {
        title = prevLabel
          ? `회귀 시험 heavy ${currLabel} (지난주 ${prevLabel})`
          : `회귀 시험 heavy ${currLabel}`;
      } else if (counts.must_pass_violations > 0) {
        title = `시험 필수 위반 ${counts.must_pass_violations}건 — 되돌림을 검토하세요`;
      } else {
        title = `점수 하락 ${prevLabel ?? "?"}→${currLabel}, 되돌림을 제안해요`;
      }

      const bodyParts = [
        isHeavy
          ? briefText ||
            `${currLabel} · ${triggerLabel(trigger)} · 실패 문항 없음`
          : `${tier ? `[${tier}] ` : ""}${prevLabel ?? "?"} → ${currLabel} · ${triggerLabel(trigger)}`,
        !isHeavy ? briefText || null : null,
        `두뇌 > 회귀 시험: ${LUNA_LINKS.brainEval}`
      ].filter(Boolean);

      await lunaNotify(admin, "exam", title, bodyParts.join("\n"), {
        level:
          counts.must_pass_violations > 0
            ? "error"
            : score_dropped
              ? "warn"
              : "info",
        link: LUNA_LINKS.brainEval,
        meta: {
          run_id: runId,
          trigger,
          tier,
          previous_score_sum,
          previous_score_max,
          score_sum: counts.score_sum,
          score_max: counts.score_max,
          must_pass_violations: counts.must_pass_violations,
          quality_misses: counts.quality_misses,
          failed_cases: briefs,
          always_notify: isHeavy
        }
      });
    }
  }

  await assignDailyMicroEvals(admin, runId);

  return {
    passed: counts.passed,
    failed: counts.failed,
    total: counts.total,
    score_sum: counts.score_sum,
    score_max: counts.score_max,
    score_dropped,
    previous_passed,
    previous_total,
    previous_score_sum: previous_score_sum ?? null,
    previous_score_max: previous_score_max ?? null,
    must_pass_violations: counts.must_pass_violations
  };
}

export async function executeEvalCase(
  admin: SupabaseClient,
  runId: string,
  caseId: string
): Promise<{
  id: string;
  case_id: string;
  answer: string;
  auto_pass: boolean;
  auto_reason: string;
  score: number;
  fail_kind: EvalFailKind | null;
  duration_ms: number;
  model_label: string;
}> {
  const { data: evalCase, error: caseError } = await admin
    .from("luna_eval_cases")
    .select(
      "id, question, expectation, must_pass, quality, connectors, is_active"
    )
    .eq("id", caseId)
    .maybeSingle();

  if (caseError || !evalCase) {
    throw new Error(caseError?.message || "Case not found");
  }

  const connectorsRaw =
    evalCase.connectors && typeof evalCase.connectors === "object"
      ? (evalCase.connectors as Record<string, unknown>)
      : {};
  const connectors: LunaConnectors = {
    notion: connectorsRaw.notion === true,
    web: connectorsRaw.web === true,
    nas: connectorsRaw.nas === true
  };

  let result: Awaited<ReturnType<typeof runLunaTurn>>;
  try {
    result = await runLunaTurn(
      admin,
      evalCase.question as string,
      connectors
    );
  } catch (err) {
    const reason =
      err instanceof Error ? err.message.slice(0, 300) : "실행 실패";
    const { data: errRow, error: errInsert } = await admin
      .from("luna_eval_results")
      .upsert(
        {
          run_id: runId,
          case_id: caseId,
          answer: "",
          sources: [],
          verdict: "error",
          memo: null,
          auto_pass: false,
          auto_reason: reason,
          score: null,
          fail_kind: null,
          duration_ms: null,
          model_label: null
        },
        { onConflict: "run_id,case_id" }
      )
      .select(
        "id, case_id, answer, auto_pass, auto_reason, score, fail_kind, duration_ms, model_label, verdict"
      )
      .single();
    if (errInsert || !errRow) {
      throw new Error(errInsert?.message || reason);
    }
    return {
      id: errRow.id as string,
      case_id: errRow.case_id as string,
      answer: "",
      auto_pass: false,
      auto_reason: reason,
      score: 0,
      fail_kind: null,
      duration_ms: 0,
      model_label: ""
    };
  }

  const grade = await autoGradeAnswer(
    evalCase.question as string,
    (evalCase.expectation as string | null) ?? null,
    result.answer,
    {
      admin,
      mustPass: (evalCase.must_pass as string | null) ?? null,
      quality: (evalCase.quality as string | null) ?? null
    }
  );

  const verdict =
    grade.score >= 1 ? "pass" : grade.fail_kind === "quality" ? "partial" : "fail";

  const { data: inserted, error: insertError } = await admin
    .from("luna_eval_results")
    .upsert(
      {
        run_id: runId,
        case_id: caseId,
        answer: result.answer,
        sources: result.sources,
        verdict,
        memo: null,
        auto_pass: grade.score >= 1,
        auto_reason: grade.reason,
        score: grade.score,
        fail_kind: grade.fail_kind,
        duration_ms: result.durationMs,
        model_label: result.modelLabel
      },
      { onConflict: "run_id,case_id" }
    )
    .select(
      "id, case_id, answer, auto_pass, auto_reason, score, fail_kind, duration_ms, model_label, verdict"
    )
    .single();

  if (insertError || !inserted) {
    const saveReason = (
      insertError?.message || "Failed to save result"
    ).slice(0, 300);
    const { data: errRow, error: errInsert } = await admin
      .from("luna_eval_results")
      .upsert(
        {
          run_id: runId,
          case_id: caseId,
          answer: result.answer,
          sources: result.sources,
          verdict: "error",
          memo: null,
          auto_pass: false,
          auto_reason: saveReason,
          score: null,
          fail_kind: null,
          duration_ms: result.durationMs,
          model_label: result.modelLabel
        },
        { onConflict: "run_id,case_id" }
      )
      .select(
        "id, case_id, answer, auto_pass, auto_reason, score, fail_kind, duration_ms, model_label, verdict"
      )
      .single();
    if (errInsert || !errRow) {
      throw new Error(errInsert?.message || saveReason);
    }
    return {
      id: errRow.id as string,
      case_id: errRow.case_id as string,
      answer: (errRow.answer as string) ?? result.answer,
      auto_pass: false,
      auto_reason: saveReason,
      score: 0,
      fail_kind: null,
      duration_ms: result.durationMs,
      model_label: result.modelLabel
    };
  }

  return {
    id: inserted.id as string,
    case_id: inserted.case_id as string,
    answer: (inserted.answer as string) ?? "",
    auto_pass: inserted.auto_pass === true,
    auto_reason: (inserted.auto_reason as string) ?? grade.reason,
    score:
      typeof inserted.score === "number" ? Number(inserted.score) : grade.score,
    fail_kind:
      inserted.fail_kind === "must_pass" || inserted.fail_kind === "quality"
        ? inserted.fail_kind
        : grade.fail_kind,
    duration_ms: (inserted.duration_ms as number) ?? result.durationMs,
    model_label: (inserted.model_label as string) ?? result.modelLabel
  };
}

type CasePick = { id: string; category: string | null; tier: string | null };

async function selectCases(
  admin: SupabaseClient,
  opts: {
    tier?: EvalTier | null;
    categories?: string[] | null;
    maxCases?: number | null;
  }
): Promise<CasePick[]> {
  let q = admin
    .from("luna_eval_cases")
    .select("id, category, tier")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (opts.tier) {
    q = q.eq("tier", opts.tier);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  let cases = (data ?? []) as CasePick[];
  if (opts.categories && opts.categories.length > 0) {
    const set = new Set(opts.categories);
    cases = cases.filter(
      (c) => typeof c.category === "string" && set.has(c.category)
    );
  }

  if (opts.maxCases != null && opts.maxCases > 0 && cases.length > opts.maxCases) {
    cases = cases.slice(0, opts.maxCases);
  }
  return cases;
}

function resolveRunTier(
  cases: CasePick[],
  preferred?: EvalTier | "prompt" | null
): string {
  if (preferred === "prompt") return "prompt";
  if (preferred === "light" || preferred === "heavy") return preferred;
  const tiers = new Set(
    cases.map((c) => c.tier).filter((t): t is string => typeof t === "string")
  );
  if (tiers.size === 1) return [...tiers][0]!;
  if (tiers.size === 0) return "mixed";
  return "mixed";
}

export async function runEvalExam(
  admin: SupabaseClient,
  opts: {
    trigger: EvalExamTrigger;
    createdBy?: string | null;
    note?: string | null;
    force?: boolean;
    tier?: EvalTier | null;
    /** 프롬프트 변경 시 관련 문항만 */
    promptKey?: string | null;
    categories?: string[] | null;
    maxCases?: number | null;
    notify?: boolean;
  }
): Promise<EvalExamResult> {
  if (!opts.force) {
    const cooldown = await shouldSkipExamForCooldown(admin);
    if (cooldown.skip) {
      return {
        skipped: true,
        reason: `cooldown (${cooldown.lastStartedAt ?? "recent"})`
      };
    }
  }

  const categories =
    opts.categories ??
    (opts.promptKey ? categoriesForPromptKey(opts.promptKey) : null);

  const maxCases =
    opts.maxCases ??
    (opts.trigger === "prompt_change" || opts.promptKey ? 5 : null);

  const active = await selectCases(admin, {
    tier: opts.tier ?? null,
    categories,
    maxCases
  });

  if (active.length === 0) {
    return { skipped: true, reason: "no matching active cases" };
  }

  const runTier = resolveRunTier(
    active,
    opts.promptKey || opts.trigger === "prompt_change"
      ? "prompt"
      : opts.tier ?? null
  );

  const tierB = resolveAnthropicModel(await getTierModel(admin, "B"));
  const now = new Date().toISOString();
  const note =
    opts.note ??
    (opts.trigger === "manual"
      ? null
      : [
          `auto:${opts.trigger}`,
          opts.tier ? `tier=${opts.tier}` : null,
          opts.promptKey ? `prompt=${opts.promptKey}` : null
        ]
          .filter(Boolean)
          .join(" "));

  const { data: run, error: runError } = await admin
    .from("luna_eval_runs")
    .insert({
      label: formatRunLabel(),
      note,
      model_label: tierB.model_label,
      total: active.length,
      passed: 0,
      failed: 0,
      status: "running",
      started_at: now,
      finished_at: null,
      created_by: opts.createdBy ?? null,
      tier: runTier,
      score_sum: 0,
      score_max: active.length
    })
    .select("id")
    .single();

  if (runError || !run) {
    throw new Error(runError?.message || "Failed to create run");
  }

  const runId = run.id as string;

  try {
    for (const c of active) {
      try {
        await executeEvalCase(admin, runId, c.id);
      } catch (err) {
        console.error("[luna/eval-exam] case", c.id, err);
        await admin.from("luna_eval_results").upsert(
          {
            run_id: runId,
            case_id: c.id,
            answer: "",
            sources: [],
            verdict: "error",
            auto_pass: false,
            auto_reason:
              err instanceof Error ? err.message.slice(0, 300) : "실행 실패",
            score: null,
            fail_kind: null,
            duration_ms: null,
            model_label: tierB.model_label
          },
          { onConflict: "run_id,case_id" }
        );
      }
    }

    const finishedAt = new Date().toISOString();
    await admin
      .from("luna_eval_runs")
      .update({ status: "done", finished_at: finishedAt })
      .eq("id", runId);

    const fin = await finalizeEvalExam(admin, runId, opts.trigger, {
      tier: runTier,
      notify: opts.notify
    });

    return {
      skipped: false,
      run_id: runId,
      tier: runTier,
      total: fin.total,
      passed: fin.passed,
      failed: fin.failed,
      score_sum: fin.score_sum,
      score_max: fin.score_max,
      previous_passed: fin.previous_passed,
      previous_total: fin.previous_total,
      previous_score_sum: fin.previous_score_sum,
      previous_score_max: fin.previous_score_max,
      score_dropped: fin.score_dropped,
      must_pass_violations: fin.must_pass_violations
    };
  } catch (err) {
    await admin
      .from("luna_eval_runs")
      .update({
        status: "stopped",
        finished_at: new Date().toISOString()
      })
      .eq("id", runId);
    throw err;
  }
}

/** 프롬프트/정리 후 호출. 실패해도 본 흐름을 깨지 않음. */
export async function triggerAutoExam(
  admin: SupabaseClient,
  trigger: Exclude<EvalExamTrigger, "manual" | "cron_light" | "cron_heavy">,
  createdBy?: string | null,
  promptKey?: string | null
): Promise<EvalExamResult | null> {
  try {
    if (trigger === "prompt_change") {
      return await runEvalExam(admin, {
        trigger,
        createdBy,
        force: false,
        promptKey: promptKey ?? null,
        maxCases: 5,
        notify: true
      });
    }
    // consolidation: light만 (비용)
    return await runEvalExam(admin, {
      trigger,
      createdBy,
      force: false,
      tier: "light",
      notify: true
    });
  } catch (err) {
    console.error("[luna/eval-exam] trigger", trigger, err);
    return null;
  }
}

/** 같은 문항이 최근 N회 연속 실패(점수&lt;1)한 목록 — 자기개선 보조 근거 */
export async function listConsecutiveEvalFailures(
  admin: SupabaseClient,
  minStreak = 3
): Promise<
  Array<{
    case_id: string;
    question: string;
    category: string | null;
    streak: number;
    last_reason: string;
    fail_kind: string | null;
  }>
> {
  const { data: runs, error: runErr } = await admin
    .from("luna_eval_runs")
    .select("id")
    .eq("status", "done")
    .order("finished_at", { ascending: false })
    .limit(12);

  if (runErr || !runs?.length) {
    if (runErr) console.error("[luna/eval-exam] streak runs", runErr);
    return [];
  }

  const runIds = runs.map((r) => r.id as string);
  const { data: results, error: resErr } = await admin
    .from("luna_eval_results")
    .select(
      "run_id, case_id, score, auto_pass, auto_reason, fail_kind, case:luna_eval_cases(question, category)"
    )
    .in("run_id", runIds);

  if (resErr || !results?.length) {
    if (resErr) console.error("[luna/eval-exam] streak results", resErr);
    return [];
  }

  const byCase = new Map<
    string,
    Array<{
      run_id: string;
      failed: boolean;
      reason: string;
      fail_kind: string | null;
      question: string;
      category: string | null;
    }>
  >();

  const runOrder = new Map(runIds.map((id, i) => [id, i]));

  for (const row of results) {
    const caseId = row.case_id as string;
    const caseObj = row.case as {
      question?: string;
      category?: string | null;
    } | null;
    const score =
      typeof row.score === "number"
        ? Number(row.score)
        : row.auto_pass === true
          ? 1
          : 0;
    const list = byCase.get(caseId) ?? [];
    list.push({
      run_id: row.run_id as string,
      failed: score < 1,
      reason: typeof row.auto_reason === "string" ? row.auto_reason : "",
      fail_kind: typeof row.fail_kind === "string" ? row.fail_kind : null,
      question:
        caseObj && typeof caseObj.question === "string"
          ? caseObj.question
          : "",
      category:
        caseObj && typeof caseObj.category === "string"
          ? caseObj.category
          : null
    });
    byCase.set(caseId, list);
  }

  const out: Array<{
    case_id: string;
    question: string;
    category: string | null;
    streak: number;
    last_reason: string;
    fail_kind: string | null;
  }> = [];

  for (const [caseId, rows] of byCase) {
    rows.sort(
      (a, b) => (runOrder.get(a.run_id) ?? 99) - (runOrder.get(b.run_id) ?? 99)
    );
    let streak = 0;
    for (const r of rows) {
      if (!r.failed) break;
      streak += 1;
    }
    if (streak >= minStreak && rows[0]) {
      out.push({
        case_id: caseId,
        question: rows[0].question,
        category: rows[0].category,
        streak,
        last_reason: rows[0].reason,
        fail_kind: rows[0].fail_kind
      });
    }
  }

  return out;
}
