import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/luna-admin/db";
import { LINK_ASK_MIN, LINK_AUTO_SAVE } from "@/lib/luna-admin/confidence";
import { insertLunaSignal } from "@/lib/luna/signals";
import { isLinkRejectReason } from "@/lib/luna/signals-shared";

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

function sameSim(row: LunaLinkRow): number {
  const v = row.evidence?.similarity;
  return typeof v === "number" && Number.isFinite(v) ? v : 1;
}

export function sortSameLinks(rows: LunaLinkRow[]): LunaLinkRow[] {
  return [...rows].sort((a, b) => {
    const c = a.confidence - b.confidence;
    if (Math.abs(c) > 1e-6) return c;
    return sameSim(a) - sameSim(b);
  });
}

async function fetchKind(
  admin: SupabaseClient,
  kind: LunaLinkKind,
  opts?: { role?: string; limit?: number; includeRejected?: boolean }
): Promise<LunaLinkRow[]> {
  let q = admin
    .from("luna_links")
    .select("*")
    .eq("kind", kind)
    .order("confidence", { ascending: true })
    .limit(opts?.limit ?? 200);
  if (opts?.role) q = q.filter("evidence->>role", "eq", opts.role);
  if (!opts?.includeRejected) q = q.neq("status", "rejected");
  const { data, error } = await q;
  if (error) {
    if (!isMissingTableError(error)) console.error("[luna-admin/links]", error);
    return [];
  }
  const rows = (data ?? []) as LunaLinkRow[];
  return kind === "same" ? sortSameLinks(rows) : rows;
}

export async function listLinks(
  admin: SupabaseClient,
  kind?: LunaLinkKind | null,
  opts?: { includeRejected?: boolean }
): Promise<LunaLinkRow[]> {
  if (kind === "belongs") return fetchKind(admin, "belongs", { role: "bundle", limit: 200 });
  if (kind === "same") {
    return fetchKind(admin, "same", {
      limit: 500,
      includeRejected: opts?.includeRejected !== false
    });
  }
  if (kind === "follows") return fetchKind(admin, "follows", { limit: 200 });
  const [same, belongs, follows] = await Promise.all([
    fetchKind(admin, "same", { limit: 80 }),
    fetchKind(admin, "belongs", { role: "bundle", limit: 80 }),
    fetchKind(admin, "follows", { limit: 80 })
  ]);
  return [...sortSameLinks(same), ...belongs, ...follows];
}

export async function sameReviewCounts(admin: SupabaseClient) {
  const [all, need, confirmed, rejected] = await Promise.all([
    countSame(admin, { notRejected: true }),
    countSame(admin, { need: true }),
    countSame(admin, { human: true }),
    countSame(admin, { rejected: true })
  ]);
  return { all, need, confirmed, rejected };
}

async function countSame(
  admin: SupabaseClient,
  filter: { notRejected?: boolean; need?: boolean; human?: boolean; rejected?: boolean }
): Promise<number> {
  let q = admin
    .from("luna_links")
    .select("id", { count: "exact", head: true })
    .eq("kind", "same");
  if (filter.rejected) q = q.eq("status", "rejected");
  if (filter.notRejected) q = q.neq("status", "rejected");
  if (filter.human) q = q.eq("source", "human");
  if (filter.need) q = q.neq("source", "human").neq("status", "rejected");
  const { count, error } = await q;
  if (error) {
    if (!isMissingTableError(error)) console.error("[luna-admin/links] same", error);
    return 0;
  }
  return count ?? 0;
}

export type SameReviewAction = "reject" | "confirm" | "undo";

async function syncQuestionsForSameLinks(
  admin: SupabaseClient,
  userId: string,
  opts: {
    action: SameReviewAction;
    ids: string[];
  }
): Promise<void> {
  const ids = [...new Set(opts.ids.filter(Boolean))];
  if (ids.length === 0) return;
  const now = new Date().toISOString();

  if (opts.action === "undo") {
    const { error } = await admin
      .from("luna_questions")
      .update({
        status: "pending",
        answer: null,
        answered_by: null,
        answered_at: null
      })
      .in("link_id", ids)
      .in("status", ["answered", "skipped"]);
    if (error) console.error("[luna-admin/links] reopen questions", error);
    return;
  }

  const answer = opts.action === "confirm" ? "같아요" : "달라요";
  const { error } = await admin
    .from("luna_questions")
    .update({
      status: "answered",
      answer,
      answered_by: userId,
      answered_at: now
    })
    .in("link_id", ids)
    .eq("status", "pending");
  if (error) console.error("[luna-admin/links] close questions", error);
}

