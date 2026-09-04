import { supabase } from "@/lib/supabase/client";
import type { JobPosting, TalentPoolList } from "@/lib/website/career";
import type {
  InquiryFilter,
  InquiryItem,
  InquiryList,
  NewsletterList
} from "@/lib/website/contact";
import type { HomeCandidateList, HomeList, HomeSlot, HomeWrite } from "@/lib/website/home";
import type { StatsBundle, StatsQueryResult, StatsRealtime } from "@/lib/website/stats";
import type {
  ApiResult,
  InsightListData,
  InsightListItem,
  UploadNotice,
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
  const controller = new AbortController();
  const incoming = init?.signal;
  const onIncomingAbort = () => controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
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

    const timeoutMs = isFormData ? 180_000 : 30_000;
    timer = setTimeout(() => controller.abort(), timeoutMs);
    if (incoming) {
      if (incoming.aborted) controller.abort();
      else incoming.addEventListener("abort", onIncomingAbort, { once: true });
    }

    const res = await fetch(`/api/website/${path.replace(/^\//, "")}`, {
      ...init,
      credentials: "include",
      headers,
      signal: controller.signal
    });
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
    const notice =
      record && "notice" in record && record.notice && typeof record.notice === "object"
        ? (record.notice as UploadNotice)
        : undefined;
    return notice ? { ok: true, data, status: res.status, notice } : { ok: true, data, status: res.status };
  } catch (err) {
    if (controller.signal.aborted && !incoming?.aborted) {
      return { ok: false, error: "timeout", status: 0 };
    }
    return {
      ok: false,
      error: "network_error",
      details: { message: err instanceof Error ? err.message : "연결이 끊어졌습니다" },
      status: 0
    };
  } finally {
    if (timer) clearTimeout(timer);
    incoming?.removeEventListener("abort", onIncomingAbort);
  }
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

export function listInsights(params?: {
  status?: "all" | "draft" | "published";
  q?: string;
  category?: string;
  page?: number;
  limit?: number;
}): Promise<ApiResult<InsightListData>> {
  return websiteFetch<InsightListData>(`insights${queryString(params)}`);
}

export function getInsight(id: string): Promise<ApiResult<unknown>> {
  return websiteFetch(`insights/${id}`);
}

export function createInsight(body: unknown): Promise<ApiResult<{ id: string }>> {
  return websiteFetch("insights", { method: "POST", body: JSON.stringify(body) });
}

export function updateInsight(id: string, body: unknown): Promise<ApiResult<InsightListItem>> {
  return websiteFetch(`insights/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteInsight(id: string): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`insights/${id}`, { method: "DELETE" });
}

export function createInsightSection(
  insightId: string,
  body: unknown
): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`insights/${insightId}/sections`, { method: "POST", body: JSON.stringify(body) });
}

export function updateInsightSection(
  insightId: string,
  sectionId: string,
  body: unknown
): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`insights/${insightId}/sections/${sectionId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function deleteInsightSection(
  insightId: string,
  sectionId: string
): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`insights/${insightId}/sections/${sectionId}`, { method: "DELETE" });
}

export function reorderInsightSections(
  insightId: string,
  order: OrderItem[]
): Promise<ApiResult<{ updated: number }>> {
  return websiteFetch(`insights/${insightId}/sections`, {
    method: "PUT",
    body: JSON.stringify({ order })
  });
}

export function moveInsightBlock(
  insightId: string,
  body: { blockId: string; toSectionId: string; toSort: number }
): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`insights/${insightId}/blocks/move`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

export function createInsightBlock(
  insightId: string,
  body: unknown
): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`insights/${insightId}/blocks`, { method: "POST", body: JSON.stringify(body) });
}

