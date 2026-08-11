import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LUNA_MODEL,
  LUNA_MODEL_LABEL,
  runLunaTurn,
  type LunaConnectors
} from "@/lib/luna/run-chat";
import { lunaNotify } from "@/lib/luna/notify";

export type EvalExamTrigger =
  | "manual"
  | "prompt_change"
  | "consolidation";

export type EvalExamResult = {
  skipped: boolean;
  reason?: string;
  run_id?: string;
  total?: number;
  passed?: number;
  failed?: number;
  previous_passed?: number | null;
  previous_total?: number | null;
  score_dropped?: boolean;
};

const COOLDOWN_MS = 10 * 60 * 1000;

const AUTO_GRADE_SYSTEM = `당신은 LUNA 시험 채점관입니다.
시험 문제, 채점 기준(expectation), 루나의 답변을 비교해 합격/실패만 판정하세요.
아래 JSON만 응답하세요:
{ "pass": true, "reason": "한 줄 사유" }
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
  return "수동 시험";
}

export async function autoGradeAnswer(
  question: string,
  expectation: string | null,
  answer: string
): Promise<{ pass: boolean; reason: string }> {
  const client = getAnthropicClient();
  if (!client) {
    return { pass: false, reason: "채점 모델 API 키 없음" };
  }

  const response = await client.messages.create({
    model: LUNA_MODEL,
    max_tokens: 512,
    system: AUTO_GRADE_SYSTEM,
    messages: [
      {
        role: "user",
        content: JSON.stringify(
          {
            question,
            expectation: expectation || "(채점 기준 없음 — 답변의 타당성으로 판정)",
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
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return { pass: false, reason: "자동 채점 응답 파싱 실패" };
  }
  const pass = parsed.pass === true;
  const reason =
    typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : pass
        ? "채점 기준 충족"
        : "채점 기준 미충족";
  return { pass, reason };
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
): Promise<{ passed: number; failed: number; total: number }> {
  const { data: rows, error } = await admin
    .from("luna_eval_results")
    .select("auto_pass")
    .eq("run_id", runId);

  if (error) {
    throw new Error(error.message);
  }

  let passed = 0;
  let failed = 0;
  for (const row of rows ?? []) {
    if (row.auto_pass === true) passed += 1;
    else if (row.auto_pass === false) failed += 1;
  }
  const total = (rows ?? []).length;
  await admin
    .from("luna_eval_runs")
    .update({ passed, failed, total })
    .eq("id", runId);
  return { passed, failed, total };
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
      // unique 충돌 등은 무시
      console.error("[luna/eval-exam] assign insert", userId, insError);
      continue;
    }
    assigned += 1;
  }
  return assigned;
}

export async function finalizeEvalExam(
  admin: SupabaseClient,
  runId: string,
  trigger: EvalExamTrigger
): Promise<{
  passed: number;
  failed: number;
  total: number;
  score_dropped: boolean;
  previous_passed: number | null;
  previous_total: number | null;
}> {
  const counts = await recomputeRunCountsFromAuto(admin, runId);

  const { data: prev } = await admin
    .from("luna_eval_runs")
    .select("id, passed, total, status")
    .eq("status", "done")
    .neq("id", runId)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previous_passed =
    prev && typeof prev.passed === "number" ? (prev.passed as number) : null;
  const previous_total =
    prev && typeof prev.total === "number" ? (prev.total as number) : null;

  let score_dropped = false;
  if (
    previous_total != null &&
    previous_total > 0 &&
    previous_passed != null &&
    counts.total > 0
  ) {
    const prevRate = previous_passed / previous_total;
    const nextRate = counts.passed / counts.total;
    if (nextRate < prevRate) {
      score_dropped = true;
      await lunaNotify(
        admin,
        "exam",
        `시험 점수 하락 ${previous_passed}→${counts.passed} — 최근 변경: ${triggerLabel(trigger)}`,
        `합격 ${counts.passed}/${counts.total} (직전 ${previous_passed}/${previous_total})`,
        {
          level: "warn",
          link: "/settings",
          meta: {
            run_id: runId,
            trigger,
            previous_passed,
            previous_total,
            passed: counts.passed,
            total: counts.total
          }
        }
      );
    }
  }

  await assignDailyMicroEvals(admin, runId);

  return {
    ...counts,
    score_dropped,
    previous_passed,
    previous_total
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
  duration_ms: number;
  model_label: string;
}> {
  const { data: evalCase, error: caseError } = await admin
    .from("luna_eval_cases")
    .select("id, question, expectation, connectors, is_active")
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

  const result = await runLunaTurn(
    admin,
    evalCase.question as string,
    connectors
  );
  const grade = await autoGradeAnswer(
    evalCase.question as string,
    (evalCase.expectation as string | null) ?? null,
    result.answer
  );

  const { data: inserted, error: insertError } = await admin
    .from("luna_eval_results")
    .upsert(
      {
        run_id: runId,
        case_id: caseId,
        answer: result.answer,
        sources: result.sources,
        verdict: grade.pass ? "pass" : "fail",
        memo: null,
        auto_pass: grade.pass,
        auto_reason: grade.reason,
        duration_ms: result.durationMs,
        model_label: result.modelLabel
      },
      { onConflict: "run_id,case_id" }
    )
    .select(
      "id, case_id, answer, auto_pass, auto_reason, duration_ms, model_label, verdict"
    )
    .single();

  if (insertError || !inserted) {
    throw new Error(insertError?.message || "Failed to save result");
  }

  return {
    id: inserted.id as string,
    case_id: inserted.case_id as string,
    answer: (inserted.answer as string) ?? "",
    auto_pass: inserted.auto_pass === true,
    auto_reason: (inserted.auto_reason as string) ?? grade.reason,
    duration_ms: (inserted.duration_ms as number) ?? result.durationMs,
    model_label: (inserted.model_label as string) ?? result.modelLabel
  };
}

export async function runEvalExam(
  admin: SupabaseClient,
  opts: {
    trigger: EvalExamTrigger;
    createdBy?: string | null;
    note?: string | null;
    force?: boolean;
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

  const { data: cases, error: casesError } = await admin
    .from("luna_eval_cases")
    .select("id")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (casesError) {
    throw new Error(casesError.message);
  }

  const active = cases ?? [];
  if (active.length === 0) {
    return { skipped: true, reason: "no active cases" };
  }

  const now = new Date().toISOString();
  const note =
    opts.note ??
    (opts.trigger === "manual" ? null : `auto:${opts.trigger}`);

  const { data: run, error: runError } = await admin
    .from("luna_eval_runs")
    .insert({
      label: formatRunLabel(),
      note,
      model_label: LUNA_MODEL_LABEL,
      total: active.length,
      passed: 0,
      failed: 0,
      status: "running",
      started_at: now,
      finished_at: null,
      created_by: opts.createdBy ?? null
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
        await executeEvalCase(admin, runId, c.id as string);
      } catch (err) {
        console.error("[luna/eval-exam] case", c.id, err);
        await admin.from("luna_eval_results").upsert(
          {
            run_id: runId,
            case_id: c.id,
            answer: "",
            sources: [],
            verdict: "fail",
            auto_pass: false,
            auto_reason:
              err instanceof Error ? err.message.slice(0, 300) : "실행 실패",
            duration_ms: null,
            model_label: LUNA_MODEL_LABEL
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

    const fin = await finalizeEvalExam(admin, runId, opts.trigger);

    return {
      skipped: false,
      run_id: runId,
      total: fin.total,
      passed: fin.passed,
      failed: fin.failed,
      previous_passed: fin.previous_passed,
      previous_total: fin.previous_total,
      score_dropped: fin.score_dropped
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
  trigger: Exclude<EvalExamTrigger, "manual">,
  createdBy?: string | null
): Promise<EvalExamResult | null> {
  try {
    return await runEvalExam(admin, { trigger, createdBy, force: false });
  } catch (err) {
    console.error("[luna/eval-exam] trigger", trigger, err);
    return null;
  }
}
