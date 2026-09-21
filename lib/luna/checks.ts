/**
 * luna_checks — 약속한 정기 작업이 기한 안에 돌았는지 검사하고 스냅샷을 저장한다.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstParts } from "@/lib/luna/eval-schedule";
import {
  kstCalendarDaysAgo,
  lightFromThresholds,
  type TrafficLight
} from "@/lib/luna-admin/traffic";
import { IMAGE_CORPUS_TOTAL } from "@/lib/luna-admin/primary";
import { missingEnvGroups, logMissingEnvGroups } from "@/lib/luna/env-keys";
import { LUNA_CHECK_PROMISES } from "@/lib/luna/check-promises";
import { kstWeekBounds } from "@/lib/luna/self-report";

export type LunaCheckStatus = "ok" | "warn" | "bad" | "unknown";

export type LunaCheckRow = {
  id: string;
  label: string;
  promise_label: string;
  yellow_days: number;
  red_days: number;
  meaning_when_stale: string;
  href: string;
  btn_label: string;
  sort_order: number;
  enabled: boolean;
  last_ok_at: string | null;
  last_checked_at: string | null;
  status: LunaCheckStatus;
  days_stale: number | null;
  detail: string | null;
};

export type LunaCheckResult = LunaCheckRow & {
  light: TrafficLight;
  last_label: string;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "기록 없음";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "기록 없음";
  const p = kstParts(d);
  return `${String(p.month).padStart(2, "0")}.${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function statusFromLight(light: TrafficLight): LunaCheckStatus {
  if (light === "green") return "ok";
  if (light === "yellow") return "warn";
  return "bad";
}

async function latestIso(
  admin: SupabaseClient,
  table: string,
  column: string
): Promise<string | null> {
  const { data, error } = await admin
    .from(table)
    .select(column)
    .order(column, { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`[luna/checks] ${table}.${column}`, error);
    return null;
  }
  const v = data ? (data as unknown as Record<string, unknown>)[column] : null;
  return typeof v === "string" && v ? v : null;
}

/** 실행 기록 표 — 데이터 행 시각이 아니라 잡이 돈 시각 */
async function latestRunIso(
  admin: SupabaseClient,
  table: string,
  statuses: string[]
): Promise<string | null> {
  const { data, error } = await admin
    .from(table)
    .select("finished_at, started_at")
    .in("status", statuses)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`[luna/checks] ${table} run`, error);
    return null;
  }
  if (typeof data?.finished_at === "string" && data.finished_at) {
    return data.finished_at;
  }
  if (typeof data?.started_at === "string" && data.started_at) {
    return data.started_at;
  }
  return null;
}

async function settingsIso(
  admin: SupabaseClient,
  key: string,
  field: string
): Promise<string | null> {
  const { data } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  const value = data?.value;
  if (!value || typeof value !== "object") return null;
  const v = (value as Record<string, unknown>)[field];
  return typeof v === "string" && v ? v : null;
}

export const LINKS_LAST_CRON_KEY = "luna_links_last_cron";
export const SIGNALS_LAST_CRON_KEY = "luna_signals_last_cron";
export const USER_MEMORY_LAST_CRON_KEY = "luna_user_memory_last_cron";

export async function stampCronRan(
  admin: SupabaseClient,
  key: string,
  extra?: Record<string, unknown>
): Promise<void> {
  const iso = new Date().toISOString();
  const { error } = await admin.from("luna_settings").upsert(
    {
      key,
      value: { ...extra, ran_at: iso },
      updated_at: iso
    },
    { onConflict: "key" }
  );
  if (error) console.error("[luna/checks] stampCronRan", key, error);
}