export function updateInsightBlock(
  insightId: string,
  blockId: string,
  body: unknown
): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`insights/${insightId}/blocks/${blockId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function deleteInsightBlock(
  insightId: string,
  blockId: string
): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`insights/${insightId}/blocks/${blockId}`, { method: "DELETE" });
}

export function reorderInsightBlocks(
  insightId: string,
  order: OrderItem[]
): Promise<ApiResult<{ updated: number }>> {
  return websiteFetch(`insights/${insightId}/blocks/order`, {
    method: "PATCH",
    body: JSON.stringify({ order })
  });
}

export function setInsightTags(
  insightId: string,
  tagIds: string[]
): Promise<ApiResult<{ items: unknown[] }>> {
  return websiteFetch(`insights/${insightId}/tags`, {
    method: "PUT",
    body: JSON.stringify({ tagIds })
  });
}

export function addInsightRelated(
  insightId: string,
  body: unknown
): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`insights/${insightId}/related`, { method: "POST", body: JSON.stringify(body) });
}

export function deleteInsightRelated(
  insightId: string,
  relatedId: string
): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`insights/${insightId}/related/${relatedId}`, { method: "DELETE" });
}

export function reorderInsightRelated(
  insightId: string,
  order: OrderItem[]
): Promise<ApiResult<{ updated: number }>> {
  return websiteFetch(`insights/${insightId}/related`, {
    method: "PUT",
    body: JSON.stringify({ order })
  });
}

export function addInsightImages(blockId: string, images: unknown[]): Promise<ApiResult<unknown>> {
  return websiteFetch(`insight-blocks/${blockId}/images`, { method: "POST", body: JSON.stringify(images) });
}

export function updateInsightImage(
  blockId: string,
  imageId: string,
  body: unknown
): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`insight-blocks/${blockId}/images/${imageId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function deleteInsightImage(
  blockId: string,
  imageId: string
): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`insight-blocks/${blockId}/images/${imageId}`, { method: "DELETE" });
}

export function reorderInsightImages(
  blockId: string,
  order: OrderItem[]
): Promise<ApiResult<{ updated: number }>> {
  return websiteFetch(`insight-blocks/${blockId}/images`, {
    method: "PUT",
    body: JSON.stringify({ order })
  });
}

export function getMeta(): Promise<ApiResult<WebsiteMeta>> {
  return websiteFetch<WebsiteMeta>("meta");
}

export function getPreviewUrl(opts: {
  workId?: string;
  insightId?: string;
  sectionId?: string;
  blockId?: string;
  locale?: string;
}): Promise<ApiResult<{ url: string }>> {
  return websiteFetch<{ url: string }>("preview-url", {
    method: "POST",
    body: JSON.stringify(opts)
  });
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

export type UploadProgress = {
  loaded: number;
  total: number;
  percent: number;
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

function parseUploadBody(text: string, status: number): ApiResult<UploadResult> {
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      error: typeof record?.error === "string" ? record.error : "request_failed",
      details: record?.details,
      status
    };
  }
  if (record && "error" in record && record.error && !("data" in record)) {
    return {
      ok: false,
      error: String(record.error),
      details: record.details,
      status
    };
  }
  const data = (record && "data" in record ? record.data : body) as UploadResult;
  const notice =
    record && "notice" in record && record.notice && typeof record.notice === "object"
      ? (record.notice as UploadNotice)
      : undefined;
  return notice
    ? { ok: true, data, status, notice }
    : { ok: true, data, status };
}

export type SignedUploadKind = "loop_lg" | "loop_sm" | "video" | "gif";

export type SignedUploadContentType = "work" | "insight";

export type SignedUploadTarget = {
  contentType: SignedUploadContentType;
  contentId: string;
};

export type SignedUploadTicket = {
  signedUrl: string;
  token: string;
  path: string;
  publicUrl: string;
  bucket: "works" | "insights";
};

function asSignedTarget(
  target: SignedUploadTarget | string
): SignedUploadTarget {
  if (typeof target === "string") {
    return { contentType: "work", contentId: target };
  }
  return target;
}

function parseStorageError(text: string, status: number): { error: string; message: string } {
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const message =
    (typeof rec?.message === "string" && rec.message) ||
    (typeof rec?.error === "string" && rec.error) ||
    (typeof body === "string" && body.trim()) ||
    (status > 0 ? `저장소 오류 (${status})` : "저장소에 올리지 못했습니다");
  return { error: "upload_failed", message };
}

