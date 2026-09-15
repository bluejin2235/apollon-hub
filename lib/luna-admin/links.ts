import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/luna-admin/db";
import { LINK_ASK_MIN, LINK_AUTO_SAVE } from "@/lib/luna-admin/confidence";

export type LunaLinkKind = "same" | "belongs" | "follows";
export type LunaLinkStatus = "active" | "pending" | "rejected";

export type LunaLinkRow = {
  id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  kind: LunaLinkKind;
  confidence: number;
  evidence: Record<string, unknown>;
  source: string;
  status: LunaLinkStatus;
  created_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  from_label?: string;
  to_label?: string;
};

export type LunaPerspectiveRow = {
  id: string;
  name: string;
  source: string;
  hit_count: number;
  used_count: number;
  status: string;
  created_at: string;
  last_used_at: string | null;
};

async function fetchKind(
  admin: SupabaseClient,
  kind: LunaLinkKind,
  opts?: { role?: string; limit?: number }
): Promise<LunaLinkRow[]> {
  let q = admin
    .from("luna_links")
    .select("*")
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);
  if (opts?.role) q = q.filter("evidence->>role", "eq", opts.role);
  const { data, error } = await q;
  if (error) {
    if (!isMissingTableError(error)) console.error("[luna-admin/links]", error);
    return [];
  }
  return (data ?? []) as LunaLinkRow[];
}

export async function listLinks(
  admin: SupabaseClient,
  kind?: LunaLinkKind | null
): Promise<LunaLinkRow[]> {
  if (kind === "belongs") return fetchKind(admin, "belongs", { role: "bundle", limit: 200 });
  if (kind === "same" || kind === "follows") return fetchKind(admin, kind, { limit: 200 });
  const [same, belongs, follows] = await Promise.all([
    fetchKind(admin, "same", { limit: 80 }),
    fetchKind(admin, "belongs", { role: "bundle", limit: 80 }),
    fetchKind(admin, "follows", { limit: 80 })
  ]);
  return [...same, ...belongs, ...follows];
}

export async function countLinks(
  admin: SupabaseClient,
  filter?: { kind?: LunaLinkKind; status?: LunaLinkStatus; sinceIso?: string }
): Promise<number> {
  let q = admin.from("luna_links").select("id", { count: "exact", head: true });
  if (filter?.kind) q = q.eq("kind", filter.kind);
  if (filter?.status) q = q.eq("status", filter.status);
  if (filter?.sinceIso) q = q.gte("created_at", filter.sinceIso);
  const { count, error } = await q;
  if (error) {
    if (!isMissingTableError(error)) console.error("[luna-admin/links] count", error);
    return 0;
  }
  return count ?? 0;
}

export async function latestLinkAt(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin
    .from("luna_links")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!isMissingTableError(error)) console.error("[luna-admin/links] latest", error);
    return null;
  }
  return typeof data?.created_at === "string" ? data.created_at : null;
}

export async function listPerspectives(
  admin: SupabaseClient
): Promise<LunaPerspectiveRow[]> {
  const { data, error } = await admin
    .from("luna_perspectives")
    .select("*")
    .order("hit_count", { ascending: false })
    .limit(100);
  if (error) {
    if (!isMissingTableError(error)) {
      console.error("[luna-admin/perspectives]", error);
    }
    return [];
  }
  return (data ?? []) as LunaPerspectiveRow[];
}

export async function linkKindCounts(admin: SupabaseClient) {
  const [all, same, belongs, follows, pending, auto, ask, hold] = await Promise.all([
    countLinks(admin, { status: "active" }),
    countLinks(admin, { kind: "same" }),
    countLinks(admin, { kind: "belongs" }),
    countLinks(admin, { kind: "follows" }),
    countLinks(admin, { status: "pending" }),
    countHighConfidence(admin, LINK_AUTO_SAVE, "gte"),
    countHighConfidence(admin, LINK_ASK_MIN, "ask"),
    countHighConfidence(admin, LINK_ASK_MIN, "lt")
  ]);
  return { all, same, belongs, follows, pending, auto, ask, hold };
}

async function countHighConfidence(
  admin: SupabaseClient,
  threshold: number,
  mode: "gte" | "ask" | "lt"
): Promise<number> {
  let q = admin.from("luna_links").select("id", { count: "exact", head: true });
  if (mode === "gte") q = q.gte("confidence", threshold);
  else if (mode === "lt") q = q.lt("confidence", threshold);
  else q = q.gte("confidence", threshold).lt("confidence", LINK_AUTO_SAVE);
  const { count, error } = await q;
  if (error) {
    if (!isMissingTableError(error)) console.error("[luna-admin/links] conf", error);
    return 0;
  }
  return count ?? 0;
}

export function evidenceTitle(row: LunaLinkRow, side: "from" | "to"): string {
  const ev = row.evidence ?? {};
  const key = side === "from" ? "from_title" : "to_title";
  const v = ev[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  return side === "from" ? row.from_id : row.to_id;
}

export function evidencePath(row: LunaLinkRow, side: "from" | "to"): string {
  const ev = row.evidence ?? {};
  const key = side === "from" ? "from_path" : "to_path";
  const v = ev[key];
  return typeof v === "string" ? v : "";
}

export function typeLabel(type: string): string {
  if (type === "project") return "Work · 프로젝트";
  if (type === "nas_path") return "Work";
  if (type === "notion_page") return "노션";
  if (type === "image") return "이미지";
  if (type === "term") return "용어";
  if (type === "wiki") return "위키";
  return type;
}
