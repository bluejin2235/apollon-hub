"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getMeta, getWork, publishWork, publishWorkPreview, setWorkCategories, unhideWork, updateWork, generatePublishNote } from "@/lib/website/api";
import { fillBasic, fillBody, fillFaq, fillRelated, PROBLEM_FLAGS } from "@/lib/website/checks";
import { applyTextDupChecks } from "@/lib/website/text-dup";
import { fallbackChangeNote, firstPublishNote, skipPublishCheck } from "@/lib/website/publish";
import type { WorkSiteVisibility } from "@/lib/website/types";
import {
  WORK_TITLE_EN_MAX
} from "@/lib/website/text-width";
import type { CheckWorks, WebsiteCategory } from "@/lib/website/types";
import {
  draftFromWork,
  formatSavedAt,
  interviewRowOf,
  interviewSectionOf,
  parseEditorTab,
  parseWorkDetail,
  worksPatchFromDraft,
  type EditorTab,
  type WorkBasicDraft,
  type WorkDetail
} from "@/lib/website/work-detail";
import { WorkPublishCheckList, buildWorkCheckItems } from "@/components/website/publish-check-panel";
import { buildVideoBlockCheckItems, findVideoBlockGaps } from "@/lib/website/video-block-check";
import { PublishModal } from "@/components/website/publish-modal";
import type { PartialSaveState } from "@/components/website/partial-save-btn";
import { useWebsitePermissions } from "@/components/website/website-permissions";
import { WorkBasicTab } from "@/components/website/work-basic-tab";
import { WorkContentTab } from "@/components/website/work-content-tab";
import { WorkCreditsTab } from "@/components/website/work-credits-tab";
import { WorkFaqTab } from "@/components/website/work-faq-tab";
import { WorkHistoryTab } from "@/components/website/work-history-tab";
import { WorkInterviewTab } from "@/components/website/work-interview-tab";
import { WorkRelatedTab } from "@/components/website/work-related-tab";
import { showToast } from "@/components/website/toast";
import { isPreviewOpen, openPreview, PREVIEW_POPUP_BLOCKED, refreshPreview } from "@/lib/website/preview-window";

function barBtnClass(opts?: { accent?: boolean; off?: boolean; checkRed?: boolean }) {
  const base =
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[13px]";
  if (opts?.off) {
    return `${base} cursor-default border-slate-200 bg-white text-slate-500 opacity-40`;
  }
  if (opts?.checkRed) {
    return `${base} border-red-200 bg-white text-red-600 hover:bg-red-50`;
  }
  if (opts?.accent) {
    return `${base} border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50`;
  }
  return `${base} border-slate-200 bg-white text-slate-600 hover:bg-slate-50`;
}

function visibilityLabel(v: WorkSiteVisibility) {
  if (v === "live") return "공개";
  if (v === "hidden") return "감춤";
  return "초안";
}

