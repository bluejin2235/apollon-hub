import type { SupabaseClient } from "@supabase/supabase-js";
import { kstParts, matchesMinuteWindow } from "@/lib/luna/eval-schedule";

export const NOTION_INDEX_SCHEDULE_KEY = "notion_index_schedule";
export const NOTION_INDEX_EXCLUDE_KEY = "notion_index_exclude";

export type NotionIndexMode = "full" | "incremental";

export type NotionIndexSlot = {
  enabled: boolean;
  /** "HH:MM" KST */
  time: string;
};

export type NotionIndexSchedule = {
  full: NotionIndexSlot;
  incremental: NotionIndexSlot;
};

export type NotionIndexExclude = {
  min_block_length: number;
  exclude_paths: string[];
};

export const NOTION_INDEX_SCHEDULE_DEFAULT: NotionIndexSchedule = {
  full: { enabled: true, time: "03:20" },
  incremental: { enabled: true, time: "13:30" }
};

export const NOTION_INDEX_EXCLUDE_DEFAULT: NotionIndexExclude = {
  min_block_length: 15,
  exclude_paths: []
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function parseTimeHm(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function formatTimeHm(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function normalizeSlot(raw: unknown, fallback: NotionIndexSlot): NotionIndexSlot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...fallback };
  const row = raw as Record<string, unknown>;
  let time = fallback.time;
  if (typeof row.time === "string" && parseTimeHm(row.time)) {
    time = row.time.trim();
  } else if (
    typeof row.hour === "number" &&
    typeof row.minute === "number" &&
    Number.isFinite(row.hour) &&
    Number.isFinite(row.minute)
  ) {
    time = formatTimeHm(
      Math.min(23, Math.max(0, Math.trunc(row.hour))),
      Math.min(59, Math.max(0, Math.trunc(row.minute)))
    );
  }
  return {
    enabled: typeof row.enabled === "boolean" ? row.enabled : fallback.enabled,
    time
  };
}

export function normalizeNotionIndexSchedule(raw: unknown): NotionIndexSchedule {
  const d = NOTION_INDEX_SCHEDULE_DEFAULT;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      full: { ...d.full },
      incremental: { ...d.incremental }
    };
  }
  const row = raw as Record<string, unknown>;
  return {
    full: normalizeSlot(row.full, d.full),
    incremental: normalizeSlot(row.incremental, d.incremental)
  };
}

export function normalizeNotionIndexExclude(raw: unknown): NotionIndexExclude {
  const d = NOTION_INDEX_EXCLUDE_DEFAULT;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...d, exclude_paths: [] };
  }
  const row = raw as Record<string, unknown>;
  const min =
    typeof row.min_block_length === "number" && Number.isFinite(row.min_block_length)
      ? Math.min(500, Math.max(1, Math.trunc(row.min_block_length)))
      : d.min_block_length;
  const paths = Array.isArray(row.exclude_paths)
    ? row.exclude_paths
        .map((p) => (typeof p === "string" ? p.trim() : ""))
        .filter(Boolean)
        .slice(0, 100)
    : [];
  return { min_block_length: min, exclude_paths: paths };
}

export async function getNotionIndexSchedule(
  admin: SupabaseClient
): Promise<NotionIndexSchedule> {
  const { data, error } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", NOTION_INDEX_SCHEDULE_KEY)
    .maybeSingle();
  if (error) {
    console.error("[luna/notion-index-schedule] get", error);
    return normalizeNotionIndexSchedule(null);
  }
  return normalizeNotionIndexSchedule(data?.value);
}

export async function saveNotionIndexSchedule(
  admin: SupabaseClient,
  schedule: NotionIndexSchedule
): Promise<NotionIndexSchedule> {
  const normalized = normalizeNotionIndexSchedule(schedule);
  const { error } = await admin.from("luna_settings").upsert(
    {
      key: NOTION_INDEX_SCHEDULE_KEY,
      value: normalized,
      updated_at: new Date().toISOString()
    },
    { onConflict: "key" }
  );
  if (error) throw new Error(error.message);
  return normalized;
}

export async function getNotionIndexExclude(
  admin: SupabaseClient
): Promise<NotionIndexExclude> {
  const { data, error } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", NOTION_INDEX_EXCLUDE_KEY)
    .maybeSingle();
  if (error) {
    console.error("[luna/notion-index-exclude] get", error);
    return normalizeNotionIndexExclude(null);
  }
  return normalizeNotionIndexExclude(data?.value);
}

export async function saveNotionIndexExclude(
  admin: SupabaseClient,
  exclude: NotionIndexExclude
): Promise<NotionIndexExclude> {
  const normalized = normalizeNotionIndexExclude(exclude);
  const { error } = await admin.from("luna_settings").upsert(
    {
      key: NOTION_INDEX_EXCLUDE_KEY,
      value: normalized,
      updated_at: new Date().toISOString()
    },
    { onConflict: "key" }
  );
  if (error) throw new Error(error.message);
  return normalized;
}

export function shouldRunNotionIndexNow(
  schedule: NotionIndexSchedule,
  mode: NotionIndexMode,
  now = new Date()
): boolean {
  const slot = schedule[mode];
  if (!slot.enabled) return false;
  const parsed = parseTimeHm(slot.time);
  if (!parsed) return false;
  const p = kstParts(now);
  if (p.hour !== parsed.hour) return false;
  return matchesMinuteWindow(p.minute, parsed.minute);
}

export function pathIsExcluded(
  pathTitles: string[],
  title: string,
  excludePaths: string[]
): boolean {
  if (excludePaths.length === 0) return false;
  const hay = [...pathTitles, title].join(" / ").toLowerCase();
  return excludePaths.some((ex) => {
    const needle = ex.trim().toLowerCase();
    if (!needle) return false;
    return hay.includes(needle);
  });
}
