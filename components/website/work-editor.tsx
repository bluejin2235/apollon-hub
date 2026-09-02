"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getMeta, getWork, setWorkCategories, updateWork } from "@/lib/website/api";
import { fillBasic, fillBody, fillFaq, fillRelated, PROBLEM_FLAGS } from "@/lib/website/checks";
import { applyTextDupChecks } from "@/lib/website/text-dup";
import {
  overTextWidth,
  textWidth,
  WORK_TITLE_EN_MAX,
  WORK_TITLE_KO_MAX
} from "@/lib/website/text-width";
import type { CheckWorks, WebsiteCategory } from "@/lib/website/types";
import {
  countAiUnconfirmed,
  draftFromWork,
  formatSavedAt,
  parseEditorTab,
  parseWorkDetail,
  worksPatchFromDraft,
  type EditorTab,
  type WorkBasicDraft,
  type WorkDetail
} from "@/lib/website/work-detail";
import { PublishCheckPanel } from "@/components/website/publish-check-panel";
import { useWebsitePermissions } from "@/components/website/website-permissions";
import { WorkBasicTab } from "@/components/website/work-basic-tab";
import { WorkContentTab } from "@/components/website/work-content-tab";
import { WorkFaqTab } from "@/components/website/work-faq-tab";
import { WorkRelatedTab } from "@/components/website/work-related-tab";
import { GhostBtn, PreviewBarBtn, PrimaryBtn } from "@/components/website/work-editor-ui";
import { HomePublishNotice } from "@/components/website/home-publish-notice";
import { showToast } from "@/components/website/toast";
import { isPreviewOpen, openPreview, PREVIEW_POPUP_BLOCKED, refreshPreview } from "@/lib/website/preview-window";

const TABS: { id: EditorTab; label: string }[] = [
  { id: "basic", label: "기본정보" },
  { id: "content", label: "본문" },
  { id: "faq", label: "FAQ" },
  { id: "related", label: "연결" }
];

function dotClass(state: "ok" | "warn" | "empty") {
  if (state === "ok") return "bg-emerald-500";
  if (state === "warn") return "bg-amber-500";
  return "bg-slate-300";
}

function tabDot(tab: EditorTab, check: CheckWorks | null): "ok" | "warn" | "empty" {
  if (tab === "basic") return fillBasic(check);
  if (tab === "content") return fillBody(check);
  if (tab === "faq") return fillFaq(check);
  return fillRelated(check);
}

function problemCount(check: CheckWorks | null): number {
  if (!check) return PROBLEM_FLAGS.length;
  return PROBLEM_FLAGS.filter((flag) => check[flag]).length;
}

function draftLimitProblems(draft: WorkBasicDraft): string[] {
  const issues: string[] = [];
  if (draft.title.ko.trim() && overTextWidth(draft.title.ko, WORK_TITLE_KO_MAX)) {
    issues.push("국문이 너무 깁니다. 목록 카드에서 여러 줄이 됩니다");
  }
  if (textWidth(draft.title.en) > WORK_TITLE_EN_MAX) {
    issues.push("영문이 너무 깁니다. 목록 카드에서 여러 줄이 됩니다");
  }
  if (draft.summary.ko.trim() && draft.summary.ko.length > 80) {
    issues.push("한 줄 요약이 80자를 넘습니다");
  }
  if (draft.summary.en.length > 155) {
    issues.push("영문 요약이 155자를 넘습니다");
  }
  return issues;
}

function mergeCheck(check: CheckWorks | null, details: unknown): CheckWorks | null {
  if (!check || !details || typeof details !== "object") return check;
  const next = { ...check };
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (value === true && key in next) {
      (next as Record<string, unknown>)[key] = true;
    }
  }
  return next;
}

function shortageLine(
  work: WorkDetail,
  check: CheckWorks | null,
  draft: WorkBasicDraft | null
): { text: string; ok: boolean } {
  const limits = draft ? draftLimitProblems(draft) : [];
  const problems = problemCount(check) + limits.length;
  if (problems > 0) {
    const extra = limits[0] ? ` — ${limits[0]}` : "";
    return { text: `공개하려면 ${problems}가지가 더 필요합니다${extra}`, ok: false };
  }
  if (check?.ai_unconfirmed) {
    const n = countAiUnconfirmed(work);
    return {
      text: n > 0 ? `AI가 만든 캡션 ${n}개가 확인 전입니다` : "AI가 만든 캡션이 확인 전입니다",
      ok: false
    };
  }
  if (check?.faq_on_but_empty) {
    return { text: "FAQ가 비어 있습니다", ok: false };
  }
  const related = work.content_related?.length ?? 0;
  if (related > 0) {
    return { text: `관련 콘텐츠 ${related}개 지정됨`, ok: true };
  }
  const faqs = work.faqs?.length ?? 0;
  if (faqs > 0) {
    return { text: `FAQ ${faqs}문항 입력됨`, ok: true };
  }
  return { text: "등록할 수 있습니다", ok: true };
}

