"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { SupplyToast } from "@/components/supplies/toast";
import {
  createEmptySourceFormValues,
  isSourceFormValid,
  sourceFormValuesToPayload,
  TrendSourceFormFields,
  type TrendSourceFormPayload
} from "@/components/research/trend-source-form-fields";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import {
  DEFAULT_GPT_CURATOR_PROMPT,
  GPT_CURATOR_PROMPT_KEY
} from "@/lib/research/gpt-curator-prompt";
import type { TrendSource, TrendSourceType } from "@/lib/research/types";
import { isSuperAdmin } from "@/lib/services/permissions";
import { supabase } from "@/lib/supabase/client";

type SourceFilter = "all" | TrendSourceType;

const FILTER_TABS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "magazine", label: "매거진" },
  { value: "studio", label: "스튜디오" }
];

function SourceTypeBadge({ type }: { type: TrendSourceType }) {
  if (type === "magazine") {
    return (
      <span className="rounded-full bg-[#534AB7]/10 px-2 py-0.5 text-[11px] font-medium text-[#534AB7]">매거진</span>
    );
  }

  return (
    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700">스튜디오</span>
  );
}

type AddSourceModalProps = {
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: TrendSourceFormPayload) => Promise<void>;
};

function AddSourceModal({ open, saving, onClose, onSave }: AddSourceModalProps) {
  const [values, setValues] = useState(createEmptySourceFormValues());

  useEffect(() => {
    if (!open) return;
    setValues(createEmptySourceFormValues());
  }, [open]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!isSourceFormValid(values)) return;
    await onSave(sourceFormValuesToPayload(values));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-[#0d0d0d]">사이트 추가</h2>

        <div className="mt-4">
          <TrendSourceFormFields values={values} onChange={setValues} />
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
            onClick={() => void handleSubmit()}
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

function sourcePayloadToInsert(payload: TrendSourceFormPayload) {
  return {
    url: payload.url,
    name: payload.name,
    type: payload.type,
    description: payload.description || null,
    keywords: payload.keywords,
    collect_methods: payload.collect_methods,
    youtube_channel_id: payload.youtube_channel_id,
    google_alerts_query: payload.google_alerts_query,
    is_active: true
  };
}

export default function ResearchSourcesPage() {
  const { status, profile } = useRequirePortalSession();
  const [sources, setSources] = useState<TrendSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [commonPrompt, setCommonPrompt] = useState(DEFAULT_GPT_CURATOR_PROMPT);
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const canEditPrompt = isSuperAdmin(profile);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadSources = async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("trend_sources")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    setSources((data ?? []) as TrendSource[]);
    setError(null);
    setLoading(false);
  };

  useEffect(() => {
    if (status !== "ready") return;
    void loadSources();
  }, [status]);

  useEffect(() => {
    if (status !== "ready") return;

    void (async () => {
      setPromptLoading(true);
      const { data, error: promptError } = await supabase
        .from("trend_settings")
        .select("value")
        .eq("key", GPT_CURATOR_PROMPT_KEY)
        .maybeSingle();

      if (promptError) {
        setError(promptError.message);
      } else {
        setCommonPrompt(data?.value ?? DEFAULT_GPT_CURATOR_PROMPT);
      }
      setPromptLoading(false);
    })();
  }, [status]);

  const handleSaveCommonPrompt = async () => {
    if (!canEditPrompt || promptSaving) return;

    setPromptSaving(true);
    const { error: saveError } = await supabase.from("trend_settings").upsert(
      {
        key: GPT_CURATOR_PROMPT_KEY,
        value: commonPrompt,
        updated_at: new Date().toISOString()
      },
      { onConflict: "key" }
    );
    setPromptSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setError(null);
  };

  const handleApplyCommonToAll = async () => {
    if (!canEditPrompt || applyBusy || promptSaving) return;
    if (
      !window.confirm("공통 프롬프트를 모든 소스의 개별 프롬프트로 덮어씁니다. 계속하시겠습니까?")
    ) {
      return;
    }

    setApplyBusy(true);
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

      const response = await fetch("/api/research/sources/apply-common-prompt", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = (await response.json()) as { error?: string; updated_count?: number };

      if (!response.ok) {
        setError(data.error ?? "개별 프롬프트 적용에 실패했습니다.");
        return;
      }

      setToast("모든 소스에 적용됐습니다.");
    } catch (applyError) {
      const message =
        applyError instanceof Error ? applyError.message : "개별 프롬프트 적용에 실패했습니다.";
      setError(message);
    } finally {
      setApplyBusy(false);
    }
  };

  const filteredSources = useMemo(() => {
    if (filter === "all") return sources;
    return sources.filter((source) => source.type === filter);
  }, [filter, sources]);

  const handleAddSource = async (payload: TrendSourceFormPayload) => {
    setSaving(true);
    const { data, error: insertError } = await supabase
      .from("trend_sources")
      .insert(sourcePayloadToInsert(payload))
      .select("*")
      .single();

    setSaving(false);

    if (insertError || !data) {
      setError(insertError?.message ?? "사이트 추가에 실패했습니다.");
      return;
    }

    setSources((prev) => [data as TrendSource, ...prev]);
    setModalOpen(false);
    setError(null);
  };

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-[#0d0d0d]">위클리 수집 사이트</h1>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0d0d0d] px-3.5 py-2 text-sm font-medium text-white transition hover:bg-[#333]"
          >
            <Plus className="h-4 w-4" aria-hidden />
            사이트 추가
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold text-[#0d0d0d]">공통 GPT 프롬프트</h2>
            <button
              type="button"
              onClick={() => setPromptExpanded((prev) => !prev)}
              className="rounded-lg border border-[rgba(0,0,0,0.12)] px-3.5 py-1.5 text-sm font-medium text-[#0d0d0d] hover:bg-[#f4f4f4]"
            >
              {promptExpanded ? "접기" : "펼치기"}
            </button>
          </div>

          {promptExpanded ? (
            <>
              <p className="mt-1 text-sm text-[#676767]">
                개별 프롬프트가 없는 수집 소스에 적용되는 기본 큐레이션 프롬프트입니다.
              </p>
              <textarea
                value={commonPrompt}
                onChange={(event) => setCommonPrompt(event.target.value)}
                readOnly={!canEditPrompt}
                disabled={promptLoading}
                rows={12}
                className="mt-3 w-full resize-y rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm leading-relaxed text-[#0d0d0d] focus:border-[#0d0d0d] focus:outline-none disabled:opacity-60 read-only:bg-[#fafafa]"
              />
              {canEditPrompt ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveCommonPrompt()}
                    disabled={promptSaving || promptLoading || applyBusy}
                    className="rounded-lg bg-[#0d0d0d] px-3.5 py-1.5 text-sm font-medium text-white hover:bg-[#333] disabled:opacity-50"
                  >
                    {promptSaving ? "저장 중…" : "저장"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleApplyCommonToAll()}
                    disabled={applyBusy || promptLoading || promptSaving}
                    className="rounded-lg border border-[rgba(0,0,0,0.12)] px-3.5 py-1.5 text-sm font-medium text-[#0d0d0d] hover:bg-[#f4f4f4] disabled:opacity-50"
                  >
                    {applyBusy ? "적용 중…" : "모든 개별프롬프트 적용"}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="mt-5 flex gap-1 rounded-xl bg-[#f4f4f4] p-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter(tab.value)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                filter === tab.value ? "bg-white text-[#0d0d0d] shadow-sm" : "text-[#676767] hover:text-[#0d0d0d]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

        {loading ? (
          <p className="mt-10 text-center text-sm text-[#8e8e8e]">수집 소스를 불러오는 중…</p>
        ) : filteredSources.length === 0 ? (
          <p className="mt-10 text-center text-sm text-[#8e8e8e]">등록된 수집 사이트가 없습니다.</p>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {filteredSources.map((source) => (
              <Link
                key={source.id}
                href={`/research/sources/${source.id}`}
                className="block rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-4 transition hover:border-[rgba(0,0,0,0.15)] hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold text-[#0d0d0d]">{source.name}</h2>
                  <SourceTypeBadge type={source.type} />
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-[#676767]">
                  {source.description?.trim() || "설명이 없습니다."}
                </p>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-10 flex flex-col items-start justify-between gap-3 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-[#f4f4f4] px-4 py-4 sm:flex-row sm:items-center">
          <p className="text-sm text-[#676767]">다음 수집 예정: 매주 금요일 23:00</p>
          <button
            type="button"
            disabled
            className="rounded-lg border border-[rgba(0,0,0,0.12)] bg-white px-4 py-2 text-sm font-medium text-[#8e8e8e]"
            title="준비 중"
          >
            지금 수집 (준비 중)
          </button>
        </div>
      </div>

      <AddSourceModal open={modalOpen} saving={saving} onClose={() => setModalOpen(false)} onSave={handleAddSource} />
      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
