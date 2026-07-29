"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { SupplyToast } from "@/components/supplies/toast";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import {
  getDefaultPromptValue,
  P1_1_ARTICLE_PROMPT_KEY,
  P1_LUNA_PROMPT_KEY,
  P2_TREND_PROMPT_CONTENT_KEY,
  P2_TREND_PROMPT_KEY,
  P2_TREND_PROMPT_SPACE_KEY,
  P3_COLLECT_PROMPT_CONTENT_KEY,
  P3_COLLECT_PROMPT_KEY,
  P3_COLLECT_PROMPT_SPACE_KEY,
  P4_EDITOR_PROMPT_CONTENT_KEY,
  P4_EDITOR_PROMPT_KEY,
  P4_EDITOR_PROMPT_SPACE_KEY,
  P5_REPORT_PROMPT_CONTENT_KEY,
  P5_REPORT_PROMPT_KEY,
  P5_REPORT_PROMPT_SPACE_KEY,
  type ResearchPromptKey,
  type ResearchPromptsResponse
} from "@/lib/research/prompt-settings";
import { getServiceIdByUrl, SERVICE_URL } from "@/lib/services/permissions";
import { useResearchManager } from "@/lib/services/use-service-permissions";
import { supabase } from "@/lib/supabase/client";

type TrendPart = "content" | "space";

const MIDDLE_ADMIN_ROLE = "중간관리자";
const SUPER_ADMIN_ROLE = "슈퍼관리자";

type ProfileOption = {
  id: string;
  name: string | null;
  email: string | null;
};

