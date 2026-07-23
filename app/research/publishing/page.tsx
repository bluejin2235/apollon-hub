"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { SupplyToast } from "@/components/supplies/toast";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import {
  DEFAULT_PUBLISHING_SCHEDULE,
  formatPublishingPartLabel,
  formatPublishingScheduleSummary,
  normalizeScheduleRow,
  PUBLISHING_HOUR_OPTIONS,
  PUBLISHING_MINUTE_OPTIONS,
  PUBLISHING_PART_OPTIONS,
  PUBLISHING_PERIOD_OPTIONS,
  PUBLISHING_WEEKDAY_OPTIONS,
  publishingPeriodToDays,
  type PublishingPart,
  type PublishingPeriod,
  type PublishingSchedule,
  type PublishingScheduleRow,
  type PublishingWeekday
} from "@/lib/research/publishing";
import { useResearchManager } from "@/lib/services/use-service-permissions";
import { supabase } from "@/lib/supabase/client";

type PageTab = "publishing" | "editor";

const EDITOR_BATCH_PAGE_SIZE = 10;

type EditorCandidateRow = {
  batch_id: string;
  batch_label: string | null;
  published_at: string | null;
  is_selected: boolean | null;
  is_sent: boolean | null;
};

type EditorBatchSummary = {
  batch_id: string;
  batch_label: string;
  published_at: string | null;
  candidateCount: number;
  selectedCount: number;
  isSent: boolean;
};

type EditorCandidateArticle = {
  id: string;
  batch_id: string;
  batch_label: string | null;
  source_name: string | null;
  source_type: string | null;
  title: string | null;
  reasons: string | null;
  url: string | null;
  image_url: string | null;
  images: string[] | null;
  selected_image_url: string | null;
  editor_uploaded_images: string[] | null;
  hidden_images: string[] | null;
  video_urls: string[] | null;
  editor_insight: string | null;
  summary: string | null;
  keywords: string[] | null;
  is_selected: boolean | null;
  created_at: string;
};

type EditorSentArticleAnalysis = {
  id: string;
  title: string | null;
  url: string | null;
  image_url: string | null;
  images: unknown;
  reasons: string | null;
  source_name: string | null;
  published_date: string | null;
  tavily_raw: unknown;
  claude_raw: string | null;
  summary: string | null;
  insight: string | null;
  verified_sources: unknown;
  keywords: string[] | null;
  p5_prompt_snapshot: string | null;
};

const ANALYSIS_SELECT_FIELDS =
  "id, title, url, image_url, images, reasons, source_name, published_date, tavily_raw, claude_raw, summary, insight, verified_sources, keywords, p5_prompt_snapshot";

const ANALYSIS_URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;

const analysisLinkClassName =
  "text-[#534AB7] underline underline-offset-2 hover:text-[#3f3799]";

function splitAnalysisUrlSuffix(url: string): { href: string; suffix: string } {
  let href = url;
  let suffix = "";

  while (href.length > 0 && /[.,;:!?)}\]"']$/.test(href)) {
    const last = href.slice(-1);
    if (last === ")" && (href.match(/\(/g)?.length ?? 0) < (href.match(/\)/g)?.length ?? 0)) {
      break;
    }
    suffix = last + suffix;
    href = href.slice(0, -1);
  }

  return { href, suffix };
}

function linkifyAnalysisText(text: string): ReactNode {
  const parts = text.split(ANALYSIS_URL_REGEX);
  if (parts.length === 1) return text;

  return parts.map((part, index) => {
    if (index % 2 === 0) {
      return part.length > 0 ? <span key={`text-${index}`}>{part}</span> : null;
    }

    const { href, suffix } = splitAnalysisUrlSuffix(part);
    if (!/^https?:\/\//i.test(href)) {
      return <span key={`raw-${index}`}>{part}</span>;
    }

    return (
      <span key={`link-${index}`}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={analysisLinkClassName}
        >
          {href}
        </a>
        {suffix}
      </span>
    );
  });
}

function formatAnalysisFieldValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function formatSupabaseAnalysisCell(article: EditorSentArticleAnalysis): string {
  return [
    `title: ${formatAnalysisFieldValue(article.title)}`,
    `url: ${formatAnalysisFieldValue(article.url)}`,
    `image_url: ${formatAnalysisFieldValue(article.image_url)}`,
    `images: ${formatAnalysisFieldValue(article.images)}`,
    `reasons: ${formatAnalysisFieldValue(article.reasons)}`,
    `source_name: ${formatAnalysisFieldValue(article.source_name)}`,
    `published_date: ${formatAnalysisFieldValue(article.published_date)}`
  ].join("\n");
}

function formatTavilyAnalysisCell(raw: unknown): string {
  if (raw == null) return "—";

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }

  const results = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { results?: unknown }).results)
      ? (parsed as { results: unknown[] }).results
      : null;

  if (!results || results.length === 0) {
    return formatAnalysisFieldValue(parsed);
  }

  return results
    .map((item, index) => {
      const row = item as Record<string, unknown>;
      const title = row.title != null ? String(row.title) : "—";
      const url = row.url != null ? String(row.url) : "—";
      const content = row.content != null ? String(row.content) : "—";
      return `[${index + 1}] ${title}\nURL: ${url}\n${content}`;
    })
    .join("\n\n---\n\n");
}

function formatClaudeAnalysisCell(article: EditorSentArticleAnalysis): string {
  if (article.claude_raw?.trim()) {
    return article.claude_raw.trim();
  }

  const parts: string[] = [];
  if (article.summary?.trim()) parts.push(`summary:\n${article.summary.trim()}`);
  if (article.insight?.trim()) parts.push(`insight:\n${article.insight.trim()}`);
  if (article.verified_sources != null) {
    parts.push(`verified_sources:\n${formatAnalysisFieldValue(article.verified_sources)}`);
  }
  if (article.keywords?.length) {
    parts.push(`keywords:\n${formatKeywordTags(article.keywords)}`);
  }

  return parts.length > 0 ? parts.join("\n\n") : "—";
}

