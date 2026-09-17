import type { SupabaseClient } from "@supabase/supabase-js";
import { isDevnoteStatus, type DevnoteStatus } from "@/lib/devnote/types";

/** 서비스 이름까지 붙인 목록용 행 — 화면이 쓰는 모양 그대로 */
export type DevnoteBlockerRow = {
  id: string;
  service_id: string | null;
  service_name: string;
  service_slug: string | null;
  service_status: DevnoteStatus | null;
  title: string;
  body: string;
  since: string | null;
  resolved_at: string | null;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asTextOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

type ServiceMeta = {
  name: string;
  slug: string;
  status: DevnoteStatus | null;
};

/**
 * 막힌 것 전체 (해결된 것 포함).
 * 서비스는 따로 읽어 JS 에서 붙인다 — 목록이 수십 건이라 중첩 select 를 쓸 이유가 없다.
 */
export async function loadDevnoteBlockers(
  client: SupabaseClient
): Promise<DevnoteBlockerRow[]> {
  const [blockersRes, servicesRes] = await Promise.all([
    client
      .from("devnote_blockers")
      .select("id, service_id, title, body, since, resolved_at")
      .order("since", { ascending: false, nullsFirst: false }),
    client.from("devnote_services").select("id, slug, name, status")
  ]);
  if (blockersRes.error) throw new Error(blockersRes.error.message);
  if (servicesRes.error) throw new Error(servicesRes.error.message);

  const services = new Map<string, ServiceMeta>();
  for (const row of servicesRes.data ?? []) {
    if (typeof row.id !== "string") continue;
    const status = asText(row.status);
    services.set(row.id, {
      name: asText(row.name) || asText(row.slug),
      slug: asText(row.slug),
      status: isDevnoteStatus(status) ? status : null
    });
  }

  return (blockersRes.data ?? []).map((row) => {
    const serviceId = typeof row.service_id === "string" ? row.service_id : null;
    const service = serviceId ? services.get(serviceId) : undefined;
    return {
      id: String(row.id),
      service_id: serviceId,
      service_name: service?.name ?? "서비스 없음",
      service_slug: service?.slug ?? null,
      service_status: service?.status ?? null,
      title: asText(row.title),
      body: asText(row.body),
      since: asTextOrNull(row.since),
      resolved_at: asTextOrNull(row.resolved_at)
    };
  });
}

export async function setDevnoteBlockerResolved(
  client: SupabaseClient,
  id: string,
  resolved: boolean
): Promise<string | null> {
  const resolvedAt = resolved
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date())
    : null;
  const { error } = await client
    .from("devnote_blockers")
    .update({ resolved_at: resolvedAt })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return resolvedAt;
}