type PromptSectionProps = {
  title: string;
  description: string;
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

function PartEditorCard({
  description,
  profiles,
  selectedUserId,
  loading,
  saving,
  canEdit,
  onChange,
  onSave
}: {
  description: string;
  profiles: ProfileOption[];
  selectedUserId: string;
  loading: boolean;
  saving: boolean;
  canEdit: boolean;
  onChange: (userId: string) => void;
  onSave: () => void;
}) {
  return (
    <section className="rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5">
      <h3 className="text-sm font-semibold text-[#0d0d0d]">담당 편집장</h3>
      <p className="mt-1 text-sm leading-relaxed text-[#676767]">{description}</p>
      <label className="mt-4 block">
        <span className="text-xs font-medium text-[#676767]">편집장</span>
        <select
          value={selectedUserId}
          onChange={(event) => onChange(event.target.value)}
          disabled={!canEdit || loading || saving || profiles.length === 0}
          className="mt-1 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#534AB7] focus:outline-none disabled:opacity-60"
        >
          {profiles.length === 0 ? (
            <option value="">지정된 중간관리자 없음</option>
          ) : (
            <>
              <option value="">선택하세요</option>
              {profiles.map((profile) => {
                const label = profile.name?.trim() || profile.email?.trim() || profile.id;
                return (
                  <option key={profile.id} value={profile.id}>
                    {label}
                  </option>
                );
              })}
            </>
          )}
        </select>
      </label>
      {canEdit ? (
        <button
          type="button"
          onClick={onSave}
          disabled={loading || saving || !selectedUserId || profiles.length === 0}
          className="mt-4 rounded-xl bg-[#534AB7] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#453da0] disabled:opacity-50"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
      ) : (
        <p className="mt-4 text-xs text-[#8e8e8e]">읽기 전용 · 관리 권한이 필요합니다.</p>
      )}
    </section>
  );
}

const EMPTY_PROMPTS: ResearchPromptsResponse = {
  [P1_LUNA_PROMPT_KEY]: getDefaultPromptValue(P1_LUNA_PROMPT_KEY),
  [P1_1_ARTICLE_PROMPT_KEY]: getDefaultPromptValue(P1_1_ARTICLE_PROMPT_KEY),
  [P2_TREND_PROMPT_KEY]: getDefaultPromptValue(P2_TREND_PROMPT_KEY),
  [P2_TREND_PROMPT_CONTENT_KEY]: getDefaultPromptValue(P2_TREND_PROMPT_CONTENT_KEY),
  [P2_TREND_PROMPT_SPACE_KEY]: getDefaultPromptValue(P2_TREND_PROMPT_SPACE_KEY),
  [P3_COLLECT_PROMPT_KEY]: getDefaultPromptValue(P3_COLLECT_PROMPT_KEY),
  [P3_COLLECT_PROMPT_CONTENT_KEY]: getDefaultPromptValue(P3_COLLECT_PROMPT_CONTENT_KEY),
  [P3_COLLECT_PROMPT_SPACE_KEY]: getDefaultPromptValue(P3_COLLECT_PROMPT_SPACE_KEY),
  [P4_EDITOR_PROMPT_KEY]: getDefaultPromptValue(P4_EDITOR_PROMPT_KEY),
  [P4_EDITOR_PROMPT_CONTENT_KEY]: getDefaultPromptValue(P4_EDITOR_PROMPT_CONTENT_KEY),
  [P4_EDITOR_PROMPT_SPACE_KEY]: getDefaultPromptValue(P4_EDITOR_PROMPT_SPACE_KEY),
  [P5_REPORT_PROMPT_KEY]: getDefaultPromptValue(P5_REPORT_PROMPT_KEY),
  [P5_REPORT_PROMPT_CONTENT_KEY]: getDefaultPromptValue(P5_REPORT_PROMPT_CONTENT_KEY),
  [P5_REPORT_PROMPT_SPACE_KEY]: getDefaultPromptValue(P5_REPORT_PROMPT_SPACE_KEY)
};

const CONTENT_PROMPT_CARDS: {
  key: ResearchPromptKey;
  title: string;
  description: string;
  footerLink?: { href: string; label: string };
}[] = [
  {
    key: P2_TREND_PROMPT_CONTENT_KEY,
    title: "P2-콘텐츠 채팅방 트렌드 프롬프트",
    description: "콘텐츠파트 관점에서 이번 주 채팅방 아젠다/키워드를 추출하는 기준"
  },
  {
    key: P3_COLLECT_PROMPT_CONTENT_KEY,
    title: "P3-콘텐츠 트렌드 수집 프롬프트",
    description: "콘텐츠파트 트렌드 구독함 수집에 적용되는 기준",
    footerLink: { href: "/research/sources", label: "개별 사이트 프롬프트 설정 →" }
  },
  {
    key: P4_EDITOR_PROMPT_CONTENT_KEY,
    title: "P4-콘텐츠 루나 편집장 프롬프트",
    description: "콘텐츠파트 후보 중 최종 아티클을 선정하는 기준"
  },
  {
    key: P5_REPORT_PROMPT_CONTENT_KEY,
    title: "P5-콘텐츠 트렌드 리포트",
    description: "콘텐츠파트 선정 아티클을 노션 상세 리포트로 변환하는 프롬프트"
  }
];

const SPACE_PROMPT_CARDS: {
  key: ResearchPromptKey;
  title: string;
  description: string;
  footerLink?: { href: string; label: string };
}[] = [
  {
    key: P2_TREND_PROMPT_SPACE_KEY,
    title: "P2-공간 채팅방 트렌드 프롬프트",
    description: "공간파트 관점에서 이번 주 채팅방 아젠다/키워드를 추출하는 기준"
  },
  {
    key: P3_COLLECT_PROMPT_SPACE_KEY,
    title: "P3-공간 트렌드 수집 프롬프트",
    description: "공간파트 트렌드 구독함 수집에 적용되는 기준",
    footerLink: { href: "/research/sources", label: "개별 사이트 프롬프트 설정 →" }
  },
  {
    key: P4_EDITOR_PROMPT_SPACE_KEY,
    title: "P4-공간 루나 편집장 프롬프트",
    description: "공간파트 후보 중 최종 아티클을 선정하는 기준"
  },
  {
    key: P5_REPORT_PROMPT_SPACE_KEY,
    title: "P5-공간 트렌드 리포트",
    description: "공간파트 선정 아티클을 노션 상세 리포트로 변환하는 프롬프트"
  }
];

export default function ResearchPublishingPromptsPage() {
  const router = useRouter();
  const { status } = useRequirePortalSession();
  const canManage = useResearchManager();

  const [prompts, setPrompts] = useState<ResearchPromptsResponse>(EMPTY_PROMPTS);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<ResearchPromptKey | null>(null);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [superAdminNames, setSuperAdminNames] = useState("슈퍼관리자");
  const [contentEditorId, setContentEditorId] = useState("");
  const [spaceEditorId, setSpaceEditorId] = useState("");
  const [savingPart, setSavingPart] = useState<TrendPart | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      const researchServiceId = await getServiceIdByUrl(SERVICE_URL.RESEARCH);

      const [promptsResponse, editorsResult, superAdminsResult, middleAdminRolesResult] =
        await Promise.all([
          fetch("/api/research/prompts", {
            headers: { Authorization: `Bearer ${token}` }
          }),
          supabase.from("trend_part_editors").select("part, editor_user_id"),
          supabase
            .from("profiles")
            .select("id, name, email")
            .eq("role", SUPER_ADMIN_ROLE)
            .order("name", { ascending: true }),
          researchServiceId
            ? supabase
                .from("service_user_roles")
                .select("profile_id")
                .eq("service_id", researchServiceId)
                .eq("role", MIDDLE_ADMIN_ROLE)
            : Promise.resolve({ data: [] as { profile_id: string }[], error: null })
        ]);

      const data = (await promptsResponse.json()) as {
        prompts?: ResearchPromptsResponse;
        error?: string;
      };

      if (!promptsResponse.ok) {
        setError(data.error ?? "프롬프트를 불러오지 못했습니다.");
        setLoading(false);
        return;
      }

      const superAdminProfiles = !superAdminsResult.error
        ? ((superAdminsResult.data ?? []) as ProfileOption[])
        : [];

      if (superAdminsResult.error) {
        setError(superAdminsResult.error.message);
        setSuperAdminNames("슈퍼관리자");
      } else {
        const names = superAdminProfiles
          .map((row) => row.name?.trim() ?? "")
          .filter(Boolean);
        setSuperAdminNames(names.length > 0 ? names.join(", ") : "슈퍼관리자");
      }

      let middleAdminProfiles: ProfileOption[] = [];
      if (middleAdminRolesResult.error) {
        setError(middleAdminRolesResult.error.message);
      } else {
        const profileIds = [
          ...new Set(
            (middleAdminRolesResult.data ?? [])
              .map((row) => row.profile_id)
              .filter((id): id is string => typeof id === "string" && id.length > 0)
          )
        ];

        if (profileIds.length > 0) {
          const { data: middleRows, error: profilesError } = await supabase
            .from("profiles")
            .select("id, name, email")
            .in("id", profileIds)
            .order("name", { ascending: true });

          if (profilesError) {
            setError(profilesError.message);
          } else {
            middleAdminProfiles = (middleRows ?? []) as ProfileOption[];
          }
        }
      }

      const mergedById = new Map<string, ProfileOption>();
      for (const profile of [...superAdminProfiles, ...middleAdminProfiles]) {
        if (!profile.id || mergedById.has(profile.id)) continue;
        mergedById.set(profile.id, profile);
      }
      setProfiles(
        [...mergedById.values()].sort((a, b) =>
          (a.name?.trim() || a.email || a.id).localeCompare(
            b.name?.trim() || b.email || b.id,
            "ko"
          )
        )
      );

      if (editorsResult.error) {
        setError(editorsResult.error.message);
      } else {
        const rows = (editorsResult.data ?? []) as { part: string; editor_user_id: string | null }[];
        setContentEditorId(rows.find((row) => row.part === "content")?.editor_user_id ?? "");
        setSpaceEditorId(rows.find((row) => row.part === "space")?.editor_user_id ?? "");
      }

      setPrompts({ ...EMPTY_PROMPTS, ...(data.prompts ?? {}) });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "프롬프트를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "ready" || canManage !== true) return;
    void loadPrompts();
  }, [status, canManage, loadPrompts]);

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

  const handleSavePartEditor = async (part: TrendPart) => {
    if (savingPart || !canManage) return;

    const editorUserId = part === "content" ? contentEditorId : spaceEditorId;
    if (!editorUserId) {
      setToast("편집장을 선택해 주세요.");
      return;
    }

    setSavingPart(part);
    setError(null);

    const { error: saveError } = await supabase.from("trend_part_editors").upsert(
      {
        part,
        editor_user_id: editorUserId,
        updated_at: new Date().toISOString()
      },
      { onConflict: "part" }
    );

    setSavingPart(null);

    if (saveError) {
      setError(saveError.message);
      setToast("저장에 실패했습니다.");
      return;
    }

    setToast("담당 편집장이 저장됐습니다.");
  };

  if (status === "checking" || canManage === null) {
    return <PortalAuthChecking />;
  }

  if (canManage === false) {
    return <PortalAuthChecking />;
  }

  const canEdit = true;

  const renderPromptCards = (
    cards: typeof CONTENT_PROMPT_CARDS
  ) =>
    cards.map((card) => (
      <PromptSection
        key={card.key}
        title={card.title}
        description={card.description}
        value={prompts[card.key]}
        loading={loading}
        saving={savingKey === card.key}
        canEdit={canEdit}
        onChange={(value) => setPrompts((prev) => ({ ...prev, [card.key]: value }))}
        onSave={() => void handleSave(card.key)}
        footerLink={card.footerLink}
      />
    ));

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <h1 className="text-xl font-semibold text-[#0d0d0d]">프롬프트 관리</h1>
        <p className="mt-1 text-sm text-[#676767]">
          트렌드 레이더 전 과정에서 사용되는 루나 프롬프트를 단계별로 관리합니다. 루나 채팅 분석부터 아티클
          수집, 루나 편집장 선정까지 각 단계의 프롬프트를 여기서 수정할 수 있습니다.
        </p>

        {loading ? (
          <p className="mt-8 text-sm text-[#8e8e8e]">프롬프트를 불러오는 중…</p>
        ) : (
          <div className="mt-6 flex flex-col gap-5">
            <PromptSection
              title="P1 채팅방 루나 프롬프트"
              description="채팅방에서 링크/영상을 분석할 때 루나가 사용하는 기준"
              value={prompts[P1_LUNA_PROMPT_KEY]}
              loading={loading}
              saving={savingKey === P1_LUNA_PROMPT_KEY}
              canEdit={canEdit}
              onChange={(value) =>
                setPrompts((prev) => ({ ...prev, [P1_LUNA_PROMPT_KEY]: value }))
              }
              onSave={() => void handleSave(P1_LUNA_PROMPT_KEY)}
            />

            <PromptSection
              title="P1-1 채팅방 아티클 추출 프롬프트"
              description="위클리 파이프라인에서 채팅방 대화를 분석해 아티클 후보를 추출하는 프롬프트"
              value={prompts[P1_1_ARTICLE_PROMPT_KEY]}
              loading={loading}
              saving={savingKey === P1_1_ARTICLE_PROMPT_KEY}
              canEdit={canEdit}
              onChange={(value) =>
                setPrompts((prev) => ({ ...prev, [P1_1_ARTICLE_PROMPT_KEY]: value }))
              }
              onSave={() => void handleSave(P1_1_ARTICLE_PROMPT_KEY)}
            />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="flex flex-col gap-4">
                <span className="inline-flex w-fit rounded-lg bg-[#534AB7] px-3 py-1 text-xs font-semibold text-white">
                  콘텐츠파트
                </span>
                {renderPromptCards(CONTENT_PROMPT_CARDS)}
                <PartEditorCard
                  description={`콘텐츠파트 프롬프트·발행을 담당할 편집장을 지정합니다. 편집장은 트렌드레이더 중간관리자 이상만 가능합니다. 중간관리자는 슈퍼관리자(${superAdminNames})에게 요청하세요.`}
                  profiles={profiles}
                  selectedUserId={contentEditorId}
                  loading={loading}
                  saving={savingPart === "content"}
                  canEdit={canEdit}
                  onChange={setContentEditorId}
                  onSave={() => void handleSavePartEditor("content")}
                />
              </div>

              <div className="flex flex-col gap-4">
                <span className="inline-flex w-fit rounded-lg bg-[#e8e8e8] px-3 py-1 text-xs font-semibold text-[#676767]">
                  공간파트
                </span>
                {renderPromptCards(SPACE_PROMPT_CARDS)}
                <PartEditorCard
                  description={`공간파트 프롬프트·발행을 담당할 편집장을 지정합니다. 편집장은 트렌드레이더 중간관리자 이상만 가능합니다. 중간관리자는 슈퍼관리자(${superAdminNames})에게 요청하세요.`}
                  profiles={profiles}
                  selectedUserId={spaceEditorId}
                  loading={loading}
                  saving={savingPart === "space"}
                  canEdit={canEdit}
                  onChange={setSpaceEditorId}
                  onSave={() => void handleSavePartEditor("space")}
                />
              </div>
            </div>
          </div>
        )}

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </div>

      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