export function requestSignedUpload(body: {
  contentType?: SignedUploadContentType;
  contentId?: string;
  /** @deprecated contentType+contentId 로 바꿔 주세요. 당분간 유지합니다. */
  workId?: string;
  kind: SignedUploadKind;
  size?: number;
  folder?: string;
}): Promise<ApiResult<SignedUploadTicket>> {
  return websiteFetch<SignedUploadTicket>("upload/signed", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function putToSignedUrl(
  ticket: SignedUploadTicket,
  file: File,
  opts?: {
    onProgress?: (progress: UploadProgress) => void;
    signal?: AbortSignal;
  }
): Promise<ApiResult<UploadResult>> {
  return new Promise((resolve) => {
    if (opts?.signal?.aborted) {
      resolve({ ok: false, error: "aborted", status: 0 });
      return;
    }

    const xhr = new XMLHttpRequest();
    const timeoutMs =
      file.size > 80 * 1024 * 1024 ? 1_800_000 : file.size > 20 * 1024 * 1024 ? 600_000 : 180_000;
    xhr.timeout = timeoutMs;
    xhr.open("PUT", ticket.signedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");

    const onAbort = () => xhr.abort();
    opts?.signal?.addEventListener("abort", onAbort, { once: true });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !opts?.onProgress) return;
      opts.onProgress({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100)
      });
    };

    xhr.onload = () => {
      opts?.signal?.removeEventListener("abort", onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({
          ok: true,
          data: {
            path: ticket.path,
            publicUrl: ticket.publicUrl,
            width: null,
            height: null,
            size: file.size,
            mime: file.type || "video/mp4"
          },
          status: xhr.status
        });
        return;
      }
      const parsed = parseStorageError(xhr.responseText, xhr.status);
      resolve({
        ok: false,
        error: parsed.error,
        details: { message: parsed.message },
        status: xhr.status
      });
    };
    xhr.onerror = () => {
      opts?.signal?.removeEventListener("abort", onAbort);
      resolve({
        ok: false,
        error: "network_error",
        details: { message: "저장소에 연결하지 못했습니다" },
        status: 0
      });
    };
    xhr.ontimeout = () => {
      opts?.signal?.removeEventListener("abort", onAbort);
      resolve({ ok: false, error: "timeout", status: 0 });
    };
    xhr.onabort = () => {
      opts?.signal?.removeEventListener("abort", onAbort);
      resolve({ ok: false, error: "aborted", status: 0 });
    };

    xhr.send(file);
  });
}

export async function uploadVideo(
  file: File,
  target: SignedUploadTarget | string,
  kind: SignedUploadKind,
  opts?: {
    onProgress?: (progress: UploadProgress) => void;
    signal?: AbortSignal;
    folder?: string;
  }
): Promise<ApiResult<UploadResult>> {
  const resolved = asSignedTarget(target);
  const ticket = await requestSignedUpload({
    contentType: resolved.contentType,
    contentId: resolved.contentId,
    // 예전 서버·프록시 호환
    ...(resolved.contentType === "work" ? { workId: resolved.contentId } : {}),
    kind,
    size: file.size,
    folder: opts?.folder
  });
  if (!ticket.ok) return ticket;
  const put = await putToSignedUrl(ticket.data, file, opts);
  if (!put.ok) return put;
  const mime = file.type || (kind === "gif" ? "image/gif" : "video/mp4");
  const data: UploadResult = {
    ...put.data,
    mime,
    size: file.size
  };
  return ticket.notice ? { ...put, data, notice: ticket.notice } : { ...put, data };
}

/** GIF 는 서버를 거치지 않고 Storage 로 직접 올린다 (미들웨어 10MB 상한 회피). */
export async function uploadGif(
  file: File,
  target: SignedUploadTarget | string,
  folder: string,
  opts?: {
    onProgress?: (progress: UploadProgress) => void;
    signal?: AbortSignal;
  }
): Promise<ApiResult<UploadResult>> {
  return uploadVideo(file, target, "gif", { ...opts, folder });
}