export async function reviewSameLinks(
  admin: SupabaseClient,
  userId: string,
  opts: {
    action: SameReviewAction;
    ids: string[];
    undo?: Array<{ id: string; status: LunaLinkStatus; source: string }>;
    reason?: string | null;
    note?: string | null;
  }
): Promise<{ updated: number }> {
  const ids = [...new Set(opts.ids.filter(Boolean))];
  if (opts.action === "undo") {
    const rows = opts.undo ?? [];
    for (const row of rows) {
      const { error } = await admin
        .from("luna_links")
        .update({ status: row.status, source: row.source })
        .eq("id", row.id)
        .eq("kind", "same");
      if (error) throw new Error(error.message);
    }
    await syncQuestionsForSameLinks(admin, userId, {
      action: "undo",
      ids: rows.map((r) => r.id)
    });
    return { updated: rows.length };
  }
  if (ids.length === 0) return { updated: 0 };
  const now = new Date().toISOString();

  if (opts.action === "reject") {
    const { data: before } = await admin
      .from("luna_links")
      .select("id, evidence")
      .eq("kind", "same")
      .in("id", ids);
    for (const row of before ?? []) {
      const ev = {
        ...((row.evidence as Record<string, unknown>) ?? {})
      };
      if (opts.reason && isLinkRejectReason(opts.reason)) {
        ev.reject_reason = opts.reason;
      }
      if (opts.note?.trim()) ev.reject_note = opts.note.trim().slice(0, 300);
      const { error } = await admin
        .from("luna_links")
        .update({ status: "rejected", evidence: ev })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      void insertLunaSignal(admin, {
        kind: "negative",
        source: "link_reject",
        subject_type: "link",
        subject_id: row.id as string,
        reason: opts.reason ?? null,
        note: opts.note ?? null,
        context: {
          from_title: ev.from_title ?? null,
          to_title: ev.to_title ?? null
        },
        user_id: userId
      }).catch((err) => console.error("[luna-admin/links] signal", err));
    }
    await syncQuestionsForSameLinks(admin, userId, {
      action: "reject",
      ids
    });
    return { updated: ids.length };
  }

  const patch = {
    source: "human" as const,
    status: "active" as const,
    confirmed_by: userId,
    confirmed_at: now
  };
  const { error, count } = await admin
    .from("luna_links")
    .update(patch, { count: "exact" })
    .eq("kind", "same")
    .in("id", ids);
  if (error) throw new Error(error.message);
  await syncQuestionsForSameLinks(admin, userId, {
    action: opts.action,
    ids
  });
  for (const id of ids) {
    void insertLunaSignal(admin, {
      kind: "positive",
      source: "question_answer",
      subject_type: "link",
      subject_id: id,
      reason: "같아요",
      user_id: userId
    }).catch((err) => console.error("[luna-admin/links] signal confirm", err));
  }
  return { updated: count ?? ids.length };
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
    .order("hit_count", { ascending: false });
  if (error) {
    if (!isMissingTableError(error)) {
      console.error("[luna-admin/perspectives]", error);
    }
    return [];
  }
  return (data ?? []) as LunaPerspectiveRow[];
}

export async function countPerspectives(
  admin: SupabaseClient,
  status?: "active" | "dormant"
): Promise<number> {
  let q = admin
    .from("luna_perspectives")
    .select("id", { count: "exact", head: true });
  if (status) q = q.eq("status", status);
  const { count, error } = await q;
  if (error) {
    if (!isMissingTableError(error)) {
      console.error("[luna-admin/perspectives] count", error);
    }
    return 0;
  }
  return count ?? 0;
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

export { typeLabel } from "@/lib/luna-admin/pair-view";
