import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeThread,
  parseJsonObject
} from "@/lib/luna/candidates";
import { getTierModel, resolveAnthropicModel } from "@/lib/luna/engine";
import {
  listConsecutiveEvalFailures,
  runEvalExam
} from "@/lib/luna/eval-exam";
import { lunaNotify } from "@/lib/luna/notify";
import {
  getPrompt,
  isHumanOnlyPromptLevel,
  LUNA_PROMPT_KEYS
} from "@/lib/luna/prompts";

const SETTINGS_LAST = "self_upgrade_last_run";
const SETTINGS_REVERT = "self_upgrade_revert_suggestion";

const UPGRADE_FALLBACK = `내 판단(프롬프트)을 고칠 수 있는 근거는 두 가지뿐이다:
① 확정된 지식 (후보함을 통과한 것)
② 반복된 정정 (같은 유형으로 3회 이상 고쳐진 것)
미확정 후보, 단발 정정, 나의 추측으로는 고치지 않는다.

회귀 시험 연속 실패는 보조 신호일 뿐이다. 시험 점수만으로 프롬프트를 고치지 않는다.
시험에 최적화된 답만 하는 것을 막기 위함이다. 주 근거는 사람의 정정·확정 지식이다.

고칠 수 있는 범위: L2 관점, L3 대화, L4 배움.
고칠 수 없는 것: L1 정체성, L5. 이것은 사람만 고친다.

한 번에 한 프롬프트만. JSON만:
{ "target_prompt_key": "talk.search", "new_content": "전체 프롬프트 본문", "reason": "이유", "prediction": "나아질 점" }
근거 부족하면 { "skip": true, "reason": "..." }`;

export type SelfUpgradeResult = {
  ok: true;
  skipped: boolean;
  message: string;
  prompt_id?: string;
  prompt_key?: string;
  title?: string;
  version?: number;
  version_id?: string;
  score_dropped?: boolean;
  exam_run_id?: string | null;
};

export type SelfUpgradeRevertSuggestion = {
  prompt_id: string;
  prompt_key: string;
  title: string;
  version: number;
  version_id: string;
  previous_version: number;
  reason: string;
  prediction: string;
  suggested_at: string;
};

type PromptRow = {
  id: string;
  level: string;
  prompt_key: string;
  title: string;
  description: string | null;
  purpose: string | null;
  content: string;
  owner_id: string | null;
  sort_order: number;
  version: number;
  is_active: boolean;
};

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function saveSetting(
  admin: SupabaseClient,
  key: string,
  value: unknown
): Promise<void> {
  const { error } = await admin.from("luna_settings").upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) console.error("[luna/self-upgrade] saveSetting", key, error);
}

export async function getSelfUpgradeStatus(admin: SupabaseClient): Promise<{
  last_run: SelfUpgradeResult | null;
  revert_suggestion: SelfUpgradeRevertSuggestion | null;
}> {
  const { data, error } = await admin
    .from("luna_settings")
    .select("key, value")
    .in("key", [SETTINGS_LAST, SETTINGS_REVERT]);
  if (error) {
    console.error("[luna/self-upgrade] status", error);
    return { last_run: null, revert_suggestion: null };
  }
  let last_run: SelfUpgradeResult | null = null;
  let revert_suggestion: SelfUpgradeRevertSuggestion | null = null;
  for (const row of data ?? []) {
    if (row.key === SETTINGS_LAST && row.value && typeof row.value === "object") {
      last_run = row.value as SelfUpgradeResult;
    }
    if (
      row.key === SETTINGS_REVERT &&
      row.value &&
      typeof row.value === "object"
    ) {
      revert_suggestion = row.value as SelfUpgradeRevertSuggestion;
    }
  }

  if (revert_suggestion) {
    const { data: p } = await admin
      .from("luna_prompts")
      .select("version")
      .eq("id", revert_suggestion.prompt_id)
      .maybeSingle();
    if (
      p &&
      typeof p.version === "number" &&
      p.version !== revert_suggestion.version
    ) {
      await admin.from("luna_settings").delete().eq("key", SETTINGS_REVERT);
      revert_suggestion = null;
    }
  }

  return { last_run, revert_suggestion };
}