export function uploadFile(
  file: File,
  bucket: string,
  path: string,
  opts?: {
    onProgress?: (progress: UploadProgress) => void;
    signal?: AbortSignal;
    fields?: Record<string, string>;
  }
): Promise<ApiResult<UploadResult>> {
  return new Promise((resolve) => {
    void (async () => {
      const token = await accessToken();
      if (!token) {
        resolve({ ok: false, error: "unauthorized", status: 401 });
        return;
      }

      if (opts?.signal?.aborted) {
        resolve({ ok: false, error: "aborted", status: 0 });
        return;
      }

      const form = new FormData();
      form.append("file", file);
      form.append("bucket", bucket);
      form.append("path", path);
      if (opts?.fields) {
        for (const [key, value] of Object.entries(opts.fields)) {
          form.append(key, value);
        }
      }

      const xhr = new XMLHttpRequest();
      const timeoutMs =
        file.size > 80 * 1024 * 1024 ? 1_800_000 : file.size > 20 * 1024 * 1024 ? 600_000 : 180_000;
      xhr.timeout = timeoutMs;
      xhr.open("POST", "/api/website/upload");
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      const onAbort = () => xhr.abort();
      opts?.signal?.addEventListener("abort", onAbort, { once: true });

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || !opts?.onProgress) return;
        opts.onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100)
        });
      };

      xhr.onload = () => {
        opts?.signal?.removeEventListener("abort", onAbort);
        resolve(parseUploadBody(xhr.responseText, xhr.status));
      };
      xhr.onerror = () => {
        opts?.signal?.removeEventListener("abort", onAbort);
        resolve({ ok: false, error: "network_error", status: 0 });
      };
      xhr.ontimeout = () => {
        opts?.signal?.removeEventListener("abort", onAbort);
        resolve({ ok: false, error: "timeout", status: 0 });
      };
      xhr.onabort = () => {
        opts?.signal?.removeEventListener("abort", onAbort);
        resolve({ ok: false, error: "aborted", status: 0 });
      };

      xhr.send(form);
    })();
  });
}

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

export function moveBlock(
  workId: string,
  body: { blockId: string; toSectionId: string; toSort: number }
): Promise<
  ApiResult<{
    blockId: string;
    fromSectionId: string;
    toSectionId: string;
    toSort: number;
    updated: number;
  }>
> {
  return websiteFetch(`works/${workId}/blocks/move`, {
    method: "PUT",
    body: JSON.stringify(body)
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

export type WebsiteTagItem = {
  id: string;
  label: { ko?: string; en?: string };
};

export type SearchHit = {
  type: "work" | "insight" | "page";
  id: string;
  title: { ko?: string; en?: string } | string | null;
  slug: string;
  key_image: string | null;
  category: string | null;
  status: string;
  year?: string | null;
  published_at?: string | null;
};

export function getTags(): Promise<ApiResult<{ items: WebsiteTagItem[] }>> {
  return websiteFetch<{ items: WebsiteTagItem[] }>("tags");
}

export function createTag(
  id: string,
  label: { ko: string; en: string }
): Promise<ApiResult<WebsiteTagItem>> {
  return websiteFetch<WebsiteTagItem>("tags", {
    method: "POST",
    body: JSON.stringify({ id, label })
  });
}

export function setWorkTags(
  workId: string,
  tagIds: string[]
): Promise<ApiResult<{ items: unknown[] }>> {
  return websiteFetch(`works/${workId}/tags`, {
    method: "PUT",
    body: JSON.stringify({ tagIds })
  });
}

/** 첫 번째가 대표입니다. 홈페이지 쪽에서 works.category_id 도 함께 맞춥니다 */
export function setWorkCategories(
  workId: string,
  categoryIds: string[]
): Promise<ApiResult<{ items: unknown[] }>> {
  return websiteFetch(`works/${workId}/categories`, {
    method: "PUT",
    body: JSON.stringify({ categoryIds })
  });
}

export function addCredit(workId: string, body: unknown): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`works/${workId}/credits`, { method: "POST", body: JSON.stringify(body) });
}

export function updateCredit(
  workId: string,
  creditId: string,
  body: unknown
): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`works/${workId}/credits/${creditId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function deleteCredit(workId: string, creditId: string): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`works/${workId}/credits/${creditId}`, { method: "DELETE" });
}

export function reorderCredits(workId: string, order: OrderItem[]): Promise<ApiResult<{ updated: number }>> {
  return websiteFetch(`works/${workId}/credits`, {
    method: "PUT",
    body: JSON.stringify({ order })
  });
}

export type CreditWriteItem = {
  id?: string;
  role: string;
  name: { ko: string; en: string };
  sort: number;
};

/** 크레딧 전체를 한 번에 맞춘다 */
export function replaceCredits(
  workId: string,
  items: CreditWriteItem[]
): Promise<ApiResult<{ items: unknown[]; updated: number }>> {
  return websiteFetch(`works/${workId}/credits`, {
    method: "PUT",
    body: JSON.stringify({ items })
  });
}

export function addMetric(workId: string, body: unknown): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`works/${workId}/metrics`, { method: "POST", body: JSON.stringify(body) });
}

export function updateMetric(
  workId: string,
  metricId: string,
  body: unknown
): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`works/${workId}/metrics/${metricId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function deleteMetric(workId: string, metricId: string): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`works/${workId}/metrics/${metricId}`, { method: "DELETE" });
}

