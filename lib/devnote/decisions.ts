import type { SupabaseClient } from "@supabase/supabase-js";
import type { DevnoteDecisionListRow } from "@/lib/devnote/types";

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 전체 결정 기록 + 서비스 이름.
 * 서비스는 따로 읽어 붙인다 — 목록이 많아져도 중첩 select 가 필요 없다.
 */
export async function loadDevnoteDecisions(
  client: SupabaseClient
): Promise<DevnoteDecisionListRow[]> {
  const [decisionsRes, servicesRes] = await Promise.all([
    client
      .from("devnote_decisions")
      .select("id, service_id, decided_on, what, why, is_key")
      .order("decided_on", { ascending: false }),
    client.from("devnote_services").select("id, slug, name")
  ]);
  if (decisionsRes.error) throw new Error(decisionsRes.error.message);
  if (servicesRes.error) throw new Error(servicesRes.error.message);

  const services = new Map<string, { name: string; slug: string }>();
  for (const row of servicesRes.data ?? []) {
    if (typeof row.id !== "string") continue;
    services.set(row.id, {
      name: asText(row.name) || asText(row.slug),
      slug: asText(row.slug)
    });
  }

  return (decisionsRes.data ?? []).map((row) => {
    const serviceId = typeof row.service_id === "string" ? row.service_id : null;
    const service = serviceId ? services.get(serviceId) : undefined;
    return {
      id: String(row.id),
      service_id: serviceId,
      decided_on: asText(row.decided_on),
      what: asText(row.what),
      why: asText(row.why),
      is_key: row.is_key === true,
      service_name: service?.name ?? "서비스 없음",
      service_slug: service?.slug ?? null
    };
  });
}
