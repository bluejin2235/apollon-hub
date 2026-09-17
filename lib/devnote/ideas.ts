import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isDevnoteIdeaStage,
  type DevnoteIdeaRow
} from "@/lib/devnote/types";

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 만들고 싶은 것 전체. stage 는 next / someday / seed.
 */
export async function loadDevnoteIdeas(
  client: SupabaseClient
): Promise<DevnoteIdeaRow[]> {
  const [ideasRes, servicesRes] = await Promise.all([
    client
      .from("devnote_ideas")
      .select("id, service_id, title, body, stage, sort_order")
      .order("sort_order", { ascending: true }),
    client.from("devnote_services").select("id, slug, name")
  ]);
  if (ideasRes.error) throw new Error(ideasRes.error.message);
  if (servicesRes.error) throw new Error(servicesRes.error.message);

  const services = new Map<string, { name: string; slug: string }>();
  for (const row of servicesRes.data ?? []) {
    if (typeof row.id !== "string") continue;
    services.set(row.id, {
      name: asText(row.name) || asText(row.slug),
      slug: asText(row.slug)
    });
  }

  return (ideasRes.data ?? [])
    .map((row) => {
      const stageRaw = asText(row.stage);
      if (!isDevnoteIdeaStage(stageRaw)) return null;
      const serviceId =
        typeof row.service_id === "string" ? row.service_id : null;
      const service = serviceId ? services.get(serviceId) : undefined;
      return {
        id: String(row.id),
        service_id: serviceId,
        service_name: service?.name ?? "서비스 없음",
        service_slug: service?.slug ?? null,
        title: asText(row.title),
        body: asText(row.body),
        stage: stageRaw,
        sort_order: typeof row.sort_order === "number" ? row.sort_order : 0
      } satisfies DevnoteIdeaRow;
    })
    .filter((row): row is DevnoteIdeaRow => row !== null);
}