export async function listLunaUpgradeHistory(
  admin: SupabaseClient,
  limit = 20
): Promise<
  Array<{
    id: string;
    target_id: string;
    version: number;
    change_summary: string | null;
    prediction: string | null;
    verify_result: string | null;
    verify_note: string | null;
    created_at: string;
    prompt_title: string | null;
    prompt_key: string | null;
    current_version: number | null;
  }>
> {
  const { data: versions, error } = await admin
    .from("luna_prompt_versions")
    .select(
      "id, target_id, version, change_summary, prediction, verify_result, verify_note, created_at"
    )
    .eq("target_type", "prompt")
    .eq("changed_by_luna", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[luna/self-upgrade] history", error);
    return [];
  }
  if (!versions?.length) return [];

  const ids = Array.from(new Set(versions.map((v) => v.target_id as string)));
  const { data: prompts } = await admin
    .from("luna_prompts")
    .select("id, title, prompt_key, version")
    .in("id", ids);
  const byId = new Map(
    (prompts ?? []).map((p) => [
      p.id as string,
      {
        title: p.title as string,
        prompt_key: p.prompt_key as string,
        version: p.version as number
      }
    ])
  );

  return versions.map((v) => {
    const p = byId.get(v.target_id as string);
    return {
      id: v.id as string,
      target_id: v.target_id as string,
      version: v.version as number,
      change_summary: (v.change_summary as string | null) ?? null,
      prediction: (v.prediction as string | null) ?? null,
      verify_result: (v.verify_result as string | null) ?? null,
      verify_note: (v.verify_note as string | null) ?? null,
      created_at: v.created_at as string,
      prompt_title: p?.title ?? null,
      prompt_key: p?.prompt_key ?? null,
      current_version: p?.version ?? null
    };
  });
}

type CorrectionCluster = {
  category: string;
  count: number;
  samples: string[];
};

async function collectTriggers(admin: SupabaseClient): Promise<{
  clusters: CorrectionCluster[];
  confirmed: Array<{ content: string; category: string }>;
  eval_streaks: Array<{
    case_id: string;
    question: string;
    category: string | null;
    streak: number;
    last_reason: string;
    fail_kind: string | null;
  }>;
}> {
  const since = daysAgoIso(7);

  const { data: rows, error } = await admin
    .from("luna_learnings")
    .select(
      "id, content, category, status, thread, meta, resolved_at, updated_at, created_at"
    )
    .gte("updated_at", since)
    .neq("category", "identity")
    .limit(500);

  if (error) {
    console.error("[luna/self-upgrade] collect", error);
    return { clusters: [], confirmed: [], eval_streaks: [] };
  }

  const correctionByCat = new Map<string, string[]>();
  const confirmed: Array<{ content: string; category: string }> = [];

  for (const row of rows ?? []) {
    const category =
      typeof row.category === "string" && row.category.trim()
        ? row.category.trim()
        : "general";
    const content = typeof row.content === "string" ? row.content.trim() : "";
    const meta =
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {};
    const thread = normalizeThread(row.thread);
    const humanTurns = thread.filter((t) => t.role === "human").length;
    const fromCorrection = meta.from_correction === true;
    const revised = humanTurns > 0;

    if (row.status === "active") {
      const resolvedAt =
        typeof row.resolved_at === "string"
          ? row.resolved_at
          : typeof row.updated_at === "string"
            ? row.updated_at
            : null;
      if (resolvedAt && resolvedAt >= since && content) {
        confirmed.push({ content, category });
      }
    }

    if ((fromCorrection || revised) && content) {
      const list = correctionByCat.get(category) ?? [];
      list.push(content.slice(0, 200));
      correctionByCat.set(category, list);
    }
  }

  const clusters: CorrectionCluster[] = [];
  for (const [category, samples] of correctionByCat) {
    if (samples.length >= 3) {
      clusters.push({
        category,
        count: samples.length,
        samples: samples.slice(0, 5)
      });
    }
  }
  clusters.sort((a, b) => b.count - a.count);

  const eval_streaks = await listConsecutiveEvalFailures(admin, 3);

  return {
    clusters,
    confirmed: confirmed.slice(0, 30),
    eval_streaks
  };
}

