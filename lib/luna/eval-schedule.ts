import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDayBounds } from "@/lib/luna/selfstudy";

export const EVAL_SCHEDULE_KEY = "eval_schedule";

/** weekday: 0=일 … 6=토 (KST) */
export type EvalLightSchedule = {
  enabled: boolean;
  hour: number;
  minute: number;
};

export type EvalHeavySchedule = {
  enabled: boolean;
  weekday: number;
  hour: number;
  minute: number;
};

export type EvalSchedule = {
  light: EvalLightSchedule;
  heavy: EvalHeavySchedule;
};

export const EVAL_SCHEDULE_DEFAULT: EvalSchedule = {
  light: { enabled: true, hour: 3, minute: 40 },
  heavy: { enabled: true, weekday: 0, hour: 3, minute: 50 }
};

/** 다른 루나 야간 작업(KST) — 겹침 경고용 */
export const LUNA_NIGHT_SLOTS: Array<{
  key: string;
  label: string;
  weekday: number | null;
  hour: number;
  minute: number;
}> = [
  { key: "selfstudy", label: "자습", weekday: null, hour: 3, minute: 0 },
  { key: "consolidate", label: "정리", weekday: null, hour: 3, minute: 30 },
  {
    key: "self-upgrade",
    label: "자기개선",
    weekday: 0,
    hour: 4,
    minute: 0
  }
];

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

function coerceInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function normalizeEvalSchedule(raw: unknown): EvalSchedule {
  const d = EVAL_SCHEDULE_DEFAULT;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...d, light: { ...d.light }, heavy: { ...d.heavy } };
  const row = raw as Record<string, unknown>;
  const lightRaw =
    row.light && typeof row.light === "object" && !Array.isArray(row.light)
      ? (row.light as Record<string, unknown>)
      : {};
  const heavyRaw =
    row.heavy && typeof row.heavy === "object" && !Array.isArray(row.heavy)
      ? (row.heavy as Record<string, unknown>)
      : {};
  return {
    light: {
      enabled:
        typeof lightRaw.enabled === "boolean"
          ? lightRaw.enabled
          : d.light.enabled,
      hour: coerceInt(lightRaw.hour, d.light.hour, 0, 23),
      minute: coerceInt(lightRaw.minute, d.light.minute, 0, 59)
    },
    heavy: {
      enabled:
        typeof heavyRaw.enabled === "boolean"
          ? heavyRaw.enabled
          : d.heavy.enabled,
      weekday: coerceInt(heavyRaw.weekday, d.heavy.weekday, 0, 6),
      hour: coerceInt(heavyRaw.hour, d.heavy.hour, 0, 23),
      minute: coerceInt(heavyRaw.minute, d.heavy.minute, 0, 59)
    }
  };
}

export async function getEvalSchedule(
  admin: SupabaseClient
): Promise<EvalSchedule> {
  const { data, error } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", EVAL_SCHEDULE_KEY)
    .maybeSingle();
  if (error) {
    console.error("[luna/eval-schedule] get", error);
    return normalizeEvalSchedule(null);
  }
  return normalizeEvalSchedule(data?.value);
}

export async function saveEvalSchedule(
  admin: SupabaseClient,
  schedule: EvalSchedule
): Promise<EvalSchedule> {
  const normalized = normalizeEvalSchedule(schedule);
  const { error } = await admin.from("luna_settings").upsert(
    {
      key: EVAL_SCHEDULE_KEY,
      value: normalized,
      updated_at: new Date().toISOString()
    },
    { onConflict: "key" }
  );
  if (error) throw new Error(error.message);
  return normalized;
}