export function WorkEditor({ workId, siteUrl }: { workId: string; siteUrl: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseEditorTab(searchParams.get("tab"));
  const { canManageWorks } = useWebsitePermissions();

  const [work, setWork] = useState<WorkDetail | null>(null);
  const [draft, setDraft] = useState<WorkBasicDraft | null>(null);
  const [categories, setCategories] = useState<WebsiteCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [previewLive, setPreviewLive] = useState(false);
  const [previewBlocked, setPreviewBlocked] = useState(false);
  const [checkOverride, setCheckOverride] = useState<CheckWorks | null>(null);
  const [homeNotice, setHomeNotice] = useState(false);
  const publishNavTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [workRes, metaRes] = await Promise.all([getWork(workId), getMeta()]);
      if (!workRes.ok) {
        setError(workRes.error + (workRes.details ? ` · ${JSON.stringify(workRes.details)}` : ""));
        return;
      }
      const parsed = parseWorkDetail(workRes.data);
      if (!parsed) {
        setError("work_not_found");
        return;
      }
      setWork(parsed);
      setDraft(draftFromWork(parsed));
      setCheckOverride(null);
      if (metaRes.ok) setCategories(metaRes.data.workCategories ?? []);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPreviewLive(isPreviewOpen());
    const timer = window.setInterval(() => {
      setPreviewLive(isPreviewOpen());
    }, 2000);
    return () => {
      window.clearInterval(timer);
      if (publishNavTimer.current) window.clearTimeout(publishNavTimer.current);
    };
  }, []);

  const cancelPublishNav = useCallback(() => {
    if (publishNavTimer.current) {
      window.clearTimeout(publishNavTimer.current);
      publishNavTimer.current = null;
    }
  }, []);

  const setTab = useCallback(
    (next: EditorTab) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("tab", next);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const rawCheck = checkOverride ?? work?.check ?? null;
  const check = work && rawCheck ? applyTextDupChecks(work, rawCheck) : rawCheck;
  const limitIssues = draft ? draftLimitProblems(draft) : [];
  const canPublish = problemCount(check) === 0 && limitIssues.length === 0;
  const shortage = work ? shortageLine(work, check, draft) : null;

  const onChangeDraft = useCallback((patch: Partial<WorkBasicDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  async function saveTemp() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updateWork(workId, worksPatchFromDraft(draft));
      if (!result.ok) {
        setError(result.error + (result.details ? ` · ${JSON.stringify(result.details)}` : ""));
        return;
      }
      refreshPreview();
      await load();
      showToast({ message: "저장되었습니다", tone: "ok", durationMs: 2000 });
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    cancelPublishNav();
    try {
      const result = await updateWork(workId, {
        ...worksPatchFromDraft(draft),
        status: "published"
      });
      if (!result.ok) {
        if (result.status === 409 && result.error === "publish_blocked") {
          setCheckOverride(mergeCheck(work?.check ?? null, result.details));
          setPanelOpen(true);
          return;
        }
        setError(result.error + (result.details ? ` · ${JSON.stringify(result.details)}` : ""));
        return;
      }
      setPanelOpen(false);
      await load();
      if (isPreviewOpen()) refreshPreview();

      setHomeNotice(true);
    } finally {
      setSaving(false);
    }
  }

  async function toggleFaq(next: boolean) {
    setSaving(true);
    try {
      const result = await updateWork(workId, { show_faq: next });
      if (!result.ok) {
        setError(result.error + (result.details ? ` · ${JSON.stringify(result.details)}` : ""));
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">불러오는 중...</p>;
  }
  if (!work || !draft) {
    return <p className="text-sm text-rose-600">{error ?? "work_not_found"}</p>;
  }

  async function handlePreview() {
    setPreviewBlocked(false);
    try {
      const ok = await openPreview({ workId });
      if (!ok) {
        setPreviewBlocked(true);
        return;
      }
      setPreviewLive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "preview_failed");
    }
  }

  const titleKo = draft.title.ko.trim() || work.slug;

  return (
    <div className="relative pb-28">
      <p className="mb-1 text-slate-400" style={{ fontSize: "var(--fs-caption)" }}>
        워크 &nbsp;›&nbsp;{" "}
        <Link href="/website/works" className="hover:text-slate-600">
          프로젝트 목록
        </Link>{" "}
        &nbsp;›&nbsp; 편집
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-bold text-slate-900" style={{ fontSize: "var(--fs-title)" }}>
          {titleKo}
        </h1>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
            work.status === "published"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {work.status === "published" ? "공개" : "초안"}
        </span>
        <span className="flex-1" />
        <PreviewBarBtn onClick={() => void handlePreview()} />
        {previewLive ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
            <i className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            연결됨
          </span>
        ) : null}
      </div>
      {previewBlocked ? (
        <p className="mt-1 text-xs text-rose-600">{PREVIEW_POPUP_BLOCKED}</p>
      ) : null}
      <p className="mt-1 text-slate-400" style={{ fontSize: "var(--fs-caption)" }}>
        마지막 저장 {formatSavedAt(work.updated_at)}
      </p>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

      <div className="mt-4 flex gap-0.5 overflow-x-auto border-b border-slate-200">
        {TABS.map((item) => {
          const on = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`-mb-px inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border px-3.5 py-2 text-sm ${
                on
                  ? "border-slate-200 border-b-white bg-white font-bold text-slate-900"
                  : "border-transparent text-slate-500"
              }`}
            >
              <i className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass(tabDot(item.id, check))}`} />
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="pt-5">
        {tab === "basic" ? (
          <WorkBasicTab
            draft={draft}
            onChange={onChangeDraft}
            work={work}
            categories={categories}
            siteUrl={siteUrl}
            onReload={load}
          />
        ) : null}
        {tab === "content" ? (
          <WorkContentTab work={work} siteUrl={siteUrl} onReload={load} />
        ) : null}
        {tab === "faq" ? (
          <WorkFaqTab
            work={work}
            saving={saving}
            onToggleShowFaq={(next) => void toggleFaq(next)}
            onReload={load}
          />
        ) : null}
        {tab === "related" ? (
          <WorkRelatedTab work={work} siteUrl={siteUrl} onReload={load} />
        ) : null}
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 mt-8 border-t border-slate-200 bg-white px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={`min-w-[180px] flex-1 text-sm ${shortage?.ok ? "text-emerald-600" : "text-amber-600"}`}
          >
            {shortage?.text}
          </p>
          <PreviewBarBtn onClick={() => void handlePreview()} />
          <GhostBtn disabled={saving} onClick={() => void saveTemp()}>
            임시 저장
          </GhostBtn>
          {canManageWorks ? (
            <>
              <GhostBtn onClick={() => setPanelOpen(true)}>공개 전 점검</GhostBtn>
              <PrimaryBtn disabled={!canPublish || saving} onClick={() => void publish()}>
                등록하기
              </PrimaryBtn>
            </>
          ) : null}
        </div>
      </div>

      {canManageWorks && panelOpen ? (
        <PublishCheckPanel
          work={work}
          check={applyTextDupChecks(
            work,
            check ?? {
              id: work.id,
              slug: work.slug,
              title_ko: work.title?.ko ?? null,
              status: work.status,
              missing_summary_en: false,
              missing_key_alt: false,
              no_key_image: false,
              key_image_size_unknown: false,
              key_image_not_16_9: false,
              not_16_9: false,
              key_image_too_small: false,
              body_image_too_small: false,
              empty_blocks: false,
              no_sections: false,
              missing_image_alt: false,
              ai_unconfirmed: false,
              no_small_loop: false,
              faq_on_but_empty: false,
              too_many_anchors: false,
              no_tags: false,
              no_related: false,
              no_internal_folder: false,
              summary_too_long: false,
              duplicate_captions: false,
              duplicate_alts: false,
              image_count: 0,
              caption_count: 0
            }
          )}
          canPublish={canPublish}
          publishing={saving}
          onClose={() => setPanelOpen(false)}
          onGoTab={(next) => {
            setTab(next);
            setPanelOpen(false);
          }}
          onPublish={() => void publish()}
        />
      ) : null}
      <HomePublishNotice open={homeNotice} kind="워크" onClose={() => setHomeNotice(false)} />
    </div>
  );
}
