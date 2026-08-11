import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { triggerAutoExam } from "@/lib/luna/eval-exam";
import { LUNA_MODEL } from "@/lib/luna/run-chat";
import { lunaNotify } from "@/lib/luna/notify";

export type ConsolidationTrigger = "volume" | "backstop" | "manual";

export type ConsolidationSettings = {
  volume_threshold: number;
  backstop_days: number;
  notify_events: {
    consolidation: boolean;
    study: boolean;
    reflect: boolean;
    conflict: boolean;
    prompt_change: boolean;
    exam: boolean;
  };
};

export type ConsolidationStatus = {
  settings: ConsolidationSettings;
  last_run: {
    id: string;
    started_at: string;
    finished_at: string | null;
    trigger: string;
    scanned: number | null;
    merged_candidates: number | null;
    stale_candidates: number | null;
    conflict_candidates: number | null;
    status: string;
    error: string | null;
  } | null;
  new_active_since_last: number;
  days_since_last: number | null;
  days_until_backstop: number | null;
  would_run: boolean;
  next_trigger: ConsolidationTrigger | null;
};

export type ConsolidationRunResult = {
  skipped: boolean;
  trigger: ConsolidationTrigger | null;
  run_id?: string;
  scanned?: number;
  merged_candidates?: number;
  stale_candidates?: number;
  conflict_candidates?: number;
  reason?: string;
  error?: string;
};

type ActiveRow = {
  id: string;
  content: string;
  category: string;
  use_count: number | null;
  last_used_at: string | null;
  created_at: string | null;
};

const DEFAULT_SETTINGS: ConsolidationSettings = {
  volume_threshold: 30,
  backstop_days: 14,
  notify_events: {
    consolidation: true,
    study: true,
    reflect: true,
    conflict: true,
    prompt_change: true,
    exam: true
  }
};

const CONSOLIDATE_SYSTEM = `당신은 팀 장기 기억을 정리하는 편집자입니다.
active 학습 목록을 보고 중복/유사 쌍과 서로 상반(모순)되는 쌍만 골라 JSON으로 응답하세요.
자동으로 확정하거나 삭제하지 마세요. 후보만 제안합니다.

아래 JSON만 응답하세요:
{
  "duplicates": [
    {
      "keep_id": "유지할 본문 id",
      "merge_ids": ["후보로 보낼 id"],
      "merged_content": "본문에 반영할 병합문 초안"
    }
  ],
  "contradictions": [
    { "ids": ["id1", "id2"] }
  ]
}

규칙:
- keep_id 와 merge_ids 는 서로 겹치면 안 됩니다.
- 한 id 는 최대 한 번만 등장해야 합니다.
- 확신이 없으면 해당 항목을 비워 두세요.
- 설명 문장 없이 JSON만 출력하세요.`;

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function asJsonNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
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

function asIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
}

function daysBetween(fromIso: string, to = Date.now()): number {
  const t = new Date(fromIso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((to - t) / (24 * 60 * 60 * 1000));
}

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export async function loadConsolidationSettings(
  admin: SupabaseClient
): Promise<ConsolidationSettings> {
  const { data, error } = await admin
    .from("luna_settings")
    .select("key, value")
    .in("key", [
      "consolidation_volume_threshold",
      "consolidation_backstop_days",
      "notify_events"
    ]);

  if (error) {
    console.error("[luna/consolidate] settings", error);
    return { ...DEFAULT_SETTINGS, notify_events: { ...DEFAULT_SETTINGS.notify_events } };
  }

  const map = new Map<string, unknown>();
  for (const row of data ?? []) {
    map.set(row.key as string, row.value);
  }

  const notifyRaw = map.get("notify_events");
  const notifyObj =
    notifyRaw && typeof notifyRaw === "object" && !Array.isArray(notifyRaw)
      ? (notifyRaw as Record<string, unknown>)
      : {};

  return {
    volume_threshold: clampInt(
      asJsonNumber(map.get("consolidation_volume_threshold"), DEFAULT_SETTINGS.volume_threshold),
      5,
      500,
      DEFAULT_SETTINGS.volume_threshold
    ),
    backstop_days: clampInt(
      asJsonNumber(map.get("consolidation_backstop_days"), DEFAULT_SETTINGS.backstop_days),
      1,
      90,
      DEFAULT_SETTINGS.backstop_days
    ),
    notify_events: {
      consolidation:
        typeof notifyObj.consolidation === "boolean"
          ? notifyObj.consolidation
          : DEFAULT_SETTINGS.notify_events.consolidation,
      study:
        typeof notifyObj.study === "boolean"
          ? notifyObj.study
          : DEFAULT_SETTINGS.notify_events.study,
      reflect:
        typeof notifyObj.reflect === "boolean"
          ? notifyObj.reflect
          : DEFAULT_SETTINGS.notify_events.reflect,
      conflict:
        typeof notifyObj.conflict === "boolean"
          ? notifyObj.conflict
          : DEFAULT_SETTINGS.notify_events.conflict,
      prompt_change:
        typeof notifyObj.prompt_change === "boolean"
          ? notifyObj.prompt_change
          : DEFAULT_SETTINGS.notify_events.prompt_change,
      exam:
        typeof notifyObj.exam === "boolean"
          ? notifyObj.exam
          : DEFAULT_SETTINGS.notify_events.exam
    }
  };
}

export async function getLastDoneRun(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("luna_consolidation_runs")
    .select(
      "id, started_at, finished_at, trigger, scanned, merged_candidates, stale_candidates, conflict_candidates, status, error"
    )
    .eq("status", "done")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[luna/consolidate] last done", error);
    return null;
  }
  return data;
}