async function proposeUpgrade(
  admin: SupabaseClient,
  clusters: CorrectionCluster[],
  confirmed: Array<{ content: string; category: string }>,
  evalStreaks: Array<{
    question: string;
    category: string | null;
    streak: number;
    last_reason: string;
  }>
): Promise<{
  skip: boolean;
  reason?: string;
  target_prompt_key?: string;
  new_content?: string;
  prediction?: string;
} | null> {
  const client = getAnthropicClient();
  if (!client) return null;

  const { data: prompts, error } = await admin
    .from("luna_prompts")
    .select(
      "id, level, prompt_key, title, description, purpose, content, owner_id, sort_order, version, is_active"
    )
    .eq("is_active", true)
    .in("level", ["L2", "L3", "L4"])
    .order("level", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error || !prompts?.length) {
    console.error("[luna/self-upgrade] prompts", error);
    return null;
  }

  const system =
    (await getPrompt(admin, LUNA_PROMPT_KEYS.upgrade)).trim() ||
    UPGRADE_FALLBACK;
  const tierB = resolveAnthropicModel(await getTierModel(admin, "B"));

  const promptCatalog = (prompts as PromptRow[])
    .map(
      (p) =>
        `### ${p.prompt_key} (${p.level}) — ${p.title}\n${p.content.slice(0, 2500)}`
    )
    .join("\n\n");

  const evidence = [
    clusters.length
      ? `반복 정정(≥3) — 주 근거:\n${clusters
          .map(
            (c) =>
              `- ${c.category} ×${c.count}: ${c.samples.map((s) => `"${s}"`).join("; ")}`
          )
          .join("\n")}`
      : "반복 정정: 없음",
    confirmed.length
      ? `이번 주 확정 지식 — 주 근거:\n${confirmed
          .slice(0, 15)
          .map((c) => `- [${c.category}] ${c.content}`)
          .join("\n")}`
      : "이번 주 확정 지식: 없음",
    evalStreaks.length
      ? `회귀 시험 연속 실패 — 보조 신호(이것만으로 고치지 말 것):\n${evalStreaks
          .slice(0, 8)
          .map(
            (e) =>
              `- ${e.streak}회 [${e.category ?? "?"}] ${e.question.slice(0, 80)} (${e.last_reason.slice(0, 80)})`
          )
          .join("\n")}`
      : "회귀 시험 연속 실패: 없음"
  ].join("\n\n");

  let raw = "";
  try {
    const res = await client.messages.create({
      model: tierB.model_id,
      max_tokens: 4096,
      system,
      messages: [
        {
          role: "user",
          content: `근거와 수정 가능 프롬프트를 보고, 한 건만 개선안을 JSON으로 주세요.\n\n${evidence}\n\n[수정 가능 프롬프트]\n${promptCatalog}`
        }
      ]
    });
    raw = res.content.find((p) => p.type === "text")?.text?.trim() ?? "";
  } catch (err) {
    console.error("[luna/self-upgrade] propose", err);
    return null;
  }

  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  if (parsed.skip === true) {
    return {
      skip: true,
      reason:
        typeof parsed.reason === "string" ? parsed.reason : "근거 부족으로 skip"
    };
  }

  const target_prompt_key =
    typeof parsed.target_prompt_key === "string"
      ? parsed.target_prompt_key.trim()
      : "";
  const new_content =
    typeof parsed.new_content === "string" ? parsed.new_content.trim() : "";
  const reason =
    typeof parsed.reason === "string" ? parsed.reason.trim() : "";
  const prediction =
    typeof parsed.prediction === "string" ? parsed.prediction.trim() : "";

  if (!target_prompt_key || !new_content || !reason || !prediction) {
    return { skip: true, reason: "수정안 JSON 불완전" };
  }

  return {
    skip: false,
    target_prompt_key,
    new_content,
    reason,
    prediction
  };
}

