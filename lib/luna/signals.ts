import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  InsertLunaSignalInput,
  LunaSignalKind,
  LunaSignalRow
} from "@/lib/luna/signals-shared";

function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: string }).code) : "";
  const msg =
    "message" in error ? String((error as { message?: string }).message) : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("luna_signals") ||
    msg.includes("does not exist")
  );
}

export async function insertLunaSignal(
  admin: SupabaseClient,
  input: InsertLunaSignalInput
): Promise<string | null> {
  const row = {
    kind: input.kind,
    source: input.source,
    subject_type: input.subject_type,
    subject_id: (input.subject_id ?? "").trim(),
    reason: input.reason?.trim() || null,
    note: input.note?.trim() || null,
    context: input.context ?? {},
    user_id: input.user_id ?? null,
    ...(input.created_at ? { created_at: input.created_at } : {})
  };
  const { data, error } = await admin
    .from("luna_signals")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (error) {
    if (!isMissingTable(error)) {
      console.error("[luna/signals] insert", error);
    }
    return null;
  }
  return typeof data?.id === "string" ? data.id : null;
}

export async function insertLunaSignals(
  admin: SupabaseClient,
  inputs: InsertLunaSignalInput[]
): Promise<number> {
  if (inputs.length === 0) return 0;
  const rows = inputs.map((input) => ({
    kind: input.kind,
    source: input.source,
    subject_type: input.subject_type,
    subject_id: (input.subject_id ?? "").trim(),
    reason: input.reason?.trim() || null,
    note: input.note?.trim() || null,
    context: input.context ?? {},
    user_id: input.user_id ?? null,
    ...(input.created_at ? { created_at: input.created_at } : {})
  }));
  const { error, count } = await admin
    .from("luna_signals")
    .insert(rows, { count: "exact" });
  if (error) {
    if (!isMissingTable(error)) {
      console.error("[luna/signals] bulk insert", error);
    }
    return 0;
  }
  return count ?? rows.length;
}

export async function countSignalsByKind(
  admin: SupabaseClient
): Promise<Record<LunaSignalKind, number>> {
  const out: Record<LunaSignalKind, number> = {
    negative: 0,
    positive: 0,
    correction: 0
  };
  for (const kind of Object.keys(out) as LunaSignalKind[]) {
    const { count, error } = await admin
      .from("luna_signals")
      .select("id", { count: "exact", head: true })
      .eq("kind", kind);
    if (error) {
      if (!isMissingTable(error)) console.error("[luna/signals] count", error);
      continue;
    }
    out[kind] = count ?? 0;
  }
  return out;
}

export async function listRecentSignals(
  admin: SupabaseClient,
  opts?: { kind?: LunaSignalKind; limit?: number }
): Promise<LunaSignalRow[]> {
  let q = admin
    .from("luna_signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.kind) q = q.eq("kind", opts.kind);
  const { data, error } = await q;
  if (error) {
    if (!isMissingTable(error)) console.error("[luna/signals] list", error);
    return [];
  }
  return (data ?? []) as LunaSignalRow[];
}