function visibilityClass(v: WorkSiteVisibility) {
  if (v === "live") return "bg-emerald-100 text-emerald-700";
  if (v === "hidden") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

const TABS: { id: EditorTab; label: string }[] = [
  { id: "basic", label: "기본정보" },
  { id: "content", label: "본문" },
  { id: "interview", label: "인터뷰" },
  { id: "credits", label: "크레딧" },
  { id: "faq", label: "FAQ" },
  { id: "related", label: "연결" },
  { id: "history", label: "이력" }
];

function dotClass(state: "ok" | "warn" | "empty") {
  if (state === "ok") return "bg-emerald-500";
  if (state === "warn") return "bg-amber-500";
  return "bg-slate-300";
}

function tabDot(tab: EditorTab, check: CheckWorks | null, work: WorkDetail | null): "ok" | "warn" | "empty" {
  if (tab === "basic") return fillBasic(check);
  if (tab === "content") return fillBody(check);
  if (tab === "interview") {
    const on = Boolean(work && interviewSectionOf(work));
    const has = Boolean(work && interviewRowOf(work)?.insight_id);
    if (on && !has) return "warn";
    if (has) return "ok";
    return "empty";
  }
  if (tab === "credits") {
    return (work?.work_credits?.length ?? 0) > 0 ? "ok" : "empty";
  }
  if (tab === "faq") return fillFaq(check);
  if (tab === "history") {
    return work?.published_version != null ? "ok" : "empty";
  }
  return fillRelated(check);
}

function problemCount(
  check: CheckWorks | null,
  work?: WorkDetail | null,
  draft?: WorkBasicDraft | null,
): number {
  if (!check) return PROBLEM_FLAGS.length;
  let n = PROBLEM_FLAGS.filter((flag) => flag !== "no_card_image" && check[flag]).length;
  const hasCard = Boolean(work?.card_image?.trim() || draft?.card_image?.trim());
  if (!hasCard) n += 1;
  if (work) n += findVideoBlockGaps(work).length;
  return n;
}

function draftLimitProblems(draft: WorkBasicDraft): string[] {
  const issues: string[] = [];
  if (draft.title.en.length > WORK_TITLE_EN_MAX) {
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

function interviewBlocksPublish(work: WorkDetail): boolean {
  return Boolean(interviewSectionOf(work) && !interviewRowOf(work)?.insight_id);
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
  const [fullSaveState, setFullSaveState] = useState<PartialSaveState>("idle");
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishPreviewLoading, setPublishPreviewLoading] = useState(false);
  const [publishChangedFields, setPublishChangedFields] = useState<string[]>([]);
  const [publishFirst, setPublishFirst] = useState(true);
  const [publishNote, setPublishNote] = useState("");
  const [publishNoteLoading, setPublishNoteLoading] = useState(false);
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(false);
  const [previewLive, setPreviewLive] = useState(false);
  const [previewBlocked, setPreviewBlocked] = useState(false);
  const [checkOverride, setCheckOverride] = useState<CheckWorks | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
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
  const canPublish =
    problemCount(check, work, draft) === 0 &&
    limitIssues.length === 0 &&
    !(work && interviewBlocksPublish(work));
  const skipCheck = skipPublishCheck();
  const allowPublish = canPublish || skipCheck;
  const visibility = work?.site_visibility ?? "draft";
  const hasCardImage = Boolean(work?.card_image?.trim() || draft?.card_image?.trim());
  const checkItems =
    work && check
      ? [...buildWorkCheckItems(work, check, { hasCardImage }), ...buildVideoBlockCheckItems(work)]
      : [];
  const problemItems = checkItems.filter((item) => item.kind === "problem");
  const warnItems = checkItems.filter((item) => item.kind === "warn");
  const checkTone: "red" | "yellow" | "green" =
    problemItems.length > 0 ? "red" : warnItems.length > 0 ? "yellow" : "green";
  const saveDirty = fullSaveState === "dirty";
  const publishAccent = checkTone === "green";

  const refreshPublishPreview = useCallback(async () => {
    const preview = await publishWorkPreview(workId);
    if (!preview.ok) return;
    setPublishChangedFields(preview.data.changedFields ?? []);
    setPublishFirst(Boolean(preview.data.firstPublish));
    setHasUnpublishedChanges((preview.data.changedFields ?? []).length > 0);
  }, [workId]);

  useEffect(() => {
    if (!work || work.site_visibility === "draft") {
      setHasUnpublishedChanges(false);
      return;
    }
    void refreshPublishPreview();
  }, [work, refreshPublishPreview]);

  async function loadPublishNote(fields: string[], first: boolean) {
    if (first) {
      setPublishNote(firstPublishNote());
      return;
    }
    setPublishNoteLoading(true);
    try {
      const result = await generatePublishNote(fields);
      setPublishNote(result.note || fallbackChangeNote(fields));
    } finally {
      setPublishNoteLoading(false);
    }
  }

  async function openPublishModal() {
    if (!draft) return;
    setPublishModalOpen(true);
    setPublishPreviewLoading(true);
    setError(null);
    try {
      if (!(await saveAll({ silent: true }))) {
        setPublishModalOpen(false);
        return;
      }
      const preview = await publishWorkPreview(workId);
      if (!preview.ok) {
        if (preview.status === 409 && preview.error === "publish_blocked") {
          setCheckOverride(mergeCheck(work?.check ?? null, preview.details));
        } else {
          setError(preview.error + (preview.details ? ` · ${JSON.stringify(preview.details)}` : ""));
        }
        setPublishModalOpen(false);
        return;
      }
      const fields = preview.data.changedFields ?? [];
      const first = Boolean(preview.data.firstPublish);
      setPublishChangedFields(fields);
      setPublishFirst(first);
      await loadPublishNote(fields, first);
    } finally {
      setPublishPreviewLoading(false);
    }
  }

  const onChangeDraft = useCallback((patch: Partial<WorkBasicDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setFullSaveState((cur) => (cur === "saving" ? cur : "dirty"));
  }, []);

  /**
   * work_categories_map 을 다시 씁니다. 홈페이지 쪽에서 works.category_id 도
   * 첫 번째로 맞춰 주므로, 이어지는 works 패치와 같은 값이 됩니다.
   */
  async function saveCategories(next: WorkBasicDraft) {
    if (next.category_ids.length === 0) {
      setError("사업분야는 최소 하나가 필요합니다");
      return false;
    }

    const result = await setWorkCategories(workId, next.category_ids);
    if (!result.ok) {
      setError(result.error + (result.details ? ` · ${JSON.stringify(result.details)}` : ""));
      return false;
    }

    return true;
  }

  async function saveAll(opts?: { silent?: boolean }) {
    if (!draft) return false;
    setSaving(true);
    setFullSaveState("saving");
    setError(null);
    try {
      if (!(await saveCategories(draft))) {
        setFullSaveState("dirty");
        return false;
      }
      const result = await updateWork(workId, worksPatchFromDraft(draft));
      if (!result.ok) {
        setError(result.error + (result.details ? ` · ${JSON.stringify(result.details)}` : ""));
        setFullSaveState("dirty");
        return false;
      }
      refreshPreview();
      await load();
      await refreshPublishPreview();
      setFullSaveState("saved");
      window.setTimeout(() => setFullSaveState((cur) => (cur === "saved" ? "idle" : cur)), 2000);
      if (!opts?.silent) {
        showToast({ message: "저장되었습니다", tone: "ok", durationMs: 2000 });
      }
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function confirmPublish() {
    if (!draft || !publishNote.trim()) return;
    setSaving(true);
    setError(null);
    cancelPublishNav();
    try {
      if (!(await saveAll({ silent: true }))) return;

      const published = await publishWork(workId, publishNote.trim());
      if (!published.ok) {
        if (published.status === 400 && published.error === "publish_blocked") {
          setCheckOverride(mergeCheck(work?.check ?? null, published.details));
          setPublishModalOpen(false);
          return;
        }
        setError(
          published.error + (published.details ? ` · ${JSON.stringify(published.details)}` : "")
        );
        return;
      }

      const statusPatch = await updateWork(workId, { status: "published" });
      if (!statusPatch.ok) {
        setError(
          statusPatch.error + (statusPatch.details ? ` · ${JSON.stringify(statusPatch.details)}` : "")
        );
        return;
      }

      setPublishModalOpen(false);
      await load();
      await refreshPublishPreview();
      if (isPreviewOpen()) refreshPreview();
      showToast({ message: "공개되었습니다", tone: "ok" });
    } finally {
      setSaving(false);
    }
  }

  async function showOnSiteAgain() {
    setSaving(true);
    setError(null);
    try {
      if (!(await saveAll({ silent: true }))) return;
      const res = await unhideWork(workId);
      if (!res.ok) {
        setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
        return;
      }
      await load();
      await refreshPublishPreview();
      showToast({ message: "다시 공개되었습니다", tone: "ok" });
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
      <p className="mb-1 text-[11px] text-slate-400">
        워크 &nbsp;›&nbsp;{" "}
        <Link href="/website/works" className="hover:text-slate-600">
          프로젝트 목록
        </Link>{" "}
        &nbsp;›&nbsp; 편집
      </p>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-[19px] font-semibold text-slate-900">{titleKo}</h1>
          <span
            className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${visibilityClass(visibility)}`}
          >
            {visibilityLabel(visibility)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={barBtnClass()} onClick={() => void handlePreview()}>
            미리보기 ↗
          </button>
          <button
            type="button"
            className={barBtnClass({ accent: saveDirty, off: !saveDirty })}
            disabled={saving}
            onClick={() => void saveAll()}
          >
            전체 저장
          </button>
          {previewLive ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <i className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              연결됨
            </span>
          ) : null}
        </div>
      </div>
      {previewBlocked ? (
        <p className="mt-1 text-xs text-rose-600">{PREVIEW_POPUP_BLOCKED}</p>
      ) : null}
      <p className="mt-1 text-[11px] text-slate-400">
        마지막 저장 {formatSavedAt(work.updated_at)}
        {visibility === "live" && hasUnpublishedChanges ? (
          <span className="text-amber-700"> · 공개 안 된 변경이 있습니다</span>
        ) : null}
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
              <i className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass(tabDot(item.id, check, work))}`} />
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
        {tab === "interview" ? (
          <WorkInterviewTab work={work} siteUrl={siteUrl} onReload={load} />
        ) : null}
        {tab === "credits" ? <WorkCreditsTab work={work} onReload={load} /> : null}
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
        {tab === "history" ? <WorkHistoryTab workId={work.id} /> : null}
      </div>

      <div className="relative sticky bottom-0 z-20 -mx-4 mt-8 sm:-mx-6 lg:-mx-8">
        {canManageWorks && checkOpen && checkItems.length > 0 ? (
          <div className="absolute bottom-full left-0 right-0 border-t border-slate-200 bg-white">
            <div className="max-h-[40vh] overflow-y-auto px-4 sm:px-6 lg:px-8">
              <WorkPublishCheckList items={checkItems} onGoTab={setTab} overlay />
            </div>
            <div className="-mb-px flex justify-center">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-t-lg border border-b-0 border-slate-200 bg-white px-3.5 pb-1 pt-0.5 text-[11px] text-slate-400 hover:text-slate-600"
                onClick={() => setCheckOpen(false)}
              >
                ▾ 접기
              </button>
            </div>
          </div>
        ) : null}
        <div className="border-t border-slate-200 bg-white px-4 py-3.5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <button type="button" className={barBtnClass()} onClick={() => void handlePreview()}>
              미리보기 ↗
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={barBtnClass({ accent: saveDirty, off: !saveDirty })}
                disabled={saving}
                onClick={() => void saveAll()}
              >
                전체 저장
              </button>
              {canManageWorks ? (
                <button
                  type="button"
                  className={barBtnClass({ checkRed: checkTone === "red" })}
                  aria-label="점검"
                  onClick={() => {
                    if (checkItems.length === 0) return;
                    setCheckOpen((open) => !open);
                  }}
                >
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      checkTone === "red"
                        ? "bg-red-600"
                        : checkTone === "yellow"
                          ? "bg-amber-700"
                          : "bg-emerald-700"
                    }`}
                  />
                  점검
                </button>
              ) : null}
              {canManageWorks && visibility === "hidden" ? (
                <button
                  type="button"
                  className={barBtnClass({ accent: true })}
                  disabled={saving}
                  onClick={() => void showOnSiteAgain()}
                >
                  다시 공개
                </button>
              ) : null}
              {canManageWorks && visibility !== "hidden" ? (
                <button
                  type="button"
                  className={barBtnClass({
                    accent: publishAccent,
                    off: !allowPublish
                  })}
                  disabled={!allowPublish || saving}
                  onClick={() => void openPublishModal()}
                >
                  공개
                </button>
              ) : null}
            </div>
          </div>
          {skipCheck ? (
            <p className="mt-2 text-[11px] text-amber-700">
              개발 중 · 점검을 건너뛰고 공개할 수 있습니다
            </p>
          ) : null}
        </div>
      </div>

      <PublishModal
        open={publishModalOpen}
        loading={publishPreviewLoading}
        publishing={saving}
        changedFields={publishChangedFields}
        firstPublish={publishFirst}
        note={publishNote}
        noteLoading={publishNoteLoading}
        checkSkipWarning={skipCheck && !canPublish}
        onNoteChange={setPublishNote}
        onClose={() => setPublishModalOpen(false)}
        onConfirm={() => void confirmPublish()}
        onRegenerate={() => void loadPublishNote(publishChangedFields, publishFirst)}
      />
    </div>
  );
}