/**
 * L5 자율 업그레이드 1건. L1/L5 대상은 폐기.
 */
export async function runSelfUpgrade(
  admin: SupabaseClient,
  opts?: { notify?: boolean }
): Promise<SelfUpgradeResult> {
  const notify = opts?.notify !== false;
  const { clusters, confirmed, eval_streaks } = await collectTriggers(admin);

  if (clusters.length === 0 && confirmed.length === 0) {
    const result: SelfUpgradeResult = {
      ok: true,
      skipped: true,
      message: "개선 근거 없음 (반복 정정·확정 지식 부족)"
    };
    await saveSetting(admin, SETTINGS_LAST, {
      ...result,
      finished_at: new Date().toISOString()
    });
    return result;
  }

  const proposal = await proposeUpgrade(
    admin,
    clusters,
    confirmed,
    eval_streaks
  );
  if (!proposal) {
    const result: SelfUpgradeResult = {
      ok: true,
      skipped: true,
      message: "수정안 생성 실패"
    };
    await saveSetting(admin, SETTINGS_LAST, {
      ...result,
      finished_at: new Date().toISOString()
    });
    return result;
  }
  if (proposal.skip || !proposal.target_prompt_key || !proposal.new_content) {
    const result: SelfUpgradeResult = {
      ok: true,
      skipped: true,
      message: proposal.reason || "이번 주 개선 없음"
    };
    await saveSetting(admin, SETTINGS_LAST, {
      ...result,
      finished_at: new Date().toISOString()
    });
    return result;
  }

  const { data: target, error: loadErr } = await admin
    .from("luna_prompts")
    .select(
      "id, level, prompt_key, title, description, purpose, content, owner_id, sort_order, version, is_active"
    )
    .eq("prompt_key", proposal.target_prompt_key)
    .eq("is_active", true)
    .maybeSingle();

  if (loadErr || !target) {
    const result: SelfUpgradeResult = {
      ok: true,
      skipped: true,
      message: `대상 프롬프트 없음: ${proposal.target_prompt_key}`
    };
    await saveSetting(admin, SETTINGS_LAST, {
      ...result,
      finished_at: new Date().toISOString()
    });
    return result;
  }

  if (isHumanOnlyPromptLevel(String(target.level))) {
    const result: SelfUpgradeResult = {
      ok: true,
      skipped: true,
      message: `L1/L5 대상 폐기: ${target.prompt_key}`
    };
    await saveSetting(admin, SETTINGS_LAST, {
      ...result,
      finished_at: new Date().toISOString()
    });
    return result;
  }

  const reason = proposal.reason || "자율 개선";
  const prediction = proposal.prediction || "개선 효과 예상";
  const previousVersion = target.version as number;
  const nextVersion = previousVersion + 1;
  const now = new Date().toISOString();
  const title = target.title as string;

  const { error: updateErr } = await admin
    .from("luna_prompts")
    .update({
      content: proposal.new_content,
      version: nextVersion,
      updated_at: now
    })
    .eq("id", target.id);

  if (updateErr) {
    console.error("[luna/self-upgrade] update", updateErr);
    return {
      ok: true,
      skipped: true,
      message: `반영 실패: ${updateErr.message}`
    };
  }

  const { data: verRow, error: verErr } = await admin
    .from("luna_prompt_versions")
    .insert({
      target_type: "prompt",
      target_id: target.id,
      version: nextVersion,
      content: {
        title: target.title,
        description: target.description,
        purpose: target.purpose,
        content: proposal.new_content,
        owner_id: target.owner_id,
        sort_order: target.sort_order
      },
      change_summary: reason,
      prediction,
      changed_by: null,
      changed_by_luna: true
    })
    .select("id")
    .maybeSingle();

  if (verErr || !verRow) {
    console.error("[luna/self-upgrade] version", verErr);
    return {
      ok: true,
      skipped: true,
      message: `버전 기록 실패: ${verErr?.message ?? "unknown"}`
    };
  }

  const versionId = verRow.id as string;
  const reasonShort =
    reason.length > 80 ? `${reason.slice(0, 80)}…` : reason;

  if (notify) {
    await lunaNotify(
      admin,
      "prompt_change",
      `루나가 ${title}을 스스로 개선했어요 — ${reasonShort}`,
      `「${title}」 v${nextVersion}`,
      {
        level: "info",
        meta: {
          prompt_id: target.id,
          prompt_key: target.prompt_key,
          version: nextVersion,
          version_id: versionId,
          changed_by_luna: true
        }
      }
    );
  }

  let score_dropped = false;
  let exam_run_id: string | null = null;

  try {
    const exam = await runEvalExam(admin, {
      trigger: "prompt_change",
      force: true,
      promptKey: target.prompt_key as string,
      maxCases: 5,
      // 자기개선 직후 상승은 알림 없이 verify 이력만
      notify: false
    });
    if (!exam.skipped) {
      exam_run_id = exam.run_id ?? null;
      score_dropped = exam.score_dropped === true;
      const mustViolations = exam.must_pass_violations ?? 0;
      const verifyResult =
        score_dropped || mustViolations > 0 ? "refuted" : "confirmed";
      const scoreLabel = `${exam.score_sum ?? exam.passed}/${exam.score_max ?? exam.total}`;
      const prevLabel = `${exam.previous_score_sum ?? exam.previous_passed ?? "?"}/${exam.previous_score_max ?? exam.previous_total ?? "?"}`;
      const verifyNote =
        score_dropped || mustViolations > 0
          ? `회귀 하락/필수위반 ${prevLabel} → ${scoreLabel}${mustViolations > 0 ? ` · 필수 ${mustViolations}건` : ""}`
          : `예측 확인됨 ${scoreLabel}`;

      await admin
        .from("luna_prompt_versions")
        .update({
          verify_run_id: exam_run_id,
          verify_result: verifyResult,
          verify_note: verifyNote,
          verified_at: new Date().toISOString()
        })
        .eq("id", versionId);

      if (score_dropped || mustViolations > 0) {
        const suggestion: SelfUpgradeRevertSuggestion = {
          prompt_id: target.id as string,
          prompt_key: target.prompt_key as string,
          title,
          version: nextVersion,
          version_id: versionId,
          previous_version: previousVersion,
          reason,
          prediction,
          suggested_at: new Date().toISOString()
        };
        await saveSetting(admin, SETTINGS_REVERT, suggestion);

        if (notify) {
          await lunaNotify(
            admin,
            "exam",
            mustViolations > 0
              ? `시험 필수 위반 ${mustViolations}건 — 되돌림을 검토하세요`
              : `점수 하락 ${prevLabel}→${scoreLabel}, 되돌림을 제안해요`,
            `「${title}」 v${nextVersion} 회귀. 두뇌에서 이전 버전으로 되돌릴 수 있어요.`,
            {
              level: mustViolations > 0 ? "error" : "warn",
              meta: {
                prompt_id: target.id,
                version_id: versionId,
                run_id: exam_run_id,
                revert_to: previousVersion,
                must_pass_violations: mustViolations
              }
            }
          );
        }
      } else {
        // 성공 시 이전 제안 제거 — 알림은 보내지 않음(예측 확인은 이력에만)
        await admin.from("luna_settings").delete().eq("key", SETTINGS_REVERT);
      }
    }
  } catch (err) {
    console.error("[luna/self-upgrade] exam", err);
  }

  const result: SelfUpgradeResult = {
    ok: true,
    skipped: false,
    message: score_dropped
      ? `개선 반영·회귀 하락 — 되돌림 제안 (v${nextVersion})`
      : `개선 반영 「${title}」 v${nextVersion}`,
    prompt_id: target.id as string,
    prompt_key: target.prompt_key as string,
    title,
    version: nextVersion,
    version_id: versionId,
    score_dropped,
    exam_run_id
  };
  await saveSetting(admin, SETTINGS_LAST, {
    ...result,
    finished_at: new Date().toISOString()
  });
  return result;
}
