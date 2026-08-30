import { supabase } from "@/lib/supabase/client";
import type { JobPosting, TalentPoolList } from "@/lib/website/career";
import type {
  InquiryFilter,
  InquiryItem,
  InquiryList,
  NewsletterList
} from "@/lib/website/contact";
import type { HomeCandidateList, HomeList, HomeSlot } from "@/lib/website/home";
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
  } catch {
    return { ok: false, error: "network_error", status: 0 };
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
  workId: string;
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
  limit = 20
): Promise<ApiResult<SearchHit[]>> {
  return websiteFetch<SearchHit[]>(`search${queryString({ q: q || undefined, type, limit })}`);
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
