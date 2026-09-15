import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectTonightAgenda } from "@/lib/luna/study-agenda";
import type { TonightItem, TonightState, SentRow } from "@/lib/luna-admin/types";

export const TONIGHT_SETTINGS_KEY = "luna_admin_tonight";
export const SENT_SETTINGS_KEY = "luna_admin_sent";

export type { TonightItem, TonightState, SentRow };

async function readJsonSetting<T>(
  admin: SupabaseClient,
  key: string,
  fallback: T
): Promise<T> {
  const { data, error } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data?.value || typeof data.value !== "object") return fallback;
  return data.value as T;
}

async function writeJsonSetting(
  admin: SupabaseClient,
  key: string,
  value: unknown
): Promise<void> {
  const { error } = await admin.from("luna_settings").upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) console.error("[luna-admin] settings", key, error);
}

export async function getSentRows(admin: SupabaseClient): Promise<SentRow[]> {
  const raw = await readJsonSetting<{ rows?: SentRow[] }>(admin, SENT_SETTINGS_KEY, {});
  return Array.isArray(raw.rows) ? raw.rows : [];
}

export async function addSentRow(
  admin: SupabaseClient,
  row: Omit<SentRow, "id" | "sent_at" | "result" | "resolved"> & {
    result?: string;
    resolved?: boolean;
  }
): Promise<SentRow> {
  const rows = await getSentRows(admin);
  const next: SentRow = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    failure_label: row.failure_label,
    failure_ids: row.failure_ids,
    sent_at: new Date().toISOString(),
    topic: row.topic,
    result: row.result ?? "대기",
    resolved: row.resolved ?? false
  };
  await writeJsonSetting(admin, SENT_SETTINGS_KEY, { rows: [next, ...rows].slice(0, 200) });
  return next;
}

/** 루나가 DB를 훑어 오늘 밤 할 일을 스스로 정한다. */
export async function loadTonightState(admin: SupabaseClient): Promise<TonightState> {
  const saved = await readJsonSetting<Partial<TonightState>>(admin, TONIGHT_SETTINGS_KEY, {});
  const excluded = new Set(
    (saved.items ?? []).filter((i) => i.excluded).map((i) => i.id)
  );

  const { selected } = await selectTonightAgenda(admin, { excludedIds: excluded });

  const items: TonightItem[] = selected.map((s) => ({
    id: s.id,
    title: s.agenda,
    what: s.expected,
    why: s.why,
    effect: s.verifiable ? "스스로 채점 가능" : "사람 판단 필요",
    minutes: s.minutes,
    excluded: s.excluded,
    when: s.when,
    failure_ids: Array.isArray(s.scope.failure_ids)
      ? (s.scope.failure_ids as string[])
      : [],
    expected: s.expected,
    kind: s.kind,
    verifiable: s.verifiable
  }));

  const merged: TonightState = {
    items,
    generated_at: new Date().toISOString(),
    source: "autonomous"
  };
  await writeJsonSetting(admin, TONIGHT_SETTINGS_KEY, merged);
  return merged;
}

export async function excludeTonightItem(
  admin: SupabaseClient,
  id: string
): Promise<TonightState> {
  const state = await loadTonightState(admin);
  const items = state.items.map((item) =>
    item.id === id ? { ...item, excluded: true } : item
  );
  const next = { ...state, items };
  await writeJsonSetting(admin, TONIGHT_SETTINGS_KEY, next);
  return next;
}

export async function includeTonightItem(
  admin: SupabaseClient,
  id: string
): Promise<TonightState> {
  const state = await loadTonightState(admin);
  const items = state.items.map((item) =>
    item.id === id ? { ...item, excluded: false } : item
  );
  const next = { ...state, items };
  await writeJsonSetting(admin, TONIGHT_SETTINGS_KEY, next);
  return next;
}