export function reorderMetrics(workId: string, order: OrderItem[]): Promise<ApiResult<{ updated: number }>> {
  return websiteFetch(`works/${workId}/metrics`, {
    method: "PUT",
    body: JSON.stringify({ order })
  });
}

export function addFolder(workId: string, body: unknown): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`works/${workId}/folders`, { method: "POST", body: JSON.stringify(body) });
}

export function updateFolder(
  workId: string,
  folderId: string,
  body: unknown
): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`works/${workId}/folders/${folderId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function deleteFolder(workId: string, folderId: string): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`works/${workId}/folders/${folderId}`, { method: "DELETE" });
}

export function reorderFolders(workId: string, order: OrderItem[]): Promise<ApiResult<{ updated: number }>> {
  return websiteFetch(`works/${workId}/folders`, {
    method: "PUT",
    body: JSON.stringify({ order })
  });
}

export function addFaq(body: unknown): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch("faqs", { method: "POST", body: JSON.stringify(body) });
}

export function updateFaq(faqId: string, body: unknown): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`faqs/${faqId}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteFaq(faqId: string): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`faqs/${faqId}`, { method: "DELETE" });
}

export function reorderFaqs(workId: string, order: OrderItem[]): Promise<ApiResult<{ updated: number }>> {
  return websiteFetch(`faqs${queryString({ work_id: workId })}`, {
    method: "PUT",
    body: JSON.stringify({ order })
  });
}

export function addRelated(workId: string, body: unknown): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`works/${workId}/related`, { method: "POST", body: JSON.stringify(body) });
}

export function deleteRelated(workId: string, relatedId: string): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`works/${workId}/related/${relatedId}`, { method: "DELETE" });
}

export function reorderRelated(workId: string, order: OrderItem[]): Promise<ApiResult<{ updated: number }>> {
  return websiteFetch(`works/${workId}/related`, {
    method: "PUT",
    body: JSON.stringify({ order })
  });
}

export function searchContent(
  q: string,
  type: "work" | "insight" | "page",
  limit = 20,
  opts?: { published?: boolean }
): Promise<ApiResult<SearchHit[]>> {
  return websiteFetch<SearchHit[]>(
    `search${queryString({
      q: q || undefined,
      type,
      limit,
      published: opts?.published ? "1" : undefined
    })}`
  );
}

/** skfb.ly 등 짧은 임베드 주소를 실제 주소로 펼친다 */
export function resolveEmbedUrl(url: string): Promise<ApiResult<{ url: string }>> {
  return websiteFetch<{ url: string }>(
    `embed/resolve${queryString({ url: url.trim() || undefined })}`
  );
}

export type RelatedRecommendPick = SearchHit & {
  type: "work" | "insight";
};

export type RelatedRecommendResult = {
  picks: RelatedRecommendPick[];
  reason: string;
};

