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

export type BlockLibraryItem = {
  id: string;
  name: string;
  description: string | null;
  preset: string;
  config: Record<string, unknown>;
  is_default: boolean;
  sort: number;
  created_by: string | null;
};

export type UploadResult = {
  path: string;
  publicUrl: string;
  width: number | null;
  height: number | null;
  size: number;
  mime: string;
};

export type OrderItem = { id: string; sort: number };

export function getLibrary(): Promise<ApiResult<{ items: BlockLibraryItem[] }>> {
  return websiteFetch<{ items: BlockLibraryItem[] }>("library");
}

export function createLibrary(body: unknown): Promise<ApiResult<BlockLibraryItem>> {
  return websiteFetch<BlockLibraryItem>("library", { method: "POST", body: JSON.stringify(body) });
}

export function createBlock(sectionId: string, body: unknown): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`sections/${sectionId}/blocks`, { method: "POST", body: JSON.stringify(body) });
}

export function updateBlock(
  sectionId: string,
  blockId: string,
  body: unknown
): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`sections/${sectionId}/blocks/${blockId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function deleteBlock(sectionId: string, blockId: string): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`sections/${sectionId}/blocks/${blockId}`, { method: "DELETE" });
}

export function reorderBlocks(sectionId: string, order: OrderItem[]): Promise<ApiResult<{ updated: number }>> {
  return websiteFetch(`sections/${sectionId}/blocks`, {
    method: "PUT",
    body: JSON.stringify({ order })
  });
}

export function addImages(blockId: string, images: unknown[]): Promise<ApiResult<unknown>> {
  return websiteFetch(`blocks/${blockId}/images`, { method: "POST", body: JSON.stringify(images) });
}

export function updateImage(
  blockId: string,
  imageId: string,
  body: unknown
): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`blocks/${blockId}/images/${imageId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function deleteImage(blockId: string, imageId: string): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`blocks/${blockId}/images/${imageId}`, { method: "DELETE" });
}

export function reorderImages(blockId: string, order: OrderItem[]): Promise<ApiResult<{ updated: number }>> {
  return websiteFetch(`blocks/${blockId}/images`, {
    method: "PUT",
    body: JSON.stringify({ order })
  });
}

export function createSection(workId: string, body: unknown): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`works/${workId}/sections`, { method: "POST", body: JSON.stringify(body) });
}

export function updateSection(
  workId: string,
  sectionId: string,
  body: unknown
): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`works/${workId}/sections/${sectionId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function deleteSection(workId: string, sectionId: string): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`works/${workId}/sections/${sectionId}`, { method: "DELETE" });
}

export function reorderSections(workId: string, order: OrderItem[]): Promise<ApiResult<{ updated: number }>> {
  return websiteFetch(`works/${workId}/sections`, {
    method: "PUT",
    body: JSON.stringify({ order })
  });
}

export function uploadFile(file: File, bucket: string, path: string): Promise<ApiResult<UploadResult>> {
  const form = new FormData();
  form.append("file", file);
  form.append("bucket", bucket);
  form.append("path", path);
  return websiteFetch<UploadResult>("upload", { method: "POST", body: form });
}
