"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import {
  isSourceFormValid,
  sourceFormValuesToPayload,
  trendSourceToFormValues,
  TrendSourceFormFields,
  type TrendSourceFormPayload,
  type TrendSourceFormValues
} from "@/components/research/trend-source-form-fields";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import {
  DEFAULT_P3_COLLECT_PROMPT,
  P3_COLLECT_PROMPT_KEY,
  P3_COLLECT_PROMPT_READ_KEYS
} from "@/lib/research/gpt-curator-prompt";
import type { TrendArticle, TrendSource, TrendSourceType } from "@/lib/research/types";
import { useResearchManager } from "@/lib/services/use-service-permissions";
import { supabase } from "@/lib/supabase/client";

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatLocalDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function SourceTypeBadge({ type }: { type: TrendSourceType }) {
  if (type === "magazine") {
    return (
      <span className="rounded-full bg-[#534AB7]/10 px-2.5 py-0.5 text-xs font-medium text-[#534AB7]">매거진</span>
    );
  }

  return (
    <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700">스튜디오</span>
  );
}

function ActiveBadge({ isActive }: { isActive: boolean }) {
  if (isActive) {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700">활성</span>
    );
  }

  return <span className="rounded-full bg-[#f4f4f4] px-2.5 py-0.5 text-xs font-medium text-[#8e8e8e]">비활성</span>;
}

function MatchedKeywordBadge({ keyword }: { keyword: string }) {
  return (
    <span className="rounded-md bg-[#534AB7]/10 px-2 py-0.5 text-[10px] font-medium text-[#534AB7]">
      {keyword}
    </span>
  );
}

type EditSourceModalProps = {
  open: boolean;
  saving: boolean;
  source: TrendSource;
  onClose: () => void;
  onSave: (payload: TrendSourceFormPayload) => Promise<void>;
};

