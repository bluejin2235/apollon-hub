import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMPTY_DEVNOTE_OVERVIEW,
  type DevnoteOverviewRow,
  type DevnoteOverviewTab
} from "@/lib/devnote/types";

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mapOverview(row: Record<string, unknown> | null): DevnoteOverviewRow {
  if (!row) return EMPTY_DEVNOTE_OVERVIEW;
  return {
    body: asText(row.body),
    env: asText(row.env),
    structure: asText(row.structure),
    principles: asText(row.principles),
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null
  };
}

export async function loadDevnoteOverview(
  client: SupabaseClient
): Promise<DevnoteOverviewRow> {
  const { data, error } = await client
    .from("devnote_overview")
    .select("body, env, structure, principles, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return mapOverview((data as Record<string, unknown> | null) ?? null);
}

export async function updateDevnoteOverviewColumn(
  client: SupabaseClient,
  tab: DevnoteOverviewTab,
  value: string
): Promise<DevnoteOverviewRow> {
  const { data, error } = await client
    .from("devnote_overview")
    .update({ [tab]: value, updated_at: new Date().toISOString() })
    .eq("id", 1)
    .select("body, env, structure, principles, updated_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error("저장할 행이 없습니다.");
  }
  return mapOverview(data as Record<string, unknown>);
}

export function formatDevnoteDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(iso));
}
