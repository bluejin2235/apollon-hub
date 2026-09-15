import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFailureAnalysis } from "@/lib/luna-admin/analysis";
import type { TonightItem, TonightState, SentRow } from "@/lib/luna-admin/types";

export const TONIGHT_SETTINGS_KEY = "luna_admin_tonight";
export const SENT_SETTINGS_KEY = "luna_admin_sent";

export type { TonightItem, TonightState, SentRow };

const EFFECT: Record<string, string> = {
  "named-entity-index": "예상 검색 실패 감소",
  "work-link": "노션 ↔ Work 묶기",
  "wiki-draft": "규정 질문 답변",
  "prompt-fix": "되물음 처리",
  "answer-depth": "얕은 답 감소",
  "knowledge-fix": "틀린 지식 교정"
};

const MINUTES: Record<string, number> = {
  "named-entity-index": 20,
  "work-link": 40,
  "wiki-draft": 25,
  "prompt-fix": 15,
  "answer-depth": 20,
  "knowledge-fix": 20
};

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

export async function loadTonightState(admin: SupabaseClient): Promise<TonightState> {
  const saved = await readJsonSetting<Partial<TonightState>>(admin, TONIGHT_SETTINGS_KEY, {});
  const excluded = new Set(
    (saved.items ?? []).filter((i) => i.excluded).map((i) => i.id)
  );

  const analysis = await buildFailureAnalysis(admin);
  const items: TonightItem[] = [];

  for (const group of analysis.groups) {
    for (const action of group.actions) {
      if (action.when === "brain") continue;
      if (items.some((i) => i.id === action.id)) {
        const existing = items.find((i) => i.id === action.id);
        if (existing) {
          existing.failure_ids = [...new Set([...existing.failure_ids, ...group.failure_ids])];
          existing.why = `${existing.why} · ${group.title} ${group.count}건`;
        }
        continue;
      }
      items.push({
        id: action.id,
        title: action.title,
        what: group.common_cause,
        why: `실패 수집 「${group.title}」 ${group.count}건`,
        effect: EFFECT[action.id] ?? "실패 감소",
        minutes: MINUTES[action.id] ?? 20,
        excluded: excluded.has(action.id),
        when: action.when,
        failure_ids: group.failure_ids
      });
    }
  }

  const merged: TonightState = {
    items,
    generated_at: new Date().toISOString()
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