export function kstParts(now = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth() + 1,
    day: kst.getUTCDate(),
    hour: kst.getUTCHours(),
    minute: kst.getUTCMinutes(),
    weekday: kst.getUTCDay()
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatTimeHm(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_KO[weekday] ?? "?";
}

/** cron 10분 윈도우: 설정 분 이상, +10분 미만이면 해당 슬롯 */
export function matchesMinuteWindow(
  nowMinute: number,
  targetMinute: number,
  window = 10
): boolean {
  return nowMinute >= targetMinute && nowMinute < targetMinute + window;
}

export function shouldRunLightNow(
  schedule: EvalSchedule,
  now = new Date()
): boolean {
  if (!schedule.light.enabled) return false;
  const p = kstParts(now);
  if (p.hour !== schedule.light.hour) return false;
  return matchesMinuteWindow(p.minute, schedule.light.minute);
}

export function shouldRunHeavyNow(
  schedule: EvalSchedule,
  now = new Date()
): boolean {
  if (!schedule.heavy.enabled) return false;
  const p = kstParts(now);
  if (p.weekday !== schedule.heavy.weekday) return false;
  if (p.hour !== schedule.heavy.hour) return false;
  return matchesMinuteWindow(p.minute, schedule.heavy.minute);
}

function nextDailyOccurrence(
  hour: number,
  minute: number,
  now = new Date()
): Date {
  const p = kstParts(now);
  const past =
    p.hour > hour || (p.hour === hour && p.minute >= minute);
  const utc = Date.UTC(
    p.year,
    p.month - 1,
    p.day + (past ? 1 : 0),
    hour - 9,
    minute,
    0
  );
  return new Date(utc);
}

function nextWeeklyOccurrence(
  weekday: number,
  hour: number,
  minute: number,
  now = new Date()
): Date {
  const p = kstParts(now);
  let add = (weekday - p.weekday + 7) % 7;
  if (add === 0) {
    const past =
      p.hour > hour || (p.hour === hour && p.minute >= minute);
    if (past) add = 7;
  }
  const utc = Date.UTC(
    p.year,
    p.month - 1,
    p.day + add,
    hour - 9,
    minute,
    0
  );
  return new Date(utc);
}

export function formatNextRunLabel(when: Date, now = new Date()): string {
  const n = kstParts(now);
  const t = kstParts(when);
  const time = formatTimeHm(t.hour, t.minute);
  if (t.year === n.year && t.month === n.month && t.day === n.day) {
    return `오늘 ${time}`;
  }
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tm = kstParts(tomorrow);
  if (t.year === tm.year && t.month === tm.month && t.day === tm.day) {
    return `내일 ${time}`;
  }
  return `${t.month}/${t.day} ${time}`;
}

export function nextLightRunAt(schedule: EvalSchedule, now = new Date()): Date | null {
  if (!schedule.light.enabled) return null;
  return nextDailyOccurrence(schedule.light.hour, schedule.light.minute, now);
}

export function nextHeavyRunAt(schedule: EvalSchedule, now = new Date()): Date | null {
  if (!schedule.heavy.enabled) return null;
  return nextWeeklyOccurrence(
    schedule.heavy.weekday,
    schedule.heavy.hour,
    schedule.heavy.minute,
    now
  );
}

export type ScheduleConflict = {
  tier: "light" | "heavy";
  with: string;
  message: string;
};

export function findScheduleConflicts(
  schedule: EvalSchedule
): ScheduleConflict[] {
  const out: ScheduleConflict[] = [];
  const sameSlot = (
    aHour: number,
    aMin: number,
    bHour: number,
    bMin: number
  ) => aHour === bHour && aMin === bMin;

  for (const slot of LUNA_NIGHT_SLOTS) {
    if (schedule.light.enabled) {
      if (
        sameSlot(
          schedule.light.hour,
          schedule.light.minute,
          slot.hour,
          slot.minute
        )
      ) {
        out.push({
          tier: "light",
          with: slot.key,
          message: `light ${formatTimeHm(schedule.light.hour, schedule.light.minute)}이 ${slot.label}과 겹칩니다`
        });
      }
    }
    if (schedule.heavy.enabled) {
      const weekdayOk =
        slot.weekday == null || slot.weekday === schedule.heavy.weekday;
      if (
        weekdayOk &&
        sameSlot(
          schedule.heavy.hour,
          schedule.heavy.minute,
          slot.hour,
          slot.minute
        )
      ) {
        out.push({
          tier: "heavy",
          with: slot.key,
          message: `heavy ${formatTimeHm(schedule.heavy.hour, schedule.heavy.minute)}이 ${slot.label}과 겹칩니다`
        });
      }
    }
  }

  if (
    schedule.light.enabled &&
    schedule.heavy.enabled &&
    schedule.light.hour === schedule.heavy.hour &&
    schedule.light.minute === schedule.heavy.minute
  ) {
    out.push({
      tier: "heavy",
      with: "light",
      message: "light와 heavy 시각이 같습니다"
    });
  }

  return out;
}

export type EvalTierLastRun = {
  id: string;
  finished_at: string | null;
  started_at: string | null;
  status: string;
  score_sum: number | null;
  score_max: number | null;
  passed: number | null;
  total: number | null;
  ok: boolean;
};

export async function loadTierLastRuns(
  admin: SupabaseClient
): Promise<{ light: EvalTierLastRun | null; heavy: EvalTierLastRun | null }> {
  const { data, error } = await admin
    .from("luna_eval_runs")
    .select(
      "id, tier, status, finished_at, started_at, score_sum, score_max, passed, total"
    )
    .in("tier", ["light", "heavy"])
    .order("finished_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[luna/eval-schedule] last runs", error);
    return { light: null, heavy: null };
  }

  const mapOne = (tier: "light" | "heavy"): EvalTierLastRun | null => {
    const row = (data ?? []).find((r) => r.tier === tier);
    if (!row) return null;
    const ok = row.status === "done";
    return {
      id: row.id as string,
      finished_at: (row.finished_at as string | null) ?? null,
      started_at: (row.started_at as string | null) ?? null,
      status: row.status as string,
      score_sum:
        typeof row.score_sum === "number" ? Number(row.score_sum) : null,
      score_max:
        typeof row.score_max === "number" ? Number(row.score_max) : null,
      passed: typeof row.passed === "number" ? row.passed : null,
      total: typeof row.total === "number" ? row.total : null,
      ok
    };
  };

  return { light: mapOne("light"), heavy: mapOne("heavy") };
}

/** 같은 tier가 오늘(KST) 이미 cron으로 돌았는지 — 10분 윈도우 중복 방지 */
export async function alreadyRanTierToday(
  admin: SupabaseClient,
  tier: "light" | "heavy",
  triggerPrefix: string
): Promise<boolean> {
  const { startIso, endIso } = kstDayBounds();
  const { data, error } = await admin
    .from("luna_eval_runs")
    .select("id, note, status")
    .eq("tier", tier)
    .gte("started_at", startIso)
    .lt("started_at", endIso)
    .order("started_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("[luna/eval-schedule] alreadyRan", error);
    return false;
  }
  return (data ?? []).some((r) => {
    const note = typeof r.note === "string" ? r.note : "";
    return (
      note.includes(triggerPrefix) &&
      (r.status === "done" || r.status === "running")
    );
  });
}

export function activeCaseCountsByTier(
  cases: Array<{ tier?: string | null; is_active?: boolean }>
): { light: number; heavy: number } {
  let light = 0;
  let heavy = 0;
  for (const c of cases) {
    if (c.is_active === false) continue;
    if (c.tier === "heavy") heavy += 1;
    else if (c.tier === "light") light += 1;
  }
  return { light, heavy };
}