async function resolveLastOkAt(
  admin: SupabaseClient,
  id: string
): Promise<{
  lastOkAt: string | null;
  extraDetail?: string;
  light?: TrafficLight;
}> {
  switch (id) {
    case "model_market": {
      const lastOkAt = await latestIso(admin, "luna_model_market", "fetched_at");
      const { data } = await admin
        .from("luna_settings")
        .select("value")
        .eq("key", "model_cost_settings")
        .maybeSingle();
      const err =
        data?.value && typeof data.value === "object"
          ? (data.value as { last_market_error?: unknown }).last_market_error
          : null;
      return {
        lastOkAt,
        extraDetail:
          typeof err === "string" && err.trim() ? err.trim() : undefined
      };
    }
    case "work_index": {
      const { data } = await admin
        .from("nas_scan_settings")
        .select("last_run_at")
        .eq("id", 1)
        .maybeSingle();
      return {
        lastOkAt:
          typeof data?.last_run_at === "string" ? data.last_run_at : null
      };
    }
    case "work_text": {
      const [runAt, { data: latestRow }, doneRes, totalRes] = await Promise.all([
        latestRunIso(admin, "nas_text_runs", ["done", "interrupted"]),
        admin
          .from("nas_file_text")
          .select("extracted_at")
          .not("extracted_at", "is", null)
          .order("extracted_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin
          .from("nas_file_text")
          .select("path", { count: "exact", head: true })
          .not("extracted_at", "is", null),
        admin.from("nas_file_text").select("path", { count: "exact", head: true })
      ]);
      const done = doneRes.count ?? 0;
      const total = totalRes.count ?? 0;
      const rowAt =
        typeof latestRow?.extracted_at === "string"
          ? latestRow.extracted_at
          : null;
      return {
        lastOkAt: runAt ?? rowAt,
        extraDetail:
          total > 0 ? `${done.toLocaleString("ko-KR")} / ${total.toLocaleString("ko-KR")}건` : undefined
      };
    }
    case "notion_index":
      return {
        lastOkAt: await latestIso(admin, "luna_notion_index_runs", "finished_at")
      };
    case "image_index": {
      const [runAt, { data: latestRow }, { count }] = await Promise.all([
        latestRunIso(admin, "luna_media_index_runs", ["done", "interrupted"]),
        admin
          .from("luna_media_index")
          .select("indexed_at")
          .order("indexed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin.from("luna_media_index").select("path", { count: "exact", head: true })
      ]);
      const indexed = count ?? 0;
      const rowAt =
        typeof latestRow?.indexed_at === "string" ? latestRow.indexed_at : null;
      return {
        lastOkAt: runAt ?? rowAt,
        extraDetail: `${indexed.toLocaleString("ko-KR")} / ${IMAGE_CORPUS_TOTAL.toLocaleString("ko-KR")}장`
      };
    }
    case "links": {
      const ranAt = await settingsIso(admin, LINKS_LAST_CRON_KEY, "ran_at");
      return {
        lastOkAt: ranAt ?? (await latestIso(admin, "luna_links", "created_at"))
      };
    }
    case "selfstudy": {
      const study = await latestIso(admin, "luna_study_runs", "started_at");
      if (study) return { lastOkAt: study };
      const { data } = await admin
        .from("luna_settings")
        .select("value")
        .eq("key", "selfstudy_last_run")
        .maybeSingle();
      const value = data?.value as { finished_at?: unknown } | null;
      return {
        lastOkAt:
          typeof value?.finished_at === "string" ? value.finished_at : null
      };
    }
    case "signals": {
      const ranAt = await settingsIso(admin, SIGNALS_LAST_CRON_KEY, "ran_at");
      return {
        lastOkAt: ranAt ?? (await latestIso(admin, "luna_signals", "created_at"))
      };
    }
    case "admin_report": {
      const { data } = await admin
        .from("luna_settings")
        .select("value")
        .eq("key", "luna_admin_report_last")
        .maybeSingle();
      const value = data?.value as { sent_at?: unknown } | null;
      return {
        lastOkAt: typeof value?.sent_at === "string" ? value.sent_at : null
      };
    }
    case "eval_light": {
      const [{ data, error }, { data: latest }] = await Promise.all([
        admin
          .from("luna_eval_runs")
          .select("finished_at")
          .eq("tier", "light")
          .eq("status", "done")
          .order("finished_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin
          .from("luna_eval_runs")
          .select("status, started_at")
          .eq("tier", "light")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ]);
      if (error) {
        console.error("[luna/checks] eval_light", error);
        return { lastOkAt: null };
      }
      const stuck =
        latest &&
        latest.status !== "done" &&
        typeof latest.status === "string"
          ? `마지막 실행이 ${latest.status}에서 멈춤`
          : undefined;
      return {
        lastOkAt:
          typeof data?.finished_at === "string" ? data.finished_at : null,
        extraDetail: stuck
      };
    }
    case "consolidate": {
      const [{ data, error }, { data: cron }] = await Promise.all([
        admin
          .from("luna_consolidation_runs")
          .select("finished_at")
          .eq("status", "done")
          .order("finished_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin
          .from("luna_settings")
          .select("value")
          .eq("key", "consolidation_last_cron")
          .maybeSingle()
      ]);
      if (error) {
        console.error("[luna/checks] consolidate", error);
        return { lastOkAt: null };
      }
      const cronVal =
        cron?.value && typeof cron.value === "object"
          ? (cron.value as { skipped?: unknown; reason?: unknown; at?: unknown })
          : null;
      const skip =
        cronVal?.skipped === true
          ? typeof cronVal.reason === "string"
            ? cronVal.reason
            : null
          : null;
      const cronAt = typeof cronVal?.at === "string" ? cronVal.at : null;
      const doneAt =
        typeof data?.finished_at === "string" ? data.finished_at : null;
      // 매일 확인만 해도 정상. 정리 본실행과 cron 확인 중 더 최근을 쓴다.
      const lastOkAt =
        cronAt && doneAt
          ? cronAt > doneAt
            ? cronAt
            : doneAt
          : cronAt ?? doneAt;
      return {
        lastOkAt,
        extraDetail:
          typeof skip === "string" && skip.trim()
            ? `확인만 · ${skip.trim()}`
            : undefined
      };
    }
    case "fx_rates": {
      const { data, error } = await admin
        .from("fx_daily_rates")
        .select("date, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error("[luna/checks] fx_rates", error);
        return { lastOkAt: null };
      }
      const createdAt =
        typeof data?.created_at === "string" ? data.created_at : null;
      const date = typeof data?.date === "string" ? data.date : null;
      return {
        lastOkAt: createdAt,
        extraDetail: date ? `데이터 ${date}` : undefined
      };
    }
    case "disk": {
      const { resolveStorageCheck } = await import("@/lib/luna/storage");
      const storage = await resolveStorageCheck(admin);
      return {
        lastOkAt: storage.lastOkAt,
        extraDetail: storage.extraDetail,
        light: storage.light
      };
    }
    case "response_time": {
      const { resolveResponseTimeCheck } = await import(
        "@/lib/luna/response-timings"
      );
      return resolveResponseTimeCheck(admin);
    }
    case "llm_failures": {
      const { resolveLlmFailureCheck } = await import(
        "@/lib/luna/llm-failures"
      );
      return resolveLlmFailureCheck(admin);
    }
    case "env_keys": {
      const missing = missingEnvGroups();
      if (missing.length === 0) {
        return { lastOkAt: new Date().toISOString() };
      }
      return {
        lastOkAt: null,
        extraDetail: missing.map((m) => m.message).join(" · ")
      };
    }
    case "source_stats": {
      const { data, error } = await admin
        .from("luna_source_stats")
        .select("day, computed_at")
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error("[luna/checks] source_stats", error);
        return { lastOkAt: null };
      }
      const day = typeof data?.day === "string" ? data.day : null;
      return {
        lastOkAt:
          typeof data?.computed_at === "string" ? data.computed_at : null,
        extraDetail: day ? `집계일 ${day}` : undefined
      };
    }
    case "user_memories": {
      const ranAt = await settingsIso(admin, USER_MEMORY_LAST_CRON_KEY, "ran_at");
      return {
        lastOkAt:
          ranAt ?? (await latestIso(admin, "luna_user_memories", "updated_at"))
      };
    }
    case "answer_found": {
      const last7Iso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [{ count }, lastAt] = await Promise.all([
        admin
          .from("luna_answer_found")
          .select("message_id", { count: "exact", head: true })
          .gte("created_at", last7Iso),
        latestIso(admin, "luna_answer_found", "created_at")
      ]);
      const n = count ?? 0;
      return {
        lastOkAt: lastAt ?? new Date().toISOString(),
        light: "green",
        extraDetail: n === 0 ? "최근 7일 0건" : `최근 7일 ${n}건`
      };
    }
    case "open_questions": {
      const week = kstWeekBounds();
      const [{ count }, lastAt] = await Promise.all([
        admin
          .from("luna_open_questions")
          .select("id", { count: "exact", head: true })
          .gte("created_at", week.startIso)
          .lt("created_at", week.endIso),
        latestIso(admin, "luna_open_questions", "created_at")
      ]);
      const n = count ?? 0;
      return {
        lastOkAt: lastAt ?? new Date().toISOString(),
        light: "green",
        extraDetail: n === 0 ? "이번 주 0건" : `이번 주 ${n}건`
      };
    }
    default:
      return { lastOkAt: null };
  }
}

export async function evaluateLunaChecks(
  admin: SupabaseClient,
  now = new Date()
): Promise<LunaCheckResult[]> {
  const { data, error } = await admin
    .from("luna_checks")
    .select("*")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[luna/checks] list", error);
    return [];
  }
  logMissingEnvGroups("luna_checks");
  const rows = (data ?? []) as LunaCheckRow[];
  const checkedAt = now.toISOString();
  const results: LunaCheckResult[] = [];

  for (const row of rows) {
    const resolved = await resolveLastOkAt(admin, row.id);
    // 타임아웃·조회 실패로 null 이 오면 이전 last_ok_at 을 지우지 않는다
    const lastOkAt = resolved.lastOkAt ?? row.last_ok_at;
    const days = kstCalendarDaysAgo(lastOkAt, now);
    const expectedMeta = LUNA_CHECK_PROMISES[row.id];
    const yellowDays = expectedMeta?.yellow_days ?? row.yellow_days;
    const redDays = expectedMeta?.red_days ?? row.red_days;
    const light =
      resolved.light ??
      (row.id === "disk" ||
      row.id === "response_time" ||
      row.id === "llm_failures" ||
      row.id === "answer_found" ||
      row.id === "open_questions"
        ? ("green" as const)
        : lightFromThresholds(days, yellowDays, redDays));
    const status = statusFromLight(light);
    const lastLabel = formatWhen(lastOkAt);
    const expectedPromise = expectedMeta?.promise_label;
    const promiseLabel = expectedPromise ?? row.promise_label;
    let detail: string;
    if (
      (row.id === "disk" ||
        row.id === "response_time" ||
        row.id === "llm_failures" ||
        row.id === "answer_found" ||
        row.id === "open_questions") &&
      resolved.extraDetail
    ) {
      detail = `${promiseLabel} · ${resolved.extraDetail}`;
    } else if (status === "ok") {
      detail =
        `${promiseLabel} · 마지막 ${lastLabel}` +
        (resolved.extraDetail ? ` · ${resolved.extraDetail}` : "");
    } else {
      const idle =
        days == null ? "기록 없음" : `${days}일째 멈춤`;
      detail =
        `${promiseLabel} · ${idle} · 마지막 ${lastLabel}` +
        (resolved.extraDetail ? ` · ${resolved.extraDetail}` : "");
    }

    const patch: Record<string, unknown> = {
      last_ok_at: lastOkAt,
      last_checked_at: checkedAt,
      status,
      days_stale: days,
      detail,
      updated_at: checkedAt
    };
    if (expectedPromise && expectedPromise !== row.promise_label) {
      patch.promise_label = expectedPromise;
    }
    if (expectedMeta?.yellow_days != null && expectedMeta.yellow_days !== row.yellow_days) {
      patch.yellow_days = expectedMeta.yellow_days;
    }
    if (expectedMeta?.red_days != null && expectedMeta.red_days !== row.red_days) {
      patch.red_days = expectedMeta.red_days;
    }
    const { error: upErr } = await admin
      .from("luna_checks")
      .update(patch)
      .eq("id", row.id);
    if (upErr) console.error("[luna/checks] update", row.id, upErr);

    results.push({
      ...row,
      last_ok_at: lastOkAt,
      last_checked_at: checkedAt,
      status,
      days_stale: days,
      detail,
      promise_label: promiseLabel,
      light,
      last_label: lastLabel
    });
  }

  return results;
}

export async function markAdminReportSent(
  admin: SupabaseClient,
  sentAt = new Date()
): Promise<void> {
  const iso = sentAt.toISOString();
  await admin.from("luna_settings").upsert(
    {
      key: "luna_admin_report_last",
      value: { sent_at: iso },
      updated_at: iso
    },
    { onConflict: "key" }
  );
  await admin
    .from("luna_checks")
    .update({
      last_ok_at: iso,
      last_checked_at: iso,
      status: "ok",
      days_stale: 0,
      detail: `매일 07:00 약속 · 마지막 ${formatWhen(iso)}`,
      updated_at: iso
    })
    .eq("id", "admin_report");
}
