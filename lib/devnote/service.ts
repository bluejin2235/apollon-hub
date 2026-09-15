import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isDevnoteStatus,
  type DevnoteDecisionRow,
  type DevnoteServiceRow,
  type DevnoteTodoRow
} from "@/lib/devnote/types";

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asTextOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mapService(row: Record<string, unknown>): DevnoteServiceRow | null {
  const status = asText(row.status);
  if (!isDevnoteStatus(status) || typeof row.id !== "string" || typeof row.slug !== "string") {
    return null;
  }
  return {
    id: row.id,
    slug: row.slug,
    name: asText(row.name) || row.slug,
    path: asTextOrNull(row.path),
    repo: asTextOrNull(row.repo),
    status,
    overview: asText(row.overview),
    data_notes: asText(row.data_notes),
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null
  };
}

function mapDecision(row: Record<string, unknown>): DevnoteDecisionRow {
  return {
    id: String(row.id),
    service_id: typeof row.service_id === "string" ? row.service_id : null,
    decided_on: asText(row.decided_on),
    what: asText(row.what),
    why: asText(row.why),
    is_key: row.is_key === true
  };
}

function mapTodo(row: Record<string, unknown>): DevnoteTodoRow {
  return {
    id: String(row.id),
    service_id: typeof row.service_id === "string" ? row.service_id : null,
    title: asText(row.title),
    body: asTextOrNull(row.body),
    done: row.done === true,
    sort_order: typeof row.sort_order === "number" ? row.sort_order : 0
  };
}

export async function loadDevnoteServiceNote(
  client: SupabaseClient,
  slug: string
): Promise<{
  service: DevnoteServiceRow;
  decisions: DevnoteDecisionRow[];
  todos: DevnoteTodoRow[];
} | null> {
  const { data, error } = await client
    .from("devnote_services")
    .select("id, slug, name, path, repo, status, overview, data_notes, updated_at")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const service = mapService(data as Record<string, unknown>);
  if (!service) return null;

  const [decisionsRes, todosRes] = await Promise.all([
    client
      .from("devnote_decisions")
      .select("id, service_id, decided_on, what, why, is_key")
      .eq("service_id", service.id)
      .order("decided_on", { ascending: false }),
    client
      .from("devnote_todos")
      .select("id, service_id, title, body, done, sort_order")
      .eq("service_id", service.id)
      .order("sort_order", { ascending: true })
  ]);
  if (decisionsRes.error) throw new Error(decisionsRes.error.message);
  if (todosRes.error) throw new Error(todosRes.error.message);

  return {
    service,
    decisions: (decisionsRes.data ?? []).map((row) =>
      mapDecision(row as Record<string, unknown>)
    ),
    todos: (todosRes.data ?? []).map((row) => mapTodo(row as Record<string, unknown>))
  };
}

export async function updateDevnoteServiceMarkdown(
  client: SupabaseClient,
  id: string,
  column: "overview" | "data_notes",
  value: string
): Promise<DevnoteServiceRow> {
  const { data, error } = await client
    .from("devnote_services")
    .update({ [column]: value, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, slug, name, path, repo, status, overview, data_notes, updated_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("저장할 행이 없습니다.");
  const mapped = mapService(data as Record<string, unknown>);
  if (!mapped) throw new Error("저장 결과를 읽지 못했습니다.");
  return mapped;
}

export async function upsertDevnoteDecision(
  client: SupabaseClient,
  input: {
    id?: string;
    service_id: string;
    decided_on: string;
    what: string;
    why: string;
    is_key: boolean;
  }
): Promise<DevnoteDecisionRow> {
  const payload = {
    service_id: input.service_id,
    decided_on: input.decided_on,
    what: input.what.trim(),
    why: input.why.trim() || null,
    is_key: input.is_key
  };
  const query = input.id
    ? client.from("devnote_decisions").update(payload).eq("id", input.id)
    : client.from("devnote_decisions").insert(payload);
  const { data, error } = await query
    .select("id, service_id, decided_on, what, why, is_key")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("저장하지 못했습니다.");
  return mapDecision(data as Record<string, unknown>);
}

export async function deleteDevnoteDecision(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await client.from("devnote_decisions").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function upsertDevnoteTodo(
  client: SupabaseClient,
  input: {
    id?: string;
    service_id: string;
    title: string;
    body: string;
    done?: boolean;
    sort_order?: number;
  }
): Promise<DevnoteTodoRow> {
  const payload: Record<string, unknown> = {
    service_id: input.service_id,
    title: input.title.trim(),
    body: input.body.trim() || null
  };
  if (typeof input.done === "boolean") payload.done = input.done;
  if (typeof input.sort_order === "number") payload.sort_order = input.sort_order;

  const query = input.id
    ? client.from("devnote_todos").update(payload).eq("id", input.id)
    : client.from("devnote_todos").insert({
        ...payload,
        done: false,
        sort_order: input.sort_order ?? 0
      });
  const { data, error } = await query
    .select("id, service_id, title, body, done, sort_order")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("저장하지 못했습니다.");
  return mapTodo(data as Record<string, unknown>);
}

export async function setDevnoteTodoDone(
  client: SupabaseClient,
  id: string,
  done: boolean
): Promise<void> {
  const { error } = await client.from("devnote_todos").update({ done }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteDevnoteTodo(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await client.from("devnote_todos").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export function todayKstYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function servicePathHref(path: string): string {
  const t = path.trim();
  if (/^https?:\/\//i.test(t) || t.startsWith("/")) return t;
  return `/${t}`;
}
