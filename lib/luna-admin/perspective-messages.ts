import type { SupabaseClient } from "@supabase/supabase-js";
import { isProductionData } from "@/lib/luna/data-context";

type PerspectiveMessage = { id: string; conversation_id: string; content: string | null; role: string };

/** Count real user questions only. Abort on incomplete provenance instead of rebuilding partial counts. */
export async function loadProductionPerspectiveMessages(admin: SupabaseClient): Promise<PerspectiveMessage[]> {
  const out: PerspectiveMessage[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const result = await admin.from("luna_messages")
      .select("id, conversation_id, content, role")
      .eq("role", "user").order("id").range(offset, offset + pageSize - 1);
    if (result.error) throw new Error(`perspective messages: ${result.error.message}`);
    const rows = (result.data ?? []) as PerspectiveMessage[];
    const ids = [...new Set(rows.map(row => row.conversation_id).filter(Boolean))];
    const allowed = new Set<string>();
    // Keep query URL sizes bounded even when every message has a different parent.
    for (let start = 0; start < ids.length; start += 80) {
      const parents = await admin.from("luna_conversations")
        .select("id, title, data_context")
        .in("id", ids.slice(start, start + 80)).eq("data_context", "production");
      if (parents.error) throw new Error(`perspective provenance: ${parents.error.message}`);
      for (const row of parents.data ?? []) {
        if (row.data_context === "production" && isProductionData(row)) allowed.add(row.id);
      }
    }
    out.push(...rows.filter(row => allowed.has(row.conversation_id)));
    if (rows.length < pageSize) break;
  }
  return out;
}

/** Clear obsolete generated usage counts, preserving manually owned perspectives. */
export function obsoletePerspectiveUsageIds(
  existing: Array<{ id: string; name: string; source: string; used_count: number }>,
  currentNames: string[]
): string[] {
  const current = new Set(currentNames);
  return existing.filter(row => row.source === "data" && row.used_count > 0 && !current.has(row.name))
    .map(row => row.id);
}