function AnalysisTableCell({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-[rgba(0,0,0,0.08)] bg-[#fafafa] p-3">
      <div className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-[#676767]">
        {linkifyAnalysisText(children)}
      </div>
    </div>
  );
}

function EditorAnalysisDataModal({
  open,
  batchLabel,
  articles,
  loading,
  onClose
}: {
  open: boolean;
  batchLabel: string;
  articles: EditorSentArticleAnalysis[];
  loading: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [p5PromptExpanded, setP5PromptExpanded] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) setP5PromptExpanded(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || loading) return;
    console.log(articles.map((a) => ({ title: a.title, has_p5: !!a.p5_prompt_snapshot })));
  }, [open, loading, articles]);

  const p5PromptSnapshot = articles[0]?.p5_prompt_snapshot?.trim() ?? "";

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-[2.5vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="editor-analysis-modal-title"
      onClick={onClose}
    >
      <div
        className="flex h-[95vh] w-[95vw] flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[rgba(0,0,0,0.08)] px-5 py-4">
          <div>
            <h2 id="editor-analysis-modal-title" className="text-base font-semibold text-[#0d0d0d]">
              분석데이터
            </h2>
            <p className="mt-1 text-sm text-[#676767]">{batchLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-[#676767] transition hover:bg-[#f4f4f4] hover:text-[#0d0d0d]"
          >
            닫기
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto px-5 py-4">
          {loading ? (
            <p className="py-10 text-center text-sm text-[#8e8e8e]">불러오는 중…</p>
          ) : articles.length === 0 ? (
            <p className="py-10 text-center text-sm text-[#8e8e8e]">발송된 아티클이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <section className="mb-4 min-w-[1160px]">
                <button
                  type="button"
                  onClick={() => setP5PromptExpanded((prev) => !prev)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-[rgba(0,0,0,0.08)] bg-[#fafafa] px-4 py-3 text-left text-sm font-medium text-[#0d0d0d] transition hover:bg-[#f4f4f4]"
                  aria-expanded={p5PromptExpanded}
                >
                  <span>리포트 생성 시 사용된 P5 프롬프트</span>
                  <span className="shrink-0 text-xs font-normal text-[#676767]">
                    {p5PromptExpanded ? "접기 ▲" : "펼치기 ▼"}
                  </span>
                </button>
                {p5PromptExpanded ? (
                  <div className="mt-2 rounded-lg border border-[rgba(0,0,0,0.08)] bg-[#fafafa] p-4">
                    <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-[#676767]">
                      {p5PromptSnapshot || "—"}
                    </pre>
                  </div>
                ) : null}
              </section>

              <table className="w-full min-w-[1160px] table-fixed text-sm">
                <colgroup>
                  <col style={{ width: 200 }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-[rgba(0,0,0,0.08)] bg-[#fafafa] text-left text-xs font-medium text-[#676767]">
                    <th className="w-[200px] px-3 py-3 align-top">아티클</th>
                    <th className="px-3 py-3 align-top">슈파베이스 자료</th>
                    <th className="px-3 py-3 align-top">Tavily 자료</th>
                    <th className="px-3 py-3 align-top">클로드 리포트</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(0,0,0,0.06)]">
                  {articles.map((article) => (
                    <tr key={article.id} className="align-top">
                      <td className="w-[200px] max-w-[200px] px-3 py-3 align-top">
                        <p className="break-words text-sm font-semibold leading-snug text-[#0d0d0d]">
                          {article.title?.trim() || "—"}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <AnalysisTableCell>{formatSupabaseAnalysisCell(article)}</AnalysisTableCell>
                      </td>
                      <td className="px-3 py-3">
                        <AnalysisTableCell>
                          {formatTavilyAnalysisCell(article.tavily_raw)}
                        </AnalysisTableCell>
                      </td>
                      <td className="px-3 py-3">
                        <AnalysisTableCell>{formatClaudeAnalysisCell(article)}</AnalysisTableCell>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function formatKeywordTags(keywords: string[] | null | undefined): string {
  if (!keywords?.length) return "";
  return keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .map((keyword) => `#${keyword}`)
    .join("  ");
}

function parseReasonBullets(reasons: string): string[] {
  return reasons
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[•·\-]\s*/, "").trim())
    .filter(Boolean);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectArticleImageUrls(article: EditorCandidateArticle): string[] {
  const hidden = new Set(normalizeStringArray(article.hidden_images));
  const merged = [
    ...normalizeStringArray(article.images),
    ...normalizeStringArray(article.editor_uploaded_images)
  ].filter((url) => !hidden.has(url));
  return [...new Set(merged)];
}

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function EditorArticleCard({
  article,
  toggling,
  onToggleSelected,
  onArticlePatch,
  onErrorToast
}: {
  article: EditorCandidateArticle;
  toggling: boolean;
  onToggleSelected: () => void;
  onArticlePatch: (articleId: string, patch: Partial<EditorCandidateArticle>) => void;
  onErrorToast: (message: string) => void;
}) {
  const isSelected = Boolean(article.is_selected);
  const sourceLabel = [article.source_name, article.source_type]
    .filter((part) => part?.trim())
    .join(" · ");
  const reasonBullets = article.reasons?.trim() ? parseReasonBullets(article.reasons) : [];
  const imageUrls = collectArticleImageUrls(article);
  const uploadedImages = normalizeStringArray(article.editor_uploaded_images);
  const collectedImages = normalizeStringArray(article.images);
  const hiddenImages = normalizeStringArray(article.hidden_images);
  const videoUrls = normalizeStringArray(article.video_urls);
  const selectedImageUrl = article.selected_image_url?.trim() || null;
  const displayRepresentativeUrl = selectedImageUrl ?? imageUrls[0] ?? null;

  const [insightDraft, setInsightDraft] = useState(article.editor_insight ?? "");
  const [videoInput, setVideoInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingMedia, setSavingMedia] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInsightDraft(article.editor_insight ?? "");
  }, [article.id, article.editor_insight]);

  const persistMedia = async (
    patch: Partial<
      Pick<
        EditorCandidateArticle,
        | "selected_image_url"
        | "editor_uploaded_images"
        | "hidden_images"
        | "video_urls"
        | "editor_insight"
      >
    >,
    previous: Partial<EditorCandidateArticle>
  ) => {
    onArticlePatch(article.id, patch);
    setSavingMedia(true);

    try {
      const token = await getAccessToken();
      if (!token) {
        onArticlePatch(article.id, previous);
        onErrorToast("로그인 세션이 없습니다.");
        return false;
      }

      const response = await fetch("/api/research/editor/update-media", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ candidateId: article.id, ...patch })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        onArticlePatch(article.id, previous);
        onErrorToast(payload?.error || "저장에 실패했습니다.");
        return false;
      }

      return true;
    } catch {
      onArticlePatch(article.id, previous);
      onErrorToast("저장에 실패했습니다.");
      return false;
    } finally {
      setSavingMedia(false);
    }
  };

  const handleSelectImage = (url: string) => {
    if (savingMedia || selectedImageUrl === url) return;
    void persistMedia(
      { selected_image_url: url },
      { selected_image_url: article.selected_image_url }
    );
  };

  const handleRemoveImage = (url: string, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (savingMedia) return;

    const patch: Partial<
      Pick<EditorCandidateArticle, "selected_image_url" | "editor_uploaded_images" | "hidden_images">
    > = {};
    const previous: Partial<EditorCandidateArticle> = {
      selected_image_url: article.selected_image_url,
      editor_uploaded_images: article.editor_uploaded_images,
      hidden_images: article.hidden_images
    };

    if (uploadedImages.includes(url)) {
      patch.editor_uploaded_images = uploadedImages.filter((item) => item !== url);
    } else if (collectedImages.includes(url)) {
      patch.hidden_images = [...new Set([...hiddenImages, url])];
    } else {
      return;
    }

    if (selectedImageUrl === url) {
      patch.selected_image_url = null;
    }

    void persistMedia(patch, previous);
  };

  const handleUploadImage = async (file: File) => {
    if (uploading || savingMedia) return;

    setUploading(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        onErrorToast("로그인 세션이 없습니다.");
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("candidateId", article.id);

      const uploadResponse = await fetch("/api/research/editor/upload-image", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (!uploadResponse.ok) {
        const payload = (await uploadResponse.json().catch(() => null)) as { error?: string } | null;
        onErrorToast(payload?.error || "이미지 업로드에 실패했습니다.");
        return;
      }

      const payload = (await uploadResponse.json()) as { url?: string };
      const url = payload.url?.trim();
      if (!url) {
        onErrorToast("업로드 URL을 받지 못했습니다.");
        return;
      }

      const nextUploaded = [...uploadedImages, url];
      const ok = await persistMedia(
        {
          editor_uploaded_images: nextUploaded,
          selected_image_url: selectedImageUrl ?? url
        },
        {
          editor_uploaded_images: article.editor_uploaded_images,
          selected_image_url: article.selected_image_url
        }
      );

      if (!ok) return;
    } catch {
      onErrorToast("이미지 업로드에 실패했습니다.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAddVideo = () => {
    const url = videoInput.trim();
    if (!url || savingMedia) return;
    if (videoUrls.includes(url)) {
      setVideoInput("");
      return;
    }

    const nextVideos = [...videoUrls, url];
    setVideoInput("");
    void persistMedia({ video_urls: nextVideos }, { video_urls: article.video_urls });
  };

  const handleRemoveVideo = (url: string) => {
    if (savingMedia) return;
    const nextVideos = videoUrls.filter((item) => item !== url);
    void persistMedia({ video_urls: nextVideos }, { video_urls: article.video_urls });
  };

  const handleInsightBlur = () => {
    const nextInsight = insightDraft;
    const previousInsight = article.editor_insight ?? "";
    if (nextInsight === previousInsight || savingMedia) return;
    void persistMedia({ editor_insight: nextInsight }, { editor_insight: article.editor_insight });
  };

  return (
    <article
      className={`rounded-xl bg-white p-4 transition ${
        isSelected ? "border-2 border-[#534AB7]" : "border border-[rgba(0,0,0,0.08)]"
      }`}
    >
      <div className="flex gap-3">
        <input
          type="checkbox"
          checked={isSelected}
          disabled={toggling}
          onChange={onToggleSelected}
          className="mt-1 h-4 w-4 shrink-0 accent-[#534AB7]"
          aria-label={`${article.title ?? "아티클"} 선정`}
        />
        <div className="min-w-0 flex-1">
          {sourceLabel ? <p className="text-xs text-[#8e8e8e]">{sourceLabel}</p> : null}
          <h3 className="mt-1 text-base font-medium text-[#0d0d0d]">
            {article.title?.trim() || "제목 없음"}
          </h3>
          {article.url?.trim() ? (
            <a
              href={article.url.trim()}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm font-medium text-[#534AB7] hover:underline"
            >
              원본 보기 ↗
            </a>
          ) : null}
        </div>
      </div>

      <section className="mt-4">
        <h4 className="text-sm font-semibold text-[#0d0d0d]">📷 수집된 이미지</h4>
        {imageUrls.length === 0 ? (
          <p className="mt-2 text-sm text-[#8e8e8e]">수집된 이미지 없음</p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {imageUrls.map((url) => {
              const isRepresentative = displayRepresentativeUrl === url;
              return (
                <div
                  key={url}
                  className={`relative aspect-square overflow-hidden rounded-lg border-2 transition ${
                    isRepresentative
                      ? "border-[#534AB7]"
                      : "border-transparent hover:border-[rgba(83,74,183,0.35)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectImage(url)}
                    disabled={savingMedia}
                    className="absolute inset-0"
                    aria-label={isRepresentative ? "대표 이미지" : "대표 이미지로 선택"}
                  >
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </button>
                  {isRepresentative ? (
                    <span className="pointer-events-none absolute left-1.5 top-1.5 z-[1] rounded bg-[#534AB7] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      대표
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={(event) => handleRemoveImage(url, event)}
                    disabled={savingMedia}
                    className="absolute right-1.5 top-1.5 z-[1] flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-xs text-white transition hover:bg-black/75 disabled:opacity-50"
                    aria-label="이미지 삭제"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || savingMedia}
              className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-[rgba(0,0,0,0.18)] text-2xl text-[#8e8e8e] transition hover:border-[#534AB7] hover:text-[#534AB7] disabled:opacity-50"
              aria-label="이미지 업로드"
            >
              {uploading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : "+"}
            </button>
          </div>
        )}
        {imageUrls.length === 0 ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || savingMedia}
            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-dashed border-[rgba(0,0,0,0.18)] px-3 py-2 text-sm text-[#676767] transition hover:border-[#534AB7] hover:text-[#534AB7] disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            + 이미지 업로드
          </button>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleUploadImage(file);
          }}
        />
      </section>

      <section className="mt-4">
        <h4 className="text-sm font-semibold text-[#0d0d0d]">🎬 관련 영상</h4>
        {videoUrls.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {videoUrls.map((url) => (
              <span
                key={url}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#f4f4f4] px-2.5 py-1 text-xs text-[#0d0d0d]"
              >
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate text-[#534AB7] hover:underline"
                  title={url}
                >
                  {url}
                </a>
                <button
                  type="button"
                  onClick={() => handleRemoveVideo(url)}
                  disabled={savingMedia}
                  className="shrink-0 text-[#8e8e8e] hover:text-[#0d0d0d] disabled:opacity-50"
                  aria-label="영상 URL 삭제"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={videoInput}
            onChange={(event) => setVideoInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAddVideo();
              }
            }}
            placeholder="영상 URL 입력"
            className="min-w-0 flex-1 rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#534AB7] focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAddVideo}
            disabled={!videoInput.trim() || savingMedia}
            className="rounded-xl bg-[#534AB7] px-4 py-2 text-sm font-medium text-white hover:bg-[#453da0] disabled:opacity-50"
          >
            추가
          </button>
        </div>
      </section>

      <section className="mt-4">
        <h4 className="text-sm font-semibold text-[#0d0d0d]">🌙 루나가 선정한 이유</h4>
        {reasonBullets.length > 0 ? (
          <ul
            className="mt-2 list-disc space-y-2 pl-5"
            style={{
              color: "var(--text-secondary)",
              fontSize: 13,
              lineHeight: 1.65
            }}
          >
            {reasonBullets.map((reason, index) => (
              <li key={`${article.id}-reason-${index}`}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[#8e8e8e]">선정이유가 없습니다.</p>
        )}
      </section>

      <section className="mt-4">
        <h4 className="text-sm font-semibold text-[#0d0d0d]">✍️ 편집장 코멘트</h4>
        <textarea
          value={insightDraft}
          onChange={(event) => setInsightDraft(event.target.value)}
          onBlur={handleInsightBlur}
          rows={3}
          placeholder="추가로 남기고 싶은 관점을 적어보세요..."
          className="mt-2 w-full resize-y rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm leading-relaxed text-[#0d0d0d] focus:border-[#534AB7] focus:outline-none"
        />
      </section>
    </article>
  );
}

function aggregateEditorBatches(rows: EditorCandidateRow[]): EditorBatchSummary[] {
  const map = new Map<string, EditorBatchSummary>();

  for (const row of rows) {
    const prev = map.get(row.batch_id);
    if (!prev) {
      map.set(row.batch_id, {
        batch_id: row.batch_id,
        batch_label: row.batch_label?.trim() || row.batch_id,
        published_at: row.published_at,
        candidateCount: 1,
        selectedCount: row.is_selected ? 1 : 0,
        isSent: Boolean(row.is_sent)
      });
      continue;
    }

    prev.candidateCount += 1;
    if (row.is_selected) prev.selectedCount += 1;
    if (row.is_sent) prev.isSent = true;
    if (row.batch_label?.trim()) prev.batch_label = row.batch_label.trim();
    if (
      row.published_at &&
      (!prev.published_at || row.published_at > prev.published_at)
    ) {
      prev.published_at = row.published_at;
    }
  }

  return [...map.values()].sort((a, b) => {
    const aTime = a.published_at ? new Date(a.published_at).getTime() : 0;
    const bTime = b.published_at ? new Date(b.published_at).getTime() : 0;
    return bTime - aTime;
  });
}

type PeriodPickerProps = {
  period: PublishingPeriod;
  startDate: string;
  endDate: string;
  onPeriodChange: (period: PublishingPeriod) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
};

function PeriodPicker({
  period,
  startDate,
  endDate,
  onPeriodChange,
  onStartDateChange,
  onEndDateChange
}: PeriodPickerProps) {
  return (
    <div>
      <p className="text-sm font-medium text-[#0d0d0d]">수집기간</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {PUBLISHING_PERIOD_OPTIONS.map((option) => {
          const selected = period === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onPeriodChange(option.value)}
              className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                selected
                  ? "border-[#534AB7] bg-[#534AB7]/10 text-[#534AB7]"
                  : "border-[rgba(0,0,0,0.12)] text-[#676767] hover:border-[rgba(0,0,0,0.2)]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {period === "custom" ? (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block flex-1">
            <span className="text-xs font-medium text-[#676767]">시작일</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => onStartDateChange(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#534AB7] focus:outline-none"
            />
          </label>
          <span className="hidden pb-2 text-sm text-[#8e8e8e] sm:block">~</span>
          <label className="block flex-1">
            <span className="text-xs font-medium text-[#676767]">종료일</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => onEndDateChange(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#534AB7] focus:outline-none"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function PartToggle({
  value,
  onChange,
  disabled
}: {
  value: PublishingPart;
  onChange: (part: PublishingPart) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-[#0d0d0d]">파트</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {PUBLISHING_PART_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`rounded-xl border px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
                selected
                  ? option.value === "content"
                    ? "border-[#534AB7] bg-[#534AB7] text-white"
                    : "border-[#676767] bg-[#e8e8e8] text-[#676767]"
                  : "border-[rgba(0,0,0,0.12)] text-[#676767] hover:border-[rgba(0,0,0,0.2)]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ResearchPublishingPage() {
  const router = useRouter();
  const { status } = useRequirePortalSession();
  const canManage = useResearchManager();

  const [activeTab, setActiveTab] = useState<PageTab>("publishing");

  const [activeSchedules, setActiveSchedules] = useState<PublishingScheduleRow[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [schedulePart, setSchedulePart] = useState<PublishingPart>("content");
  const [schedule, setSchedule] = useState<PublishingSchedule>(DEFAULT_PUBLISHING_SCHEDULE);

  const [immediatePart, setImmediatePart] = useState<PublishingPart>("content");
  const [immediatePeriod, setImmediatePeriod] = useState<PublishingPeriod>("1week");
  const [immediateStartDate, setImmediateStartDate] = useState("");
  const [immediateEndDate, setImmediateEndDate] = useState("");
  const [triggerBusy, setTriggerBusy] = useState(false);

  const [editorBatches, setEditorBatches] = useState<EditorBatchSummary[]>([]);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorPage, setEditorPage] = useState(1);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [batchArticles, setBatchArticles] = useState<EditorCandidateArticle[]>([]);
  const [batchDetailLoading, setBatchDetailLoading] = useState(false);
  const [togglingArticleId, setTogglingArticleId] = useState<string | null>(null);
  const [sendBatchBusy, setSendBatchBusy] = useState(false);
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [analysisModalLabel, setAnalysisModalLabel] = useState("");
  const [analysisArticles, setAnalysisArticles] = useState<EditorSentArticleAnalysis[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (canManage === false) {
      router.replace("/research");
    }
  }, [canManage, router]);

  const resetScheduleForm = useCallback(() => {
    setEditingScheduleId(null);
    setSchedulePart("content");
    setSchedule({ ...DEFAULT_PUBLISHING_SCHEDULE });
  }, []);

  const loadActiveSchedules = useCallback(async () => {
    setScheduleLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("publishing_schedules")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    setScheduleLoading(false);

    if (fetchError) {
      setError(fetchError.message);
      setActiveSchedules([]);
      return;
    }

    const rows = (data ?? [])
      .map((row) => normalizeScheduleRow(row as Record<string, unknown>))
      .filter((row): row is PublishingScheduleRow => row !== null);
    setActiveSchedules(rows);
  }, []);

  useEffect(() => {
    if (status !== "ready" || canManage !== true) return;
    void loadActiveSchedules();
  }, [status, canManage, loadActiveSchedules]);

  const loadEditorBatches = useCallback(async () => {
    setEditorLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("trend_editor_candidates")
      .select("batch_id, batch_label, published_at, is_selected, is_sent");

    setEditorLoading(false);

    if (fetchError) {
      setError(fetchError.message);
      setEditorBatches([]);
      return;
    }

    setEditorBatches(aggregateEditorBatches((data ?? []) as EditorCandidateRow[]));
  }, []);

  useEffect(() => {
    if (status !== "ready" || canManage !== true || activeTab !== "editor") return;
    void loadEditorBatches();
  }, [status, canManage, activeTab, loadEditorBatches]);

  useEffect(() => {
    if (activeTab !== "editor") {
      setSelectedBatchId(null);
    }
  }, [activeTab]);

  const loadBatchDetail = useCallback(async (batchId: string) => {
    setBatchDetailLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("trend_editor_candidates")
      .select("*")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true });

    setBatchDetailLoading(false);

    if (fetchError) {
      setError(fetchError.message);
      setBatchArticles([]);
      return;
    }

    setBatchArticles((data ?? []) as EditorCandidateArticle[]);
  }, []);

  useEffect(() => {
    if (
      status !== "ready" ||
      canManage !== true ||
      activeTab !== "editor" ||
      !selectedBatchId
    ) {
      return;
    }
    void loadBatchDetail(selectedBatchId);
  }, [status, canManage, activeTab, selectedBatchId, loadBatchDetail]);

  const selectedBatchSummary = useMemo(
    () => editorBatches.find((batch) => batch.batch_id === selectedBatchId) ?? null,
    [editorBatches, selectedBatchId]
  );

  const batchDetailLabel = useMemo(() => {
    if (selectedBatchSummary?.batch_label) return selectedBatchSummary.batch_label;
    const fromArticle = batchArticles[0]?.batch_label?.trim();
    return fromArticle || selectedBatchId || "";
  }, [selectedBatchSummary, batchArticles, selectedBatchId]);

  const batchSelectedCount = useMemo(
    () => batchArticles.filter((article) => article.is_selected).length,
    [batchArticles]
  );

  const handleBackToBatchList = () => {
    setSelectedBatchId(null);
    setBatchArticles([]);
    void loadEditorBatches();
  };

  const handleToggleArticleSelected = async (article: EditorCandidateArticle) => {
    if (togglingArticleId || !selectedBatchId) return;

    const previousSelected = Boolean(article.is_selected);
    const nextSelected = !previousSelected;

    setTogglingArticleId(article.id);
    setBatchArticles((prev) =>
      prev.map((item) =>
        item.id === article.id ? { ...item, is_selected: nextSelected } : item
      )
    );
    setEditorBatches((prev) =>
      prev.map((batch) => {
        if (batch.batch_id !== selectedBatchId) return batch;
        return {
          ...batch,
          selectedCount: Math.max(0, batch.selectedCount + (nextSelected ? 1 : -1))
        };
      })
    );

    const { error: updateError } = await supabase
      .from("trend_editor_candidates")
      .update({ is_selected: nextSelected })
      .eq("id", article.id);

    setTogglingArticleId(null);

    if (updateError) {
      setBatchArticles((prev) =>
        prev.map((item) =>
          item.id === article.id ? { ...item, is_selected: previousSelected } : item
        )
      );
      setEditorBatches((prev) =>
        prev.map((batch) => {
          if (batch.batch_id !== selectedBatchId) return batch;
          return {
            ...batch,
            selectedCount: Math.max(0, batch.selectedCount + (previousSelected ? 1 : -1))
          };
        })
      );
      setToast(updateError.message);
    }
  };

  const handleArticlePatch = useCallback((articleId: string, patch: Partial<EditorCandidateArticle>) => {
    setBatchArticles((prev) =>
      prev.map((item) => (item.id === articleId ? { ...item, ...patch } : item))
    );
  }, []);

  const handleBulkSelectArticles = async (nextSelected: boolean) => {
    if (togglingArticleId || !selectedBatchId || batchArticles.length === 0) return;

    const targets = batchArticles.filter((article) => Boolean(article.is_selected) !== nextSelected);
    if (targets.length === 0) return;

    const previousArticles = batchArticles;
    const previousBatches = editorBatches;
    const targetIds = targets.map((article) => article.id);

    setTogglingArticleId("__bulk__");
    setBatchArticles((prev) =>
      prev.map((item) =>
        targetIds.includes(item.id) ? { ...item, is_selected: nextSelected } : item
      )
    );
    setEditorBatches((prev) =>
      prev.map((batch) => {
        if (batch.batch_id !== selectedBatchId) return batch;
        const nextCount = nextSelected
          ? batchArticles.length
          : Math.max(0, batch.selectedCount - targets.length);
        return {
          ...batch,
          selectedCount: nextSelected ? batchArticles.length : nextCount
        };
      })
    );

    const { error: updateError } = await supabase
      .from("trend_editor_candidates")
      .update({ is_selected: nextSelected })
      .in("id", targetIds);

    setTogglingArticleId(null);

    if (updateError) {
      setBatchArticles(previousArticles);
      setEditorBatches(previousBatches);
      setToast(updateError.message);
    }
  };

  const openAnalysisModal = async (batch: EditorBatchSummary) => {
    setAnalysisModalLabel(batch.batch_label);
    setAnalysisModalOpen(true);
    setAnalysisLoading(true);
    setAnalysisArticles([]);

    const { data, error: fetchError } = await supabase
      .from("trend_editor_candidates")
      .select(ANALYSIS_SELECT_FIELDS)
      .eq("batch_id", batch.batch_id)
      .eq("is_sent", true)
      .order("created_at", { ascending: true });

    setAnalysisLoading(false);

    if (fetchError) {
      window.alert(fetchError.message);
      setAnalysisModalOpen(false);
      return;
    }

    setAnalysisArticles((data ?? []) as EditorSentArticleAnalysis[]);
  };

  const handleSendBatchMail = async () => {
    if (sendBatchBusy || !selectedBatchId || batchSelectedCount === 0) return;

    const confirmed = window.confirm(
      `선정된 ${batchSelectedCount.toLocaleString("ko-KR")}건을 전사에 발송합니다. 계속할까요?`
    );
    if (!confirmed) return;

    setSendBatchBusy(true);
    setError(null);

    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        window.alert("발송 실패: 로그인 세션이 없습니다.");
        return;
      }

      const response = await fetch("/api/research/editor/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ batchId: selectedBatchId })
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        window.alert(`발송 실패: ${data.error ?? "알 수 없는 오류"}`);
        return;
      }

      window.alert("발송 요청이 전송되었습니다.");
      handleBackToBatchList();
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : "알 수 없는 오류";
      window.alert(`발송 실패: ${message}`);
    } finally {
      setSendBatchBusy(false);
    }
  };

  useEffect(() => {
    setEditorPage(1);
  }, [activeTab]);

  const editorTotalPages = Math.max(1, Math.ceil(editorBatches.length / EDITOR_BATCH_PAGE_SIZE));

  const paginatedEditorBatches = useMemo(() => {
    const start = (editorPage - 1) * EDITOR_BATCH_PAGE_SIZE;
    return editorBatches.slice(start, start + EDITOR_BATCH_PAGE_SIZE);
  }, [editorBatches, editorPage]);

  useEffect(() => {
    if (editorPage > editorTotalPages) {
      setEditorPage(editorTotalPages);
    }
  }, [editorPage, editorTotalPages]);

  const handleEditSchedule = (row: PublishingScheduleRow) => {
    setEditingScheduleId(row.id);
    setSchedulePart(row.part);
    setSchedule({
      day: row.day,
      hour: row.hour,
      minute: row.minute,
      period: row.period,
      start_date: row.start_date ?? "",
      end_date: row.end_date ?? ""
    });
  };

  const handleDeleteSchedule = async (row: PublishingScheduleRow) => {
    const confirmed = window.confirm("이 예약 스케줄을 삭제할까요?");
    if (!confirmed) return;

    const { error: deleteError } = await supabase
      .from("publishing_schedules")
      .update({ is_active: false })
      .eq("id", row.id);

    if (deleteError) {
      setError(deleteError.message);
      setToast("삭제에 실패했습니다.");
      return;
    }

    if (editingScheduleId === row.id) {
      resetScheduleForm();
    }

    setToast("예약 스케줄이 삭제되었습니다.");
    void loadActiveSchedules();
  };

  const handleSaveSchedule = async () => {
    if (scheduleSaving) return;

    if (schedule.period === "custom" && (!schedule.start_date || !schedule.end_date)) {
      setError("기간설정 시 시작일과 종료일을 입력해주세요.");
      return;
    }

    setScheduleSaving(true);
    setError(null);

    const wasEditing = Boolean(editingScheduleId);
    const payload = {
      part: schedulePart,
      period: schedule.period,
      start_date: schedule.period === "custom" ? schedule.start_date ?? null : null,
      end_date: schedule.period === "custom" ? schedule.end_date ?? null : null,
      day: schedule.day,
      hour: schedule.hour,
      minute: schedule.minute,
      is_active: true
    };

    const { error: saveError } = editingScheduleId
      ? await supabase.from("publishing_schedules").update(payload).eq("id", editingScheduleId)
      : await supabase.from("publishing_schedules").insert(payload);

    setScheduleSaving(false);

    if (saveError) {
      setError(saveError.message);
      setToast("저장에 실패했습니다.");
      return;
    }

    resetScheduleForm();
    setToast(wasEditing ? "예약 설정이 수정되었습니다." : "예약 설정이 저장되었습니다.");
    void loadActiveSchedules();
  };

  const handleTriggerNow = async () => {
    if (triggerBusy) return;

    if (immediatePeriod === "custom" && (!immediateStartDate || !immediateEndDate)) {
      setError("기간설정 시 시작일과 종료일을 입력해주세요.");
      return;
    }

    const days = publishingPeriodToDays(immediatePeriod, immediateStartDate, immediateEndDate);
    if (days === null) {
      setError("유효하지 않은 수집기간입니다.");
      return;
    }

    setTriggerBusy(true);
    setError(null);

    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        setError("로그인 세션이 없습니다.");
        return;
      }

      const response = await fetch("/api/research/publishing/trigger", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ days, part: immediatePart })
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Publishing 실행에 실패했습니다.");
        setToast("Publishing 실행에 실패했습니다.");
        return;
      }

      setToast("Publishing이 실행되었습니다.");
    } catch (triggerError) {
      const message =
        triggerError instanceof Error ? triggerError.message : "Publishing 실행에 실패했습니다.";
      setError(message);
      setToast("Publishing 실행에 실패했습니다.");
    } finally {
      setTriggerBusy(false);
    }
  };

  if (status === "checking" || canManage === null) {
    return <PortalAuthChecking />;
  }

  if (canManage === false) {
    return <PortalAuthChecking />;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <h1 className="text-xl font-semibold text-[#0d0d0d]">Publishing</h1>
        <p className="mt-1 text-sm text-[#676767]">
          {activeTab === "publishing"
            ? "트렌드 레이더 위클리 Publishing을 예약하거나 즉시 실행합니다."
            : "발행 회차별로 루나 편집장이 선별한 아티클을 검토하고 발송합니다."}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("publishing")}
            className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
              activeTab === "publishing"
                ? "border-[#534AB7] bg-[#534AB7]/10 text-[#534AB7]"
                : "border-[rgba(0,0,0,0.12)] text-[#676767] hover:border-[rgba(0,0,0,0.2)]"
            }`}
          >
            Publishing
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("editor")}
            className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
              activeTab === "editor"
                ? "border-[#534AB7] bg-[#534AB7]/10 text-[#534AB7]"
                : "border-[rgba(0,0,0,0.12)] text-[#676767] hover:border-[rgba(0,0,0,0.2)]"
            }`}
          >
            루나편집장
          </button>
        </div>

        {activeTab === "publishing" ? (
          <div className="mt-6 flex flex-col gap-5">
            <section id="schedule" className="scroll-mt-24 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5">
              <h2 className="text-base font-semibold text-[#534AB7]">예약 발송</h2>
              <p className="mt-1 text-sm text-[#676767]">파트별 자동 실행 스케줄을 등록하고 관리합니다.</p>

              <div className="mt-5 space-y-3">
                {scheduleLoading ? (
                  <p className="text-sm text-[#8e8e8e]">스케줄을 불러오는 중…</p>
                ) : activeSchedules.length === 0 ? (
                  <p className="rounded-xl bg-[#fafafa] px-4 py-3 text-sm text-[#8e8e8e]">
                    등록된 예약 스케줄이 없습니다.
                  </p>
                ) : (
                  activeSchedules.map((row) => (
                    <div
                      key={row.id}
                      className="flex flex-col gap-3 rounded-xl border border-[rgba(0,0,0,0.08)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex rounded-lg px-2.5 py-0.5 text-xs font-semibold ${
                            row.part === "content"
                              ? "bg-[#534AB7] text-white"
                              : "bg-[#e8e8e8] text-[#676767]"
                          }`}
                        >
                          {formatPublishingPartLabel(row.part)}
                        </span>
                        <p className="text-sm text-[#0d0d0d]">
                          {formatPublishingScheduleSummary({
                            day: row.day,
                            hour: row.hour,
                            minute: row.minute,
                            period: row.period,
                            start_date: row.start_date ?? undefined,
                            end_date: row.end_date ?? undefined
                          })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditSchedule(row)}
                          disabled={scheduleSaving}
                          className="rounded-lg border border-[rgba(0,0,0,0.14)] px-2.5 py-1 text-xs font-medium text-[#676767] transition hover:border-[#534AB7] hover:text-[#534AB7] disabled:opacity-50"
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteSchedule(row)}
                          disabled={scheduleSaving}
                          className="rounded-lg border border-[rgba(0,0,0,0.14)] px-2.5 py-1 text-xs font-medium text-[#676767] transition hover:border-red-500 hover:text-red-600 disabled:opacity-50"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-6 border-t border-[rgba(0,0,0,0.06)] pt-5">
                <p className="text-sm font-medium text-[#0d0d0d]">
                  {editingScheduleId ? "스케줄 수정" : "스케줄 추가"}
                </p>

                <div className="mt-4">
                  <PartToggle
                    value={schedulePart}
                    onChange={setSchedulePart}
                    disabled={scheduleLoading || scheduleSaving}
                  />
                </div>

                <div className="mt-5">
                  <PeriodPicker
                    period={schedule.period}
                    startDate={schedule.start_date ?? ""}
                    endDate={schedule.end_date ?? ""}
                    onPeriodChange={(period) => setSchedule((prev) => ({ ...prev, period }))}
                    onStartDateChange={(start_date) => setSchedule((prev) => ({ ...prev, start_date }))}
                    onEndDateChange={(end_date) => setSchedule((prev) => ({ ...prev, end_date }))}
                  />
                </div>

                <div className="mt-5">
                  <p className="text-sm font-medium text-[#0d0d0d]">시작시점</p>
                  <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                    <label className="block flex-1">
                      <span className="text-xs font-medium text-[#676767]">요일</span>
                      <select
                        value={schedule.day}
                        onChange={(event) =>
                          setSchedule((prev) => ({
                            ...prev,
                            day: event.target.value as PublishingWeekday
                          }))
                        }
                        disabled={scheduleLoading || scheduleSaving}
                        className="mt-1 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#534AB7] focus:outline-none disabled:opacity-60"
                      >
                        {PUBLISHING_WEEKDAY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}요일
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block flex-1">
                      <span className="text-xs font-medium text-[#676767]">시간</span>
                      <select
                        value={schedule.hour}
                        onChange={(event) =>
                          setSchedule((prev) => ({ ...prev, hour: Number(event.target.value) }))
                        }
                        disabled={scheduleLoading || scheduleSaving}
                        className="mt-1 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#534AB7] focus:outline-none disabled:opacity-60"
                      >
                        {PUBLISHING_HOUR_OPTIONS.map((hour) => (
                          <option key={hour} value={hour}>
                            {String(hour).padStart(2, "0")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block flex-1">
                      <span className="text-xs font-medium text-[#676767]">분</span>
                      <select
                        value={schedule.minute}
                        onChange={(event) =>
                          setSchedule((prev) => ({ ...prev, minute: Number(event.target.value) }))
                        }
                        disabled={scheduleLoading || scheduleSaving}
                        className="mt-1 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#534AB7] focus:outline-none disabled:opacity-60"
                      >
                        {PUBLISHING_MINUTE_OPTIONS.map((minute) => (
                          <option key={minute} value={minute}>
                            {String(minute).padStart(2, "0")}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveSchedule()}
                    disabled={scheduleSaving || scheduleLoading}
                    className="rounded-xl bg-[#534AB7] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#453da0] disabled:opacity-50"
                  >
                    {scheduleSaving ? "저장 중…" : editingScheduleId ? "수정 저장" : "저장"}
                  </button>
                  {editingScheduleId ? (
                    <button
                      type="button"
                      onClick={resetScheduleForm}
                      disabled={scheduleSaving}
                      className="rounded-xl border border-[rgba(0,0,0,0.14)] px-5 py-2.5 text-sm font-medium text-[#676767] hover:border-[#534AB7] hover:text-[#534AB7] disabled:opacity-50"
                    >
                      취소
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <section id="trigger" className="scroll-mt-24 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5">
              <h2 className="text-base font-semibold text-[#534AB7]">즉시 발송</h2>
              <p className="mt-1 text-sm text-[#676767]">선택한 파트와 수집기간으로 Publishing을 바로 실행합니다.</p>

              <div className="mt-5">
                <PartToggle value={immediatePart} onChange={setImmediatePart} disabled={triggerBusy} />
              </div>

              <div className="mt-5">
                <PeriodPicker
                  period={immediatePeriod}
                  startDate={immediateStartDate}
                  endDate={immediateEndDate}
                  onPeriodChange={setImmediatePeriod}
                  onStartDateChange={setImmediateStartDate}
                  onEndDateChange={setImmediateEndDate}
                />
              </div>

              <button
                type="button"
                onClick={() => void handleTriggerNow()}
                disabled={
                  triggerBusy ||
                  (immediatePeriod === "custom" && (!immediateStartDate || !immediateEndDate))
                }
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#534AB7] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#453da0] disabled:opacity-50"
              >
                {triggerBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    실행 중…
                  </>
                ) : (
                  "지금 실행"
                )}
              </button>
            </section>
          </div>
        ) : (
          <div className="mt-6">
            {selectedBatchId ? (
              <div className="flex flex-col gap-4">
                <section className="rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={handleBackToBatchList}
                        className="text-sm font-medium text-[#534AB7] hover:underline"
                      >
                        ← 목록으로
                      </button>
                      <h2 className="mt-3 text-lg font-semibold text-[#0d0d0d]">{batchDetailLabel}</h2>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <p className="text-sm text-[#676767]">
                          루나편집장 선별 {batchArticles.length.toLocaleString("ko-KR")}건 · 선정{" "}
                          {batchSelectedCount.toLocaleString("ko-KR")}건
                        </p>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleBulkSelectArticles(true)}
                            disabled={
                              batchDetailLoading ||
                              batchArticles.length === 0 ||
                              togglingArticleId !== null ||
                              batchSelectedCount === batchArticles.length
                            }
                            className="rounded-lg border border-[rgba(0,0,0,0.14)] px-2.5 py-1 text-xs font-medium text-[#676767] transition hover:border-[#534AB7] hover:text-[#534AB7] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            전체 선택
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleBulkSelectArticles(false)}
                            disabled={
                              batchDetailLoading ||
                              batchArticles.length === 0 ||
                              togglingArticleId !== null ||
                              batchSelectedCount === 0
                            }
                            className="rounded-lg border border-[rgba(0,0,0,0.14)] px-2.5 py-1 text-xs font-medium text-[#676767] transition hover:border-[#534AB7] hover:text-[#534AB7] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            전체 해제
                          </button>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSendBatchMail()}
                      disabled={batchSelectedCount === 0 || sendBatchBusy}
                      className="shrink-0 rounded-xl bg-[#534AB7] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#453da0] disabled:opacity-50"
                    >
                      {sendBatchBusy
                        ? "발송 중..."
                        : `최종 메일발송 (${batchSelectedCount.toLocaleString("ko-KR")})`}
                    </button>
                  </div>
                </section>

                {batchDetailLoading ? (
                  <p className="py-10 text-center text-sm text-[#8e8e8e]">불러오는 중…</p>
                ) : batchArticles.length === 0 ? (
                  <p className="rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white px-5 py-10 text-center text-sm text-[#8e8e8e]">
                    아티클이 없습니다
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {batchArticles.map((article) => (
                      <EditorArticleCard
                        key={article.id}
                        article={article}
                        toggling={togglingArticleId === article.id}
                        onToggleSelected={() => void handleToggleArticleSelected(article)}
                        onArticlePatch={handleArticlePatch}
                        onErrorToast={setToast}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <section className="overflow-hidden rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white">
                {editorLoading ? (
                  <p className="px-5 py-10 text-center text-sm text-[#8e8e8e]">불러오는 중…</p>
                ) : editorBatches.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-[#8e8e8e]">발행된 회차가 없습니다</p>
                ) : (
                  <>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[rgba(0,0,0,0.08)] bg-[#fafafa] text-left text-xs font-medium text-[#676767]">
                          <th className="px-5 py-3">발행 회차</th>
                          <th className="px-5 py-3 text-right">후보</th>
                          <th className="px-5 py-3 text-right">선정</th>
                          <th className="px-5 py-3 text-right">상태</th>
                          <th className="px-5 py-3 text-right">분석데이터</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[rgba(0,0,0,0.06)]">
                        {paginatedEditorBatches.map((batch) => (
                          <tr
                            key={batch.batch_id}
                            onClick={() => setSelectedBatchId(batch.batch_id)}
                            className="cursor-pointer transition hover:bg-[#534AB7]/5"
                          >
                            <td className="px-5 py-3 font-medium text-[#0d0d0d]">{batch.batch_label}</td>
                            <td className="px-5 py-3 text-right tabular-nums text-[#676767]">
                              {batch.candidateCount.toLocaleString("ko-KR")}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-[#676767]">
                              {batch.selectedCount.toLocaleString("ko-KR")}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {batch.isSent ? (
                                <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                                  발송완료
                                </span>
                              ) : (
                                <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                                  미발송
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {batch.isSent ? (
                                <button
                                  type="button"
                                  className="text-sm text-[#534AB7] underline underline-offset-2 hover:text-[#3f3799]"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void openAnalysisModal(batch);
                                  }}
                                >
                                  보기
                                </button>
                              ) : (
                                <span className="text-sm text-[#8e8e8e]">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {editorBatches.length > EDITOR_BATCH_PAGE_SIZE ? (
                      <nav
                        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-[rgba(0,0,0,0.08)] px-4 py-3 text-sm text-[#676767]"
                        aria-label="발행 회차 페이지"
                      >
                        <button
                          type="button"
                          aria-label="이전 페이지"
                          disabled={editorPage <= 1}
                          className="px-1 py-0.5 font-medium hover:text-[#0d0d0d] disabled:cursor-not-allowed disabled:opacity-35"
                          onClick={() => setEditorPage((p) => Math.max(1, p - 1))}
                        >
                          {"<"}
                        </button>
                        {Array.from({ length: editorTotalPages }, (_, i) => i + 1).map((page) => (
                          <button
                            key={page}
                            type="button"
                            onClick={() => setEditorPage(page)}
                            className={`min-w-[1.25rem] px-0.5 py-0.5 tabular-nums ${
                              page === editorPage
                                ? "font-bold text-[#534AB7] underline decoration-[#534AB7] decoration-2 underline-offset-4"
                                : "hover:text-[#0d0d0d]"
                            }`}
                          >
                            {page}
                          </button>
                        ))}
                        <button
                          type="button"
                          aria-label="다음 페이지"
                          disabled={editorPage >= editorTotalPages}
                          className="px-1 py-0.5 font-medium hover:text-[#0d0d0d] disabled:cursor-not-allowed disabled:opacity-35"
                          onClick={() => setEditorPage((p) => Math.min(editorTotalPages, p + 1))}
                        >
                          {">"}
                        </button>
                      </nav>
                    ) : null}
                  </>
                )}
              </section>
            )}
          </div>
        )}

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </div>

      <EditorAnalysisDataModal
        open={analysisModalOpen}
        batchLabel={analysisModalLabel}
        articles={analysisArticles}
        loading={analysisLoading}
        onClose={() => setAnalysisModalOpen(false)}
      />

      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
