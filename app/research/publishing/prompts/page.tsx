"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { SupplyToast } from "@/components/supplies/toast";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import {
  CHAT_SELECTION_PROMPT_KEY,
  COMMON_GPT_PROMPT_KEY,
  EDITOR_PROMPT_KEY,
  getDefaultPromptValue,
  type ResearchPromptKey,
  type ResearchPromptsResponse
} from "@/lib/research/prompt-settings";
import { LUNA_SYSTEM_PROMPT_KEY } from "@/lib/research/luna-system-prompt";
import { useResearchManager } from "@/lib/services/use-service-permissions";
import { supabase } from "@/lib/supabase/client";

type PromptSectionProps = {
  title: string;
  description: string;
  promptKey: ResearchPromptKey;
  value: string;
  loading: boolean;
  saving: boolean;
  canEdit: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  footerLink?: { href: string; label: string };
};

function PromptSection({
  title,
  description,
  value,
  loading,
  saving,
  canEdit,
  onChange,
  onSave,
  footerLink
}: PromptSectionProps) {
  return (
    <section className="rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5">
      <h2 className="text-base font-semibold text-[#534AB7]">{title}</h2>
      <p className="mt-1 text-sm text-[#676767]">{description}</p>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={!canEdit}
        disabled={loading || saving}
        rows={10}
        className="mt-4 w-full resize-y rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm leading-relaxed text-[#0d0d0d] focus:border-[#534AB7] focus:outline-none disabled:opacity-60 read-only:bg-[#fafafa]"
      />
      {canEdit ? (
        <button
          type="button"
          onClick={onSave}
          disabled={loading || saving || !value.trim()}
          className="mt-4 rounded-xl bg-[#534AB7] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#453da0] disabled:opacity-50"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
      ) : (
        <p className="mt-4 text-xs text-[#8e8e8e]">읽기 전용 · 관리 권한이 필요합니다.</p>
      )}
      {footerLink ? (
        <p className="mt-4 text-sm">
          <Link href={footerLink.href} className="font-medium text-[#534AB7] hover:underline">
            {footerLink.label}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

const EMPTY_PROMPTS: ResearchPromptsResponse = {
  [LUNA_SYSTEM_PROMPT_KEY]: getDefaultPromptValue(LUNA_SYSTEM_PROMPT_KEY),
  [COMMON_GPT_PROMPT_KEY]: getDefaultPromptValue(COMMON_GPT_PROMPT_KEY),
  [CHAT_SELECTION_PROMPT_KEY]: getDefaultPromptValue(CHAT_SELECTION_PROMPT_KEY),
  [EDITOR_PROMPT_KEY]: getDefaultPromptValue(EDITOR_PROMPT_KEY)
};

export default function ResearchPublishingPromptsPage() {
  const { status } = useRequirePortalSession();
  const canManage = useResearchManager();

  const [prompts, setPrompts] = useState<ResearchPromptsResponse>(EMPTY_PROMPTS);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<ResearchPromptKey | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        setError("로그인 세션이 없습니다.");
        setLoading(false);
        return;
      }

      const response = await fetch("/api/research/prompts", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (await response.json()) as { prompts?: ResearchPromptsResponse; error?: string };

      if (!response.ok) {
        setError(data.error ?? "프롬프트를 불러오지 못했습니다.");
        setLoading(false);
        return;
      }

      setPrompts({ ...EMPTY_PROMPTS, ...(data.prompts ?? {}) });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "프롬프트를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    void loadPrompts();
  }, [status, loadPrompts]);

  const handleSave = async (key: ResearchPromptKey) => {
    if (savingKey || !canManage) return;

    const value = prompts[key]?.trim();
    if (!value) {
      setToast("저장에 실패했습니다.");
      return;
    }

    setSavingKey(key);
    setError(null);

    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        setToast("저장에 실패했습니다.");
        return;
      }

      const response = await fetch("/api/research/prompts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ key, value })
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        setToast("저장에 실패했습니다.");
        return;
      }

      setToast("저장됐습니다.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "저장에 실패했습니다.");
      setToast("저장에 실패했습니다.");
    } finally {
      setSavingKey(null);
    }
  };

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const canEdit = canManage === true;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <h1 className="text-xl font-semibold text-[#0d0d0d]">프롬프트 관리</h1>
        <p className="mt-1 text-sm text-[#676767]">
          트렌드 레이더 전 과정에서 사용되는 AI 프롬프트를 단계별로 관리합니다. 루나 채팅 분석부터 아티클
          수집, AI 편집장 선정까지 각 단계의 프롬프트를 여기서 수정할 수 있습니다.
        </p>

        {loading ? (
          <p className="mt-8 text-sm text-[#8e8e8e]">프롬프트를 불러오는 중…</p>
        ) : (
          <div className="mt-6 flex flex-col gap-5">
            <PromptSection
              title="루나 프롬프트"
              description="채팅방에서 링크/영상을 분석할 때 루나가 사용하는 기준"
              promptKey={LUNA_SYSTEM_PROMPT_KEY}
              value={prompts[LUNA_SYSTEM_PROMPT_KEY]}
              loading={loading}
              saving={savingKey === LUNA_SYSTEM_PROMPT_KEY}
              canEdit={canEdit}
              onChange={(value) =>
                setPrompts((prev) => ({ ...prev, [LUNA_SYSTEM_PROMPT_KEY]: value }))
              }
              onSave={() => void handleSave(LUNA_SYSTEM_PROMPT_KEY)}
            />

            <PromptSection
              title="채팅방 선별 프롬프트"
              description="이번 주 채팅방 대화에서 아젠다/키워드를 추출하는 기준"
              promptKey={CHAT_SELECTION_PROMPT_KEY}
              value={prompts[CHAT_SELECTION_PROMPT_KEY]}
              loading={loading}
              saving={savingKey === CHAT_SELECTION_PROMPT_KEY}
              canEdit={canEdit}
              onChange={(value) =>
                setPrompts((prev) => ({ ...prev, [CHAT_SELECTION_PROMPT_KEY]: value }))
              }
              onSave={() => void handleSave(CHAT_SELECTION_PROMPT_KEY)}
            />

            <PromptSection
              title="수집사이트 공통 프롬프트"
              description="모든 수집사이트 GPT 웹검색에 공통 적용되는 기준"
              promptKey={COMMON_GPT_PROMPT_KEY}
              value={prompts[COMMON_GPT_PROMPT_KEY]}
              loading={loading}
              saving={savingKey === COMMON_GPT_PROMPT_KEY}
              canEdit={canEdit}
              onChange={(value) =>
                setPrompts((prev) => ({ ...prev, [COMMON_GPT_PROMPT_KEY]: value }))
              }
              onSave={() => void handleSave(COMMON_GPT_PROMPT_KEY)}
              footerLink={{ href: "/research/sources", label: "개별 사이트 프롬프트 설정 →" }}
            />

            <PromptSection
              title="AI 편집장 프롬프트"
              description="전체 후보 중 최종 아티클을 선정하는 기준"
              promptKey={EDITOR_PROMPT_KEY}
              value={prompts[EDITOR_PROMPT_KEY]}
              loading={loading}
              saving={savingKey === EDITOR_PROMPT_KEY}
              canEdit={canEdit}
              onChange={(value) => setPrompts((prev) => ({ ...prev, [EDITOR_PROMPT_KEY]: value }))}
              onSave={() => void handleSave(EDITOR_PROMPT_KEY)}
            />
          </div>
        )}

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </div>

      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