export async function getConsolidationStatus(
  admin: SupabaseClient
): Promise<ConsolidationStatus> {
  const settings = await loadConsolidationSettings(admin);
  const lastDone = await getLastDoneRun(admin);

  const { data: lastAny } = await admin
    .from("luna_consolidation_runs")
    .select(
      "id, started_at, finished_at, trigger, scanned, merged_candidates, stale_candidates, conflict_candidates, status, error"
    )
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sinceIso =
    (lastDone?.finished_at as string | null) ??
    (lastDone?.started_at as string | null) ??
    null;

  let newActive = 0;
  let q = admin
    .from("luna_learnings")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .neq("category", "identity");
  if (sinceIso) {
    q = q.gt("created_at", sinceIso);
  }
  const { count, error: countError } = await q;
  if (countError) {
    console.error("[luna/consolidate] new active count", countError);
  } else {
    newActive = count ?? 0;
  }

  const daysSinceLast = sinceIso ? daysBetween(sinceIso) : null;
  const daysUntilBackstop =
    daysSinceLast === null
      ? 0
      : Math.max(0, settings.backstop_days - daysSinceLast);

  const byVolume = newActive >= settings.volume_threshold;
  const byBackstop =
    daysSinceLast === null || daysSinceLast >= settings.backstop_days;

  let next_trigger: ConsolidationTrigger | null = null;
  if (byVolume) next_trigger = "volume";
  else if (byBackstop) next_trigger = "backstop";

  return {
    settings,
    last_run: lastAny
      ? {
          id: lastAny.id as string,
          started_at: lastAny.started_at as string,
          finished_at: (lastAny.finished_at as string | null) ?? null,
          trigger: lastAny.trigger as string,
          scanned: (lastAny.scanned as number | null) ?? null,
          merged_candidates: (lastAny.merged_candidates as number | null) ?? null,
          stale_candidates: (lastAny.stale_candidates as number | null) ?? null,
          conflict_candidates:
            (lastAny.conflict_candidates as number | null) ?? null,
          status: lastAny.status as string,
          error: (lastAny.error as string | null) ?? null
        }
      : null,
    new_active_since_last: newActive,
    days_since_last: daysSinceLast,
    days_until_backstop: daysUntilBackstop,
    would_run: next_trigger !== null,
    next_trigger
  };
}

export async function decideConsolidationTrigger(
  admin: SupabaseClient,
  force: boolean
): Promise<ConsolidationTrigger | null> {
  if (force) return "manual";
  const status = await getConsolidationStatus(admin);
  return status.next_trigger;
}

async function finishRun(
  admin: SupabaseClient,
  runId: string,
  patch: {
    status: "done" | "failed";
    scanned?: number;
    merged_candidates?: number;
    stale_candidates?: number;
    conflict_candidates?: number;
    error?: string | null;
  }
): Promise<void> {
  const { error } = await admin
    .from("luna_consolidation_runs")
    .update({
      ...patch,
      finished_at: new Date().toISOString()
    })
    .eq("id", runId);
  if (error) {
    console.error("[luna/consolidate] finish run", error);
  }
}

