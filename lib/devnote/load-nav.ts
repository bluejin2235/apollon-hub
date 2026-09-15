import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isDevnoteStatus,
  type DevnoteNavData,
  type DevnoteServiceNav
} from "@/lib/devnote/types";

export async function loadDevnoteNav(
  client: SupabaseClient
): Promise<DevnoteNavData | null> {
  const [servicesRes, decisionsRes, ideasRes, blockersRes, overviewRes] =
    await Promise.all([
      client
        .from("devnote_services")
        .select("slug, name, status")
        .order("sort_order", { ascending: true }),
      client.from("devnote_decisions").select("id", { count: "exact", head: true }),
      client.from("devnote_ideas").select("id", { count: "exact", head: true }),
      client
        .from("devnote_blockers")
        .select("id", { count: "exact", head: true })
        .is("resolved_at", null),
      client.from("devnote_overview").select("id").eq("id", 1).maybeSingle()
    ]);

  if (
    servicesRes.error ||
    decisionsRes.error ||
    ideasRes.error ||
    blockersRes.error ||
    overviewRes.error
  ) {
    return null;
  }

  const services: DevnoteServiceNav[] = (servicesRes.data ?? [])
    .map((row) => {
      const status = String(row.status ?? "");
      if (!isDevnoteStatus(status) || typeof row.slug !== "string") return null;
      return {
        slug: row.slug,
        name: typeof row.name === "string" ? row.name : row.slug,
        status
      };
    })
    .filter((row): row is DevnoteServiceNav => row !== null);

  if (services.length === 0 && !overviewRes.data) {
    return null;
  }

  return {
    services,
    decisionCount: decisionsRes.count ?? 0,
    ideaCount: ideasRes.count ?? 0,
    openBlockerCount: blockersRes.count ?? 0
  };
}
