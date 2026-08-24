import { supabase } from "@/lib/supabase/client";
import type {
  ApiResult,
  WebsiteMeta,
  WorkListData,
  WorkListItem
} from "@/lib/website/types";

async function accessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function queryString(params?: Record<string, string | number | undefined | null>): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function websiteFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const token = await accessToken();
  if (!token) {
    return { ok: false, error: "unauthorized", status: 401 };
  }

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (!isFormData && init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`/api/website/${path.replace(/^\//, "")}`, { ...init, headers });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!res.ok) {
    return {
      ok: false,
      error: typeof record?.error === "string" ? record.error : "request_failed",
      details: record?.details,
      status: res.status
    };
  }

  if (record && "error" in record && record.error && !("data" in record)) {
    return {
      ok: false,
      error: String(record.error),
      details: record.details,
      status: res.status
    };
  }

  const data = record && "data" in record ? (record.data as T) : (body as T);
  return { ok: true, data, status: res.status };
}

export function listWorks(params?: {
  status?: "all" | "draft" | "published";
  q?: string;
  category?: string;
  page?: number;
  limit?: number;
}): Promise<ApiResult<WorkListData>> {
  return websiteFetch<WorkListData>(`works${queryString(params)}`);
}

export function getWork(id: string): Promise<ApiResult<unknown>> {
  return websiteFetch(`works/${id}`);
}

export function createWork(body: unknown): Promise<ApiResult<{ id: string }>> {
  return websiteFetch("works", { method: "POST", body: JSON.stringify(body) });
}

export function updateWork(id: string, body: unknown): Promise<ApiResult<WorkListItem>> {
  return websiteFetch(`works/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteWork(id: string): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`works/${id}`, { method: "DELETE" });
}

export function getMeta(): Promise<ApiResult<WebsiteMeta>> {
  return websiteFetch<WebsiteMeta>("meta");
}