function EditSourceModal({ open, saving, source, onClose, onSave }: EditSourceModalProps) {
  const [values, setValues] = useState<TrendSourceFormValues>(trendSourceToFormValues(source));

  useEffect(() => {
    if (!open) return;
    setValues(trendSourceToFormValues(source));
  }, [open, source]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-[#0d0d0d]">사이트 수정</h2>

        <div className="mt-4">
          <TrendSourceFormFields values={values} onChange={setValues} showActiveToggle />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm text-[#676767] hover:bg-[#f4f4f4] disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void onSave(sourceFormValuesToPayload(values))}
            disabled={saving || !isSourceFormValid(values)}
            className="rounded-lg bg-[#0d0d0d] px-4 py-2 text-sm font-medium text-white hover:bg-[#333] disabled:opacity-50"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function sourcePayloadToUpdate(payload: TrendSourceFormPayload) {
  return {
    url: payload.url,
    name: payload.name,
    type: payload.type,
    description: payload.description || null,
    keywords: payload.keywords,
    collect_methods: payload.collect_methods,
    youtube_channel_id: payload.youtube_channel_id,
    google_alerts_query: payload.google_alerts_query,
    is_active: payload.is_active ?? true
  };
}

export default function ResearchSourceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const sourceId = params.id;
  const { status } = useRequirePortalSession();

  const [source, setSource] = useState<TrendSource | null>(null);
  const [articles, setArticles] = useState<TrendArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [commonPrompt, setCommonPrompt] = useState(DEFAULT_P3_COLLECT_PROMPT);
  const [editingIndividualPrompt, setEditingIndividualPrompt] = useState(false);
  const [individualPromptDraft, setIndividualPromptDraft] = useState("");
  const [promptBusy, setPromptBusy] = useState(false);
  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return formatLocalDateInput(date);
  });
  const [dateTo, setDateTo] = useState(() => formatLocalDateInput(new Date()));
  const [collectBusy, setCollectBusy] = useState(false);
  const [collectResult, setCollectResult] = useState<string | null>(null);
  const canManageSource = useResearchManager() === true;
  const usesCommonPrompt = source?.gpt_prompt == null && !editingIndividualPrompt;

  const loadArticles = useCallback(async () => {
    if (!sourceId) return;

    const { data, error: articlesError } = await supabase
      .from("trend_articles")
      .select("*")
      .eq("source_id", sourceId)
      .order("collected_at", { ascending: false })
      .limit(10);

    if (articlesError) {
      setError(articlesError.message);
      return;
    }

    setArticles((data ?? []) as TrendArticle[]);
  }, [sourceId]);

  useEffect(() => {
    if (status !== "ready") return;

    void (async () => {
      const { data } = await supabase
        .from("trend_settings")
        .select("key, value")
        .in("key", [...P3_COLLECT_PROMPT_READ_KEYS]);

      const byKey = new Map((data ?? []).map((row) => [row.key as string, row.value as string]));
      for (const key of P3_COLLECT_PROMPT_READ_KEYS) {
        const found = byKey.get(key)?.trim();
        if (found) {
          setCommonPrompt(found);
          break;
        }
      }
    })();
  }, [status]);

  useEffect(() => {
    if (status !== "ready" || !sourceId) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      const { data: sourceData, error: sourceError } = await supabase
        .from("trend_sources")
        .select("*")
        .eq("id", sourceId)
        .maybeSingle();

      if (cancelled) return;

      if (sourceError) {
        setError(sourceError.message);
        setLoading(false);
        return;
      }

      if (!sourceData) {
        setError("수집 소스를 찾을 수 없습니다.");
        setLoading(false);
        return;
      }

      setSource(sourceData as TrendSource);
      if (sourceData.gpt_prompt) {
        setIndividualPromptDraft(String(sourceData.gpt_prompt));
      } else {
        setIndividualPromptDraft("");
        setEditingIndividualPrompt(false);
      }
      setLoading(false);
      await loadArticles();
    })();

    return () => {
      cancelled = true;
    };
  }, [sourceId, status, loadArticles]);

  const handleStartIndividualPrompt = () => {
    setIndividualPromptDraft(commonPrompt);
    setEditingIndividualPrompt(true);
  };

  const handleSaveIndividualPrompt = async () => {
    if (!source || promptBusy) return;

    const trimmed = individualPromptDraft.trim();
    if (!trimmed) {
      setError("프롬프트 내용을 입력해 주세요.");
      return;
    }

    setPromptBusy(true);
    const { data, error: updateError } = await supabase
      .from("trend_sources")
      .update({ gpt_prompt: trimmed })
      .eq("id", source.id)
      .select("*")
      .single();

    setPromptBusy(false);

    if (updateError || !data) {
      setError(updateError?.message ?? "프롬프트 저장에 실패했습니다.");
      return;
    }

    setSource(data as TrendSource);
    setEditingIndividualPrompt(false);
    setError(null);
  };

  const handleResetToCommonPrompt = async () => {
    if (!source || promptBusy) return;
    if (!window.confirm("개별 프롬프트를 삭제하고 공통 프롬프트를 사용할까요?")) return;

    setPromptBusy(true);
    const { data, error: updateError } = await supabase
      .from("trend_sources")
      .update({ gpt_prompt: null })
      .eq("id", source.id)
      .select("*")
      .single();

    setPromptBusy(false);

    if (updateError || !data) {
      setError(updateError?.message ?? "프롬프트 초기화에 실패했습니다.");
      return;
    }

    setSource(data as TrendSource);
    setEditingIndividualPrompt(false);
    setIndividualPromptDraft("");
    setError(null);
  };

  const handleEditSave = async (payload: TrendSourceFormPayload) => {
    if (!source) return;

    setEditBusy(true);
    const { data, error: updateError } = await supabase
      .from("trend_sources")
      .update(sourcePayloadToUpdate(payload))
      .eq("id", source.id)
      .select("*")
      .single();

    setEditBusy(false);

    if (updateError || !data) {
      setError(updateError?.message ?? "수정에 실패했습니다.");
      return;
    }

    setSource(data as TrendSource);
    setEditOpen(false);
    setError(null);
  };

  const handleDelete = async () => {
    if (!source || deleteBusy) return;
    if (!window.confirm(`"${source.name}" 수집 소스를 삭제할까요?`)) return;

    setDeleteBusy(true);
    const { error: deleteError } = await supabase.from("trend_sources").delete().eq("id", source.id);
    setDeleteBusy(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    router.push("/research/sources");
  };

  const handleTestCollect = async () => {
    if (!source || collectBusy) return;

    setCollectBusy(true);
    setCollectResult(null);
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

      const requestBody: { source_id: string; date_from?: string; date_to?: string } = {
        source_id: source.id
      };
      if (dateFrom && dateTo) {
        requestBody.date_from = dateFrom;
        requestBody.date_to = dateTo;
      }

      const response = await fetch("/api/research/sources/test-collect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      });

      const data = (await response.json()) as {
        error?: string;
        collected?: number;
        skipped?: number;
        url_validation_failed?: number;
        message?: string;
        method?: string;
      };

      if (!response.ok) {
        setError(data.error ?? "테스트 수집에 실패했습니다.");
        return;
      }

      setCollectResult(`수집 완료: ${data.message ?? `${data.collected ?? 0}건 추가, ${data.skipped ?? 0}건 스킵`}`);

      const { data: refreshedSource } = await supabase
        .from("trend_sources")
        .select("*")
        .eq("id", source.id)
        .maybeSingle();

      if (refreshedSource) {
        setSource(refreshedSource as TrendSource);
      }

      await loadArticles();
    } catch (collectError) {
      const message = collectError instanceof Error ? collectError.message : "테스트 수집에 실패했습니다.";
      setError(message);
    } finally {
      setCollectBusy(false);
    }
  };

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[#8e8e8e]">수집 소스를 불러오는 중…</div>
    );
  }

  if (error && !source) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
        <p className="text-sm text-red-600">{error}</p>
        <Link href="/research/sources" className="text-sm text-[#534AB7] hover:underline">
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  if (!source) return null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <Link
          href="/research/sources"
          className="inline-flex items-center gap-1.5 text-sm text-[#676767] transition hover:text-[#0d0d0d]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          수집 소스 목록
        </Link>

        <div className="mt-4 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-[#0d0d0d]">{source.name}</h1>
                <SourceTypeBadge type={source.type} />
                <ActiveBadge isActive={source.is_active} />
              </div>
              <p className="mt-3 text-sm text-[#676767]">{source.description?.trim() || "설명이 없습니다."}</p>
            </div>

            {canManageSource ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="rounded-lg border border-[rgba(0,0,0,0.12)] px-3 py-1.5 text-sm text-[#0d0d0d] hover:bg-[#f4f4f4]"
                >
                  수정
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleteBusy}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {deleteBusy ? "삭제 중…" : "삭제"}
                </button>
              </div>
            ) : null}
          </div>

          <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-[rgba(0,0,0,0.08)] pt-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-[#8e8e8e]">수집 주기</dt>
              <dd className="mt-1 text-sm font-medium text-[#0d0d0d]">매주 금요일 23:00</dd>
            </div>
            <div>
              <dt className="text-xs text-[#8e8e8e]">누적 수집건수</dt>
              <dd className="mt-1 text-sm font-medium text-[#0d0d0d]">{source.article_count.toLocaleString("ko-KR")}건</dd>
            </div>
            <div>
              <dt className="text-xs text-[#8e8e8e]">마지막 수집일</dt>
              <dd className="mt-1 text-sm font-medium text-[#0d0d0d]">{formatDateTime(source.last_collected_at)}</dd>
            </div>
          </dl>
        </div>

        <div className="mt-4 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5">
          <h2 className="text-base font-semibold text-[#0d0d0d]">개별 GPT 프롬프트</h2>

          {!canManageSource ? (
            <p className="mt-3 text-sm text-[#676767]">
              {usesCommonPrompt ? "공통 프롬프트 사용 중" : "개별 프롬프트가 설정되어 있습니다."}
            </p>
          ) : usesCommonPrompt ? (
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[#676767]">공통 프롬프트 사용 중</p>
              <button
                type="button"
                onClick={handleStartIndividualPrompt}
                disabled={promptBusy}
                className="rounded-lg border border-[rgba(0,0,0,0.12)] px-3.5 py-1.5 text-sm font-medium text-[#0d0d0d] hover:bg-[#f4f4f4] disabled:opacity-50"
              >
                개별 설정
              </button>
            </div>
          ) : (
            <>
              <p className="mt-1 text-sm text-[#676767]">
                {source.gpt_prompt ? "이 소스에만 적용되는 개별 프롬프트입니다." : "저장 전 미리보기입니다."}
              </p>
              <textarea
                value={individualPromptDraft}
                onChange={(event) => setIndividualPromptDraft(event.target.value)}
                disabled={promptBusy}
                rows={12}
                className="mt-3 w-full resize-y rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm leading-relaxed text-[#0d0d0d] focus:border-[#0d0d0d] focus:outline-none disabled:opacity-60"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveIndividualPrompt()}
                  disabled={promptBusy}
                  className="rounded-lg bg-[#0d0d0d] px-3.5 py-1.5 text-sm font-medium text-white hover:bg-[#333] disabled:opacity-50"
                >
                  {promptBusy ? "저장 중…" : "저장"}
                </button>
                {source.gpt_prompt ? (
                  <button
                    type="button"
                    onClick={() => void handleResetToCommonPrompt()}
                    disabled={promptBusy}
                    className="rounded-lg border border-[rgba(0,0,0,0.12)] px-3.5 py-1.5 text-sm text-[#676767] hover:bg-[#f4f4f4] disabled:opacity-50"
                  >
                    공통으로 초기화
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingIndividualPrompt(false)}
                    disabled={promptBusy}
                    className="rounded-lg border border-[rgba(0,0,0,0.12)] px-3.5 py-1.5 text-sm text-[#676767] hover:bg-[#f4f4f4] disabled:opacity-50"
                  >
                    취소
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {canManageSource ? (
        <div className="mt-4 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5">
          <h2 className="text-base font-semibold text-[#0d0d0d]">수집 테스트</h2>
          <p className="mt-1 text-sm text-[#676767]">선택한 기간 내 아티클을 테스트 수집합니다.</p>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1">
              <span className="text-xs font-medium text-[#676767]">시작일</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="mt-1 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#0d0d0d] focus:outline-none"
              />
            </label>
            <span className="hidden pb-2 text-sm text-[#8e8e8e] sm:block">~</span>
            <label className="block flex-1">
              <span className="text-xs font-medium text-[#676767]">종료일</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="mt-1 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#0d0d0d] focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleTestCollect()}
              disabled={collectBusy || Boolean(dateFrom) !== Boolean(dateTo)}
              className="rounded-xl bg-[#534AB7] px-4 py-2 text-sm font-medium text-white hover:bg-[#453da0] disabled:opacity-50"
            >
              {collectBusy ? "수집 중…" : "테스트 수집 시작"}
            </button>
          </div>

          {collectResult ? <p className="mt-3 text-sm text-[#534AB7]">{collectResult}</p> : null}
        </div>
        ) : null}

        <div className="mt-4 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5">
          <h2 className="text-base font-semibold text-[#0d0d0d]">최근 수집 아티클</h2>

          {articles.length === 0 ? (
            <p className="mt-4 text-sm text-[#8e8e8e]">아직 수집된 아티클이 없습니다.</p>
          ) : (
            <ul className="mt-4 divide-y divide-[rgba(0,0,0,0.08)]">
              {articles.map((article) => (
                <li
                  key={article.id}
                  className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#0d0d0d]">{article.title}</p>
                    {article.keywords.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {article.keywords.map((keyword) => (
                          <MatchedKeywordBadge key={keyword} keyword={keyword} />
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-1 text-xs text-[#8e8e8e]">{formatDateTime(article.collected_at)}</p>
                  </div>
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[rgba(0,0,0,0.12)] px-3 py-1.5 text-xs font-medium text-[#534AB7] hover:bg-[#534AB7]/5"
                  >
                    외부 링크
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </div>

      <EditSourceModal
        open={editOpen}
        saving={editBusy}
        source={source}
        onClose={() => setEditOpen(false)}
        onSave={handleEditSave}
      />
    </div>
  );
}