export async function recommendRelated(
  workId: string,
  opts?: { insightId?: string }
): Promise<ApiResult<RelatedRecommendResult>> {
  const token = await accessToken();
  if (!token) {
    return { ok: false, error: "unauthorized", status: 401 };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  try {
    const res = await fetch("/api/website/luna/related-recommend", {
      method: "POST",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(opts?.insightId ? { insightId: opts.insightId } : { workId }),
      signal: controller.signal
    });
    const body = (await res.json().catch(() => null)) as {
      data?: RelatedRecommendResult;
      error?: string;
    } | null;
    const picks = body?.data?.picks;
    if (!res.ok || !Array.isArray(picks) || picks.length !== 4 || !body?.data?.reason) {
      return {
        ok: false,
        error: body?.error ?? "luna_failed",
        status: res.status
      };
    }
    return { ok: true, data: body.data, status: res.status };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export function setInterview(workId: string, body: unknown): Promise<ApiResult<Record<string, unknown>>> {
  return websiteFetch(`works/${workId}/interview`, { method: "PUT", body: JSON.stringify(body) });
}

export function clearInterview(workId: string): Promise<ApiResult<{ work_id: string }>> {
  return websiteFetch(`works/${workId}/interview`, { method: "DELETE" });
}

export function listJobs(): Promise<ApiResult<{ items: JobPosting[] }>> {
  return websiteFetch<{ items: JobPosting[] }>("jobs");
}

export function createJob(body: unknown): Promise<ApiResult<JobPosting>> {
  return websiteFetch<JobPosting>("jobs", { method: "POST", body: JSON.stringify(body) });
}

export function updateJob(id: string, body: unknown): Promise<ApiResult<JobPosting>> {
  return websiteFetch<JobPosting>(`jobs/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteJob(id: string): Promise<ApiResult<{ id: string }>> {
  return websiteFetch(`jobs/${id}`, { method: "DELETE" });
}

export function reorderJobs(order: { id: string; sort: number }[]): Promise<ApiResult<{ updated: number }>> {
  return websiteFetch("jobs/order", { method: "PATCH", body: JSON.stringify({ order }) });
}

export function getJobTargets(id: string): Promise<ApiResult<{ count: number }>> {
  return websiteFetch<{ count: number }>(`jobs/${id}/targets`);
}

export function getTalentTargetsByRole(role: string): Promise<ApiResult<{ count: number }>> {
  return websiteFetch<{ count: number }>(`talent-pool/targets${queryString({ role })}`);
}

export function listTalentPool(params?: {
  q?: string;
  role?: string;
  filter?: "active" | "all" | "expired";
}): Promise<ApiResult<TalentPoolList>> {
  return websiteFetch<TalentPoolList>(`talent-pool${queryString(params)}`);
}

export function listInquiries(params?: {
  q?: string;
  filter?: InquiryFilter;
}): Promise<ApiResult<InquiryList>> {
  return websiteFetch<InquiryList>(`inquiries${queryString(params)}`);
}

export function getInquiry(id: string): Promise<ApiResult<InquiryItem>> {
  return websiteFetch<InquiryItem>(`inquiries/${id}`);
}

export function updateInquiry(
  id: string,
  body: { is_read?: boolean; replied_at?: string | null | true; memo?: string | null }
): Promise<ApiResult<InquiryItem>> {
  return websiteFetch<InquiryItem>(`inquiries/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function listNewsletter(params?: { q?: string }): Promise<ApiResult<NewsletterList>> {
  return websiteFetch<NewsletterList>(`newsletter${queryString(params)}`);
}

export function deleteNewsletter(id: string): Promise<ApiResult<{ id: string }>> {
  return websiteFetch<{ id: string }>(`newsletter/${id}`, { method: "DELETE" });
}

export function listHome(): Promise<ApiResult<HomeList>> {
  return websiteFetch<HomeList>("home");
}

export type HomeSlotWrite = {
  layout?: "wide" | "grid";
  sort?: number;
  target_type?: "work" | "insight" | "page" | "custom";
  work_id?: string;
  insight_id?: string;
  page_key?: string;
  custom_title?: string;
  custom_subtitle?: string;
  custom_image?: string;
  custom_video?: string | null;
  custom_href?: string;
};

export function addHomeSlot(body: HomeSlotWrite): Promise<ApiResult<HomeSlot>> {
  return websiteFetch<HomeSlot>("home", { method: "POST", body: JSON.stringify(body) });
}

export function updateHomeSlot(id: string, body: HomeSlotWrite): Promise<ApiResult<HomeSlot>> {
  return websiteFetch<HomeSlot>(`home/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteHomeSlot(id: string): Promise<ApiResult<{ id: string }>> {
  return websiteFetch<{ id: string }>(`home/${id}`, { method: "DELETE" });
}

export function reorderHome(order: { id: string; sort: number }[]): Promise<ApiResult<{ updated: number }>> {
  return websiteFetch("home/order", { method: "PATCH", body: JSON.stringify({ order }) });
}

export function listHomeCandidates(): Promise<ApiResult<HomeCandidateList>> {
  return websiteFetch<HomeCandidateList>("home/candidates");
}

export function saveHomeFeed(items: HomeWrite[]): Promise<ApiResult<HomeList>> {
  return websiteFetch<HomeList>("home/save", {
    method: "POST",
    body: JSON.stringify({ items })
  });
}

export function publishHomeFeed(items: HomeWrite[]): Promise<ApiResult<HomeList>> {
  return websiteFetch<HomeList>("home/publish", {
    method: "POST",
    body: JSON.stringify({ items })
  });
}

export function getStats(params: {
  from: string;
  to: string;
  kind?: string;
}): Promise<ApiResult<StatsQueryResult>> {
  return websiteFetch<StatsQueryResult>(`stats${queryString(params)}`);
}

/** kind 여러 개를 한 번에 읽는다. 응답은 kind 를 열쇠로 한 묶음이다 */
export function getStatsBundle(params: {
  from: string;
  to: string;
  kinds: string[];
  signal?: AbortSignal;
}): Promise<ApiResult<StatsBundle>> {
  const { from, to, kinds, signal } = params;
  return websiteFetch<StatsBundle>(`stats${queryString({ from, to, kinds: kinds.join(",") })}`, {
    signal
  });
}

/** GA4 Realtime — 지금 접속자. DB 를 거치지 않는다 */
export function getStatsRealtime(signal?: AbortSignal): Promise<ApiResult<StatsRealtime>> {
  return websiteFetch<StatsRealtime>("stats/realtime", { signal });
}

export type StatsBriefTodo = {
  level: "high" | "mid" | "low";
  title: string;
  reason: string;
};

export type StatsBriefResult = {
  summary: string;
  todos: StatsBriefTodo[];
};

/** 요약 화면 루나 총평·할 일. Hub 가 Anthropic 을 부른다 (proxy 아님) */
export async function postStatsBrief(
  facts: unknown,
  signal?: AbortSignal
): Promise<ApiResult<StatsBriefResult>> {
  const token = await accessToken();
  if (!token) {
    return { ok: false, error: "unauthorized", status: 401 };
  }

  const controller = new AbortController();
  const onIncomingAbort = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), 90_000);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onIncomingAbort, { once: true });
  }

  try {
    const res = await fetch("/api/website/luna/stats-brief", {
      method: "POST",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ facts }),
      signal: controller.signal
    });
    const body = (await res.json().catch(() => null)) as {
      data?: StatsBriefResult;
      error?: string;
    } | null;
    if (!res.ok || !body?.data?.summary) {
      return {
        ok: false,
        error: body?.error ?? "luna_failed",
        status: res.status
      };
    }
    return { ok: true, data: body.data, status: res.status };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onIncomingAbort);
  }
}

export type PublishPreviewData = {
  changedFields: string[];
  firstPublish: boolean;
};

export type PublishData = {
  version: number;
  publishedAt: string;
  changedFields: string[];
  checkProblems?: string[];
};

export function publishWorkPreview(workId: string): Promise<ApiResult<PublishPreviewData>> {
  return websiteFetch<PublishPreviewData>("publish/preview", {
    method: "POST",
    body: JSON.stringify({ contentType: "work", contentId: workId })
  });
}

export function publishWork(workId: string, changeNote: string): Promise<ApiResult<PublishData>> {
  return websiteFetch<PublishData>("publish", {
    method: "POST",
    body: JSON.stringify({ contentType: "work", contentId: workId, changeNote })
  });
}

export function publishInsightPreview(insightId: string): Promise<ApiResult<PublishPreviewData>> {
  return websiteFetch<PublishPreviewData>("publish/preview", {
    method: "POST",
    body: JSON.stringify({ contentType: "insight", contentId: insightId })
  });
}

export function publishInsight(
  insightId: string,
  changeNote: string
): Promise<ApiResult<PublishData>> {
  return websiteFetch<PublishData>("publish", {
    method: "POST",
    body: JSON.stringify({ contentType: "insight", contentId: insightId, changeNote })
  });
}

export type PublishHistoryItem = {
  version: number;
  published_at: string;
  published_by: string | null;
  published_by_name: string | null;
  change_note: string | null;
  is_current: boolean;
};

export function getPublishHistory(
  contentType: "work" | "insight",
  contentId: string
): Promise<ApiResult<{ items: PublishHistoryItem[] }>> {
  return websiteFetch<{ items: PublishHistoryItem[] }>(
    `publish/history${queryString({ contentType, contentId })}`
  );
}

export function hideWork(workId: string): Promise<ApiResult<{ version: number; isHidden: boolean }>> {
  return websiteFetch<{ version: number; isHidden: boolean }>("hide", {
    method: "POST",
    body: JSON.stringify({ contentType: "work", contentId: workId })
  });
}

export function unhideWork(workId: string): Promise<ApiResult<{ version: number; isHidden: boolean }>> {
  return websiteFetch<{ version: number; isHidden: boolean }>("unhide", {
    method: "POST",
    body: JSON.stringify({ contentType: "work", contentId: workId })
  });
}

export function hideInsight(
  insightId: string
): Promise<ApiResult<{ version: number; isHidden: boolean }>> {
  return websiteFetch<{ version: number; isHidden: boolean }>("hide", {
    method: "POST",
    body: JSON.stringify({ contentType: "insight", contentId: insightId })
  });
}

export function unhideInsight(
  insightId: string
): Promise<ApiResult<{ version: number; isHidden: boolean }>> {
  return websiteFetch<{ version: number; isHidden: boolean }>("unhide", {
    method: "POST",
    body: JSON.stringify({ contentType: "insight", contentId: insightId })
  });
}

export async function generatePublishNote(
  changedFields: string[]
): Promise<{ note: string; source: string }> {
  const token = await accessToken();
  if (!token) {
    return { note: "", source: "fallback" };
  }

  const res = await fetch("/api/website/luna/publish-note", {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ changedFields })
  });

  const body = (await res.json().catch(() => null)) as {
    data?: { note?: string; source?: string };
  } | null;

  return {
    note: body?.data?.note?.trim() ?? "",
    source: body?.data?.source ?? "fallback"
  };
}

export async function generateInsightSlug(title: {
  ko: string;
  en: string;
}): Promise<{ ok: true; slug: string } | { ok: false; reason: string }> {
  const token = await accessToken();
  if (!token) {
    return { ok: false, reason: "로그인이 필요합니다" };
  }

  const res = await fetch("/api/website/luna/insight-slug", {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ title })
  });

  const body = (await res.json().catch(() => null)) as {
    data?: { slug?: string };
    reason?: string;
    error?: string;
  } | null;

  const slug = body?.data?.slug?.trim() ?? "";
  if (res.ok && slug) {
    return { ok: true, slug };
  }

  return {
    ok: false,
    reason: body?.reason?.trim() || body?.error?.trim() || "주소를 만들지 못했습니다"
  };
}

export type PageSchemaType = "Organization" | "WebPage" | "none";

export type PageMetaRow = {
  key: string;
  title: { ko: string; en: string };
  summary: { ko: string; en: string } | null;
  search_description: { ko: string; en: string } | null;
  ai_summary: { ko: string; en: string } | null;
  schema_type: PageSchemaType;
  og_image: string | null;
  og_image_width: number | null;
  og_image_height: number | null;
  updated_at: string;
};

export function listPageMeta(): Promise<ApiResult<{ items: PageMetaRow[] }>> {
  return websiteFetch<{ items: PageMetaRow[] }>("page-meta");
}

export function updatePageMeta(
  key: string,
  body: Record<string, unknown>
): Promise<ApiResult<PageMetaRow>> {
  return websiteFetch<PageMetaRow>(`page-meta/${key}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export async function generatePageMetaDraft(
  key: string
): Promise<
  { ok: true; data: { ko: string; en: string } } | { ok: false; reason: string }
> {
  const token = await accessToken();
  if (!token) {
    return { ok: false, reason: "로그인이 필요합니다" };
  }

  const res = await fetch("/api/website/luna/page-meta-draft", {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ key })
  });

  const body = (await res.json().catch(() => null)) as {
    data?: { ko?: string; en?: string };
    reason?: string;
    error?: string;
  } | null;

  const ko = body?.data?.ko?.trim() ?? "";
  const en = body?.data?.en?.trim() ?? "";
  if (ko || en) {
    return { ok: true, data: { ko, en } };
  }

  return {
    ok: false,
    reason: body?.reason?.trim() || body?.error?.trim() || "초안을 만들지 못했습니다"
  };
}