export async function runConsolidation(
  admin: SupabaseClient,
  opts: { force?: boolean } = {}
): Promise<ConsolidationRunResult> {
  const trigger = await decideConsolidationTrigger(admin, Boolean(opts.force));
  if (!trigger) {
    return { skipped: true, trigger: null, reason: "thresholds not met" };
  }

  const { data: runRow, error: runInsertError } = await admin
    .from("luna_consolidation_runs")
    .insert({
      trigger,
      status: "running"
    })
    .select("id")
    .single();

  if (runInsertError || !runRow) {
    throw new Error(runInsertError?.message || "Failed to create consolidation run");
  }
  const runId = runRow.id as string;

  try {
    const { data: actives, error: activeError } = await admin
      .from("luna_learnings")
      .select("id, content, category, use_count, last_used_at, created_at")
      .eq("status", "active")
      .neq("category", "identity")
      .order("created_at", { ascending: true });

    if (activeError) {
      throw new Error(activeError.message);
    }

    const rows = (actives ?? []) as ActiveRow[];
    const scanned = rows.length;
    const activeIds = new Set(rows.map((r) => r.id));
    const maxChanges = Math.max(1, Math.floor(scanned * 0.3));

    const staleCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const staleIds = rows
      .filter((r) => {
        const useCount = r.use_count ?? 0;
        if (useCount > 2) return false;
        const ref = r.last_used_at ?? r.created_at;
        if (!ref) return false;
        const t = new Date(ref).getTime();
        return !Number.isNaN(t) && t < staleCutoff;
      })
      .map((r) => r.id);

    const client = getAnthropicClient();
    if (!client) {
      await finishRun(admin, runId, {
        status: "failed",
        scanned,
        error: "Claude API key is not configured"
      });
      await lunaNotify(
        admin,
        "consolidation",
        "정리 실패",
        "Claude API key is not configured",
        { level: "error" }
      );
      return {
        skipped: false,
        trigger,
        run_id: runId,
        scanned,
        error: "Claude API key is not configured"
      };
    }

    const inputList = rows.map((r) => ({
      id: r.id,
      category: r.category,
      content: r.content,
      use_count: r.use_count ?? 0
    }));

    const response = await client.messages.create({
      model: LUNA_MODEL,
      max_tokens: 8192,
      system: CONSOLIDATE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `다음 active 학습을 분류하세요.\n\n${JSON.stringify(inputList, null, 2)}`
        }
      ]
    });

    const rawText =
      response.content.find((p) => p.type === "text")?.text?.trim() ?? "";
    const parsed = parseJsonObject(rawText);
    if (!parsed) {
      await finishRun(admin, runId, {
        status: "failed",
        scanned,
        error: "Failed to parse consolidation model response"
      });
      await lunaNotify(
        admin,
        "consolidation",
        "정리 실패",
        "LLM 응답 JSON 파싱 실패 — 변경 없음",
        { level: "error" }
      );
      return {
        skipped: false,
        trigger,
        run_id: runId,
        scanned,
        error: "Failed to parse consolidation model response"
      };
    }

    type DupPlan = {
      keep_id: string;
      merge_ids: string[];
      merged_content: string;
    };
    type ConflictPlan = { ids: [string, string]; group: string };

    const claimed = new Set<string>();
    const dupPlans: DupPlan[] = [];
    const conflictPlans: ConflictPlan[] = [];

    const duplicatesRaw = Array.isArray(parsed.duplicates) ? parsed.duplicates : [];
    for (const item of duplicatesRaw) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const keepId =
        typeof obj.keep_id === "string" ? obj.keep_id.trim() : "";
      const mergeIds = asIdList(obj.merge_ids).filter(
        (id) => id !== keepId && activeIds.has(id)
      );
      const mergedContent =
        typeof obj.merged_content === "string" ? obj.merged_content.trim() : "";
      if (!keepId || !activeIds.has(keepId) || mergeIds.length === 0 || !mergedContent) {
        continue;
      }
      if (claimed.has(keepId) || mergeIds.some((id) => claimed.has(id))) continue;
      claimed.add(keepId);
      for (const id of mergeIds) claimed.add(id);
      dupPlans.push({ keep_id: keepId, merge_ids: mergeIds, merged_content: mergedContent });
    }

    const contradictionsRaw = Array.isArray(parsed.contradictions)
      ? parsed.contradictions
      : [];
    for (const item of contradictionsRaw) {
      if (!item || typeof item !== "object") continue;
      const ids = asIdList((item as Record<string, unknown>).ids).filter((id) =>
        activeIds.has(id)
      );
      if (ids.length < 2) continue;
      const a = ids[0]!;
      const b = ids[1]!;
      if (a === b) continue;
      if (claimed.has(a) || claimed.has(b)) continue;
      claimed.add(a);
      claimed.add(b);
      conflictPlans.push({ ids: [a, b], group: randomUUID() });
    }

    // stale: LLM claim 과 겹치지 않는 것만
    const staleApply = staleIds.filter((id) => !claimed.has(id));

    const changeIds = new Set<string>();
    for (const d of dupPlans) {
      for (const id of d.merge_ids) changeIds.add(id);
    }
    for (const c of conflictPlans) {
      changeIds.add(c.ids[0]);
      changeIds.add(c.ids[1]);
    }
    for (const id of staleApply) changeIds.add(id);

    if (changeIds.size > maxChanges) {
      const msg = `변경 상한 초과 (${changeIds.size} > ${maxChanges}, active ${scanned}의 30%)`;
      await finishRun(admin, runId, {
        status: "failed",
        scanned,
        error: msg
      });
      await lunaNotify(admin, "consolidation", "정리 실패", msg, {
        level: "error"
      });
      return {
        skipped: false,
        trigger,
        run_id: runId,
        scanned,
        error: msg
      };
    }

    let mergedCandidates = 0;
    for (const d of dupPlans) {
      for (const mid of d.merge_ids) {
        const { error } = await admin
          .from("luna_learnings")
          .update({
            status: "candidate",
            review_reason: "duplicate",
            merge_target: d.keep_id,
            raw_input: d.merged_content,
            origin: "direct"
          })
          .eq("id", mid)
          .eq("status", "active");
        if (error) {
          throw new Error(error.message);
        }
        mergedCandidates += 1;
      }
    }

    let conflictCandidates = 0;
    for (const c of conflictPlans) {
      const { error } = await admin
        .from("luna_learnings")
        .update({
          status: "conflict",
          conflict_group: c.group,
          review_reason: "contradiction",
          origin: "direct"
        })
        .in("id", c.ids)
        .eq("status", "active");
      if (error) {
        throw new Error(error.message);
      }
      conflictCandidates += 1;
    }

    let staleCandidates = 0;
    if (staleApply.length > 0) {
      const { error, count } = await admin
        .from("luna_learnings")
        .update(
          {
            status: "candidate",
            review_reason: "stale",
            origin: "direct"
          },
          { count: "exact" }
        )
        .in("id", staleApply)
        .eq("status", "active");
      if (error) {
        throw new Error(error.message);
      }
      staleCandidates = count ?? staleApply.length;
    }

    await finishRun(admin, runId, {
      status: "done",
      scanned,
      merged_candidates: mergedCandidates,
      stale_candidates: staleCandidates,
      conflict_candidates: conflictCandidates,
      error: null
    });

    const totalReview =
      mergedCandidates + staleCandidates + conflictCandidates;
    await lunaNotify(
      admin,
      "consolidation",
      `정리 완료 — 검토 ${totalReview}건(중복 ${mergedCandidates}·미사용 ${staleCandidates}·충돌 ${conflictCandidates})`,
      `트리거: ${trigger}`,
      {
        level: "success",
        meta: {
          trigger,
          merged_candidates: mergedCandidates,
          stale_candidates: staleCandidates,
          conflict_candidates: conflictCandidates
        }
      }
    );

    await triggerAutoExam(admin, "consolidation");

    return {
      skipped: false,
      trigger,
      run_id: runId,
      scanned,
      merged_candidates: mergedCandidates,
      stale_candidates: staleCandidates,
      conflict_candidates: conflictCandidates
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Consolidation failed";
    await finishRun(admin, runId, {
      status: "failed",
      error: message
    });
    await lunaNotify(admin, "consolidation", "정리 실패", message, {
      level: "error"
    });
    return {
      skipped: false,
      trigger,
      run_id: runId,
      error: message
    };
  }
}
