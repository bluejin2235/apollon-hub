"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { SupplyToast } from "@/components/supplies/toast";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import {
  DEFAULT_PUBLISHING_SCHEDULE,
  formatPublishingScheduleSummary,
  PUBLISHING_HOUR_OPTIONS,
  PUBLISHING_PERIOD_OPTIONS,
  PUBLISHING_SCHEDULE_KEY,
  PUBLISHING_WEEKDAY_OPTIONS,
  parsePublishingSchedule,
  publishingPeriodToDays,
  serializePublishingSchedule,
  type PublishingPeriod,
  type PublishingSchedule,
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

function ArticleCardImageColumn({ src }: { src: string }) {
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  return (
    <div className="w-full shrink-0 basis-full sm:w-[240px] sm:basis-auto">
      <img
        src={src}
        alt=""
        onError={() => setHidden(true)}
        className="h-auto w-full rounded-lg"
      />
    </div>
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

export default function ResearchPublishingPage() {
  const router = useRouter();
  const { status } = useRequirePortalSession();
  const canManage = useResearchManager();

  const [activeTab, setActiveTab] = useState<PageTab>("publishing");

  const [schedule, setSchedule] = useState<PublishingSchedule>(DEFAULT_PUBLISHING_SCHEDULE);
  const [savedSchedule, setSavedSchedule] = useState<PublishingSchedule>(DEFAULT_PUBLISHING_SCHEDULE);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleSaving, setScheduleSaving] = useState(false);

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

  useEffect(() => {
    if (status !== "ready" || canManage !== true) return;

    void (async () => {
      setScheduleLoading(true);
      const { data, error: fetchError } = await supabase
        .from("trend_settings")
        .select("value")
        .eq("key", PUBLISHING_SCHEDULE_KEY)
        .maybeSingle();

      if (fetchError) {
        setError(fetchError.message);
        setScheduleLoading(false);
        return;
      }

      const parsed = parsePublishingSchedule(data?.value);
      setSchedule(parsed);
      setSavedSchedule(parsed);
      setScheduleLoading(false);
    })();
  }, [status, canManage]);

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
      window.alert(updateError.message);
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

  const handleSaveSchedule = async () => {
    if (scheduleSaving) return;

    if (schedule.period === "custom" && (!schedule.start_date || !schedule.end_date)) {
      setError("기간설정 시 시작일과 종료일을 입력해주세요.");
      return;
    }

    setScheduleSaving(true);
    setError(null);

    const { error: saveError } = await supabase.from("trend_settings").upsert(
      {
        key: PUBLISHING_SCHEDULE_KEY,
        value: serializePublishingSchedule(schedule),
        updated_at: new Date().toISOString()
      },
      { onConflict: "key" }
    );

    setScheduleSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setSavedSchedule(schedule);
    setToast("예약 설정이 저장되었습니다.");
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
        body: JSON.stringify({ days })
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
            : "발행 회차별로 AI편집장이 선별한 아티클을 검토하고 발송합니다."}
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
            AI편집장
          </button>
        </div>

        {activeTab === "publishing" ? (
          <div className="mt-6 flex flex-col gap-5">
            <section id="schedule" className="scroll-mt-24 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5">
              <h2 className="text-base font-semibold text-[#534AB7]">예약 발송</h2>

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
                        setSchedule((prev) => ({ ...prev, day: event.target.value as PublishingWeekday }))
                      }
                      disabled={scheduleLoading}
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
                      disabled={scheduleLoading}
                      className="mt-1 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#534AB7] focus:outline-none disabled:opacity-60"
                    >
                      {PUBLISHING_HOUR_OPTIONS.map((hour) => (
                        <option key={hour} value={hour}>
                          {hour}:00
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <p className="mt-5 rounded-xl bg-[#534AB7]/5 px-4 py-3 text-sm text-[#534AB7]">
                현재: {formatPublishingScheduleSummary(savedSchedule)}
              </p>

              <button
                type="button"
                onClick={() => void handleSaveSchedule()}
                disabled={scheduleSaving || scheduleLoading}
                className="mt-5 rounded-xl bg-[#534AB7] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#453da0] disabled:opacity-50"
              >
                {scheduleSaving ? "저장 중…" : "저장"}
              </button>
            </section>

            <section id="trigger" className="scroll-mt-24 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5">
              <h2 className="text-base font-semibold text-[#534AB7]">즉시 발송</h2>
              <p className="mt-1 text-sm text-[#676767]">선택한 수집기간으로 Publishing을 바로 실행합니다.</p>

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
                      <p className="mt-1 text-sm text-[#676767]">
                        AI편집장 선별 {batchArticles.length.toLocaleString("ko-KR")}건 · 선정{" "}
                        {batchSelectedCount.toLocaleString("ko-KR")}건
                      </p>
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
                    {batchArticles.map((article) => {
                      const isSelected = Boolean(article.is_selected);
                      const sourceLabel = [article.source_name, article.source_type]
                        .filter((part) => part?.trim())
                        .join(" · ");
                      const keywordTags = formatKeywordTags(article.keywords);
                      const reasonBullets = article.reasons?.trim()
                        ? parseReasonBullets(article.reasons)
                        : [];
                      const imageUrl = article.image_url?.trim() ?? "";

                      return (
                        <article
                          key={article.id}
                          className={`rounded-xl bg-white p-4 transition ${
                            isSelected
                              ? "border-2 border-[#534AB7]"
                              : "border border-[rgba(0,0,0,0.08)]"
                          }`}
                        >
                          <div className="flex gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={togglingArticleId === article.id}
                              onChange={() => void handleToggleArticleSelected(article)}
                              className="mt-1 h-4 w-4 shrink-0 accent-[#534AB7]"
                              aria-label={`${article.title ?? "아티클"} 선정`}
                            />
                            <div className="min-w-0 flex-1">
                              {sourceLabel ? (
                                <p className="text-xs text-[#8e8e8e]">{sourceLabel}</p>
                              ) : null}
                              <h3 className="mt-1 text-base font-medium text-[#0d0d0d]">
                                {article.title?.trim() || "제목 없음"}
                              </h3>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-4">
                            <div className="min-w-0 flex-1 basis-0">
                              {reasonBullets.length > 0 ? (
                                <ul
                                  className="list-disc space-y-2 pl-5"
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
                              ) : null}
                              {article.url?.trim() ? (
                                <a
                                  href={article.url.trim()}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`inline-block text-sm font-medium text-[#534AB7] hover:underline ${
                                    reasonBullets.length > 0 ? "mt-2" : ""
                                  }`}
                                >
                                  원본 보기 ↗
                                </a>
                              ) : null}
                              {article.summary?.trim() ? (
                                <p className="mt-2 text-sm leading-relaxed text-[#676767]">
                                  {article.summary}
                                </p>
                              ) : null}
                              {keywordTags ? (
                                <p className="mt-2 text-xs text-[#534AB7]">{keywordTags}</p>
                              ) : null}
                            </div>
                            {imageUrl ? <ArticleCardImageColumn src={imageUrl} /> : null}
                          </div>
                        </article>
                      );
                    })}
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
