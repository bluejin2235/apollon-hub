"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  generatePublishNote,
  getInsight,
  getMeta,
  publishInsight,
  publishInsightPreview,
  unhideInsight,
  updateInsight
} from "@/lib/website/api";
import {
  fillInsightBasic,
  fillInsightBody,
  fillInsightRelated,
  INSIGHT_CHECK_LABEL,
  INSIGHT_PROBLEM_FLAGS
} from "@/lib/website/checks";
import { fallbackChangeNote, firstPublishNote, skipPublishCheck } from "@/lib/website/publish";
import type { CheckInsights, WebsiteCategory, WorkSiteVisibility } from "@/lib/website/types";
import {
  draftFromInsight,
  insightPatchFromDraft,
  parseInsightDetail,
  parseInsightEditorTab,
  type InsightBasicDraft,
  type InsightDetail,
  type InsightEditorTab
} from "@/lib/website/insight-detail";
import { formatSavedAt } from "@/lib/website/work-detail";
import { InsightBasicTab } from "@/components/website/insight-basic-tab";
import { InsightContentTab } from "@/components/website/insight-content-tab";
import {
  buildInsightCheckItems,
  findMissingInsightImageAlts,
  InsightPublishCheckList,
  type InsightCheckItem
} from "@/components/website/insight-publish-check-panel";
import { InsightRelatedTab } from "@/components/website/insight-related-tab";
import { WorkHistoryTab } from "@/components/website/work-history-tab";
import { PublishModal } from "@/components/website/publish-modal";
import { ConfirmDialog } from "@/components/website/confirm-dialog";
import { useWebsitePermissions } from "@/components/website/website-permissions";
import { showToast } from "@/components/website/toast";
import {
  isPreviewOpen,
  openPreview,
  PREVIEW_POPUP_BLOCKED,
  refreshPreview
} from "@/lib/website/preview-window";
import type { PartialSaveState } from "@/components/website/partial-save-btn";

const TABS: { id: InsightEditorTab; label: string }[] = [
  { id: "basic", label: "기본정보" },
  { id: "content", label: "본문" },
  { id: "related", label: "연결" },
  { id: "history", label: "이력" }
];

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

function dotClass(state: "ok" | "warn" | "empty") {
  if (state === "ok") return "bg-emerald-500";
  if (state === "warn") return "bg-amber-500";
  return "bg-slate-300";
}

function tabDot(tab: InsightEditorTab, check: CheckInsights | null): "ok" | "warn" | "empty" {
  if (tab === "basic") return fillInsightBasic(check);
  if (tab === "content") return fillInsightBody(check);
  if (tab === "related") return fillInsightRelated(check);
  return "ok";
}

function problemCount(check: CheckInsights | null): number {
  if (!check) return INSIGHT_PROBLEM_FLAGS.length;
  return INSIGHT_PROBLEM_FLAGS.filter((flag) => Boolean(check[flag])).length;
}

function mergeCheck(check: CheckInsights | null, details: unknown): CheckInsights | null {
  if (!check || !details || typeof details !== "object") return check;
  const next = { ...check };
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (value === true && key in next) {
      (next as Record<string, unknown>)[key] = true;
    }
  }
  return next;
}

function blockerFlags(details: unknown): string[] {
  if (!details || typeof details !== "object") return [];
  return Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}

function isPublishBlocked(error: string): boolean {
  return error === "publish_blocked" || error.startsWith("publish_blocked");
}

/** 점검 차단 사유 — 코드·JSON 대신 위치 문구 */
function publishBlockedMessage(details: unknown, insight: InsightDetail | null): string {
  const flags = blockerFlags(details);
  if (flags.includes("missing_image_alt") && insight) {
    const spots = findMissingInsightImageAlts(insight);
    if (spots.length === 1) {
      return `${spots[0]!.label}에 대체 텍스트가 없습니다`;
    }
    if (spots.length > 1) {
      return `${spots[0]!.label}에 대체 텍스트가 없습니다 · 외 ${spots.length - 1}곳`;
    }
  }
  const labels = flags.map(
    (flag) => INSIGHT_CHECK_LABEL[flag as keyof typeof INSIGHT_CHECK_LABEL] ?? flag
  );
  return labels.length > 0 ? labels.join(" · ") : "공개할 수 없습니다";
}

function formatPublishApiError(
  error: string,
  details: unknown,
  insight: InsightDetail | null
): string {
  if (isPublishBlocked(error)) {
    return publishBlockedMessage(details, insight);
  }
  if (details && typeof details === "object" && "message" in details) {
    const message = (details as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return `${error} · ${message}`;
    }
  }
  return error;
}

export function InsightEditor({ insightId, siteUrl }: { insightId: string; siteUrl: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseInsightEditorTab(searchParams.get("tab"));
  const { canManageWorks } = useWebsitePermissions();

  const [insight, setInsight] = useState<InsightDetail | null>(null);
  const [draft, setDraft] = useState<InsightBasicDraft | null>(null);
  const [categories, setCategories] = useState<WebsiteCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullSaveState, setFullSaveState] = useState<PartialSaveState>("idle");
  const [checkOverride, setCheckOverride] = useState<CheckInsights | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishPreviewLoading, setPublishPreviewLoading] = useState(false);
  const [publishChangedFields, setPublishChangedFields] = useState<string[]>([]);
  const [publishFirst, setPublishFirst] = useState(false);
  const [publishNote, setPublishNote] = useState("");
  const [publishNoteLoading, setPublishNoteLoading] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const [saveBeforePublishOpen, setSaveBeforePublishOpen] = useState(false);
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(false);
  const [previewBlocked, setPreviewBlocked] = useState(false);
  const [previewLive, setPreviewLive] = useState(false);
  const publishNavTimer = useRef<number | null>(null);

  const load = useCallback(async (): Promise<InsightDetail | null> => {
    try {
      const [insightRes, metaRes] = await Promise.all([getInsight(insightId), getMeta()]);
      if (!insightRes.ok) {
        setError(insightRes.error + (insightRes.details ? ` · ${JSON.stringify(insightRes.details)}` : ""));
        return null;
      }
      const parsed = parseInsightDetail(insightRes.data);
      if (!parsed) {
        setError("insight_not_found");
        return null;
      }
      setInsight(parsed);
      setDraft(draftFromInsight(parsed));
      setCheckOverride(null);
      if (metaRes.ok) setCategories(metaRes.data.insightCategories ?? []);
      setError(null);
      return parsed;
    } finally {
      setLoading(false);
    }
  }, [insightId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
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
    (next: InsightEditorTab) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("tab", next);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const rawCheck = checkOverride ?? insight?.check ?? null;
  const check = rawCheck;
  const canPublish = problemCount(check) === 0;
  const skipCheck = skipPublishCheck();
  const allowPublish = skipCheck || canPublish;
  const visibility = insight?.site_visibility ?? "draft";
  const checkItems =
    insight && check ? buildInsightCheckItems(insight, check) : [];
  const problemItems = checkItems.filter((item) => item.kind === "problem");
  const warnItems = checkItems.filter((item) => item.kind === "warn");
  const checkTone: "red" | "yellow" | "green" =
    problemItems.length > 0 ? "red" : warnItems.length > 0 ? "yellow" : "green";
  const saveDirty = fullSaveState === "dirty";
  const publishAccent = checkTone === "green";
  const hasLocalUnsaved = saveDirty;

  const refreshPublishPreview = useCallback(async () => {
    const preview = await publishInsightPreview(insightId);
    if (!preview.ok) return;
    setPublishChangedFields(preview.data.changedFields ?? []);
    setPublishFirst(Boolean(preview.data.firstPublish));
    setHasUnpublishedChanges((preview.data.changedFields ?? []).length > 0);
  }, [insightId]);

  useEffect(() => {
    if (!insight || insight.site_visibility === "draft") {
      setHasUnpublishedChanges(false);
      return;
    }
    void refreshPublishPreview();
  }, [insight, refreshPublishPreview]);

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

  async function handlePreview() {
    setPreviewBlocked(false);
    try {
      const opened = await openPreview({ insightId, locale: "ko" });
      setPreviewLive(opened);
      if (!opened) setPreviewBlocked(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "미리보기를 열지 못했습니다");
    }
  }

  async function saveAll(opts?: { silent?: boolean; keepSaving?: boolean }): Promise<InsightDetail | null> {
    if (!draft) return null;
    setSaving(true);
    setFullSaveState("saving");
    setError(null);
    try {
      const result = await updateInsight(insightId, insightPatchFromDraft(draft));
      if (!result.ok) {
        setError(result.error + (result.details ? ` · ${JSON.stringify(result.details)}` : ""));
        setFullSaveState("dirty");
        return null;
      }
      refreshPreview();
      const fresh = await load();
      await refreshPublishPreview();
      setFullSaveState("saved");
      window.setTimeout(() => setFullSaveState((cur) => (cur === "saved" ? "idle" : cur)), 2000);
      if (!opts?.silent) {
        showToast({ message: "저장되었습니다", tone: "ok", durationMs: 2000 });
      }
      return fresh;
    } finally {
      if (!opts?.keepSaving) setSaving(false);
    }
  }

  async function proceedOpenPublishModal() {
    if (!draft) return;
    setPublishModalOpen(true);
    setPublishPreviewLoading(true);
    setPublishError(null);
    setError(null);
    try {
      const fresh = await saveAll({ silent: true });
      if (!fresh) {
        setPublishError("저장에 실패했습니다. 다시 시도해 주세요.");
        return;
      }
      const preview = await publishInsightPreview(insightId);
      if (!preview.ok) {
        if (isPublishBlocked(preview.error) || blockerFlags(preview.details).length > 0) {
          setCheckOverride(mergeCheck(fresh.check ?? null, preview.details));
          setPublishError(publishBlockedMessage(preview.details, fresh));
          setCheckOpen(true);
          return;
        }
        setPublishError(formatPublishApiError(preview.error, preview.details, fresh));
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

  async function openPublishModal() {
    if (!draft) return;
    if (hasLocalUnsaved) {
      setSaveBeforePublishOpen(true);
      return;
    }
    await proceedOpenPublishModal();
  }

  async function confirmSaveBeforePublish() {
    setSaveBeforePublishOpen(false);
    if (!(await saveAll({ silent: true }))) return;
    await proceedOpenPublishModal();
  }

  const onChangeDraft = useCallback((patch: Partial<InsightBasicDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setFullSaveState((cur) => (cur === "saving" ? cur : "dirty"));
  }, []);

  async function confirmPublish() {
    if (!draft || !publishNote.trim()) return;
    setSaving(true);
    setError(null);
    setPublishError(null);
    cancelPublishNav();
    try {
      const fresh = await saveAll({ silent: true, keepSaving: true });
      if (!fresh) {
        setPublishError("저장에 실패했습니다. 다시 시도해 주세요.");
        return;
      }

      const published = await publishInsight(insightId, publishNote.trim());
      if (!published.ok) {
        if (isPublishBlocked(published.error) || blockerFlags(published.details).length > 0) {
          setCheckOverride(mergeCheck(fresh.check ?? null, published.details));
          setPublishError(publishBlockedMessage(published.details, fresh));
          setCheckOpen(true);
          return;
        }
        setPublishError(formatPublishApiError(published.error, published.details, fresh));
        return;
      }

      // 스냅샷이 올라간 뒤에는 성공으로 보고 팝업을 닫는다 (상태 패치 실패와 분리)
      setPublishModalOpen(false);
      setPublishError(null);

      const statusPatch = await updateInsight(insightId, { status: "published" });
      if (!statusPatch.ok) {
        if (isPublishBlocked(statusPatch.error) || blockerFlags(statusPatch.details).length > 0) {
          setCheckOverride(mergeCheck(fresh.check ?? null, statusPatch.details));
          setCheckOpen(true);
          setError(publishBlockedMessage(statusPatch.details, fresh));
        } else {
          setError(formatPublishApiError(statusPatch.error, statusPatch.details, fresh));
        }
        await load();
        await refreshPublishPreview();
        if (isPreviewOpen()) refreshPreview();
        showToast({ message: "공개되었습니다", tone: "ok" });
        return;
      }

      await load();
      await refreshPublishPreview();
      if (isPreviewOpen()) refreshPreview();
      showToast({ message: "공개되었습니다", tone: "ok" });
    } finally {
      setSaving(false);
    }
  }

  function goCheckItem(item: InsightCheckItem) {
    setCheckOpen(false);
    setTab(item.tab);
    if (item.blockId) {
      // 같은 블록을 다시 「가기」해도 스크롤되도록 한 번 비운다
      setFocusBlockId(null);
      window.setTimeout(() => setFocusBlockId(item.blockId!), 0);
    }
  }

  async function showOnSiteAgain() {
    setSaving(true);
    setError(null);
    try {
      if (!(await saveAll({ silent: true }))) return;
      const res = await unhideInsight(insightId);
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

  if (loading) {
    return <p className="text-sm text-slate-500">불러오는 중...</p>;
  }
  if (!insight || !draft) {
    return <p className="text-sm text-rose-600">{error ?? "insight_not_found"}</p>;
  }

  const titleKo = draft.title.ko.trim() || insight.slug;

  return (
    <div className="relative pb-28">
      <p className="mb-1 text-[11px] text-slate-400">
        인사이트 &nbsp;›&nbsp;{" "}
        <Link href="/website/insights" className="hover:text-slate-600">
          글 목록
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
        마지막 저장 {formatSavedAt(insight.updated_at)}
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
              <i className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass(tabDot(item.id, check))}`} />
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="pt-5">
        {tab === "basic" ? (
          <InsightBasicTab
            draft={draft}
            onChange={onChangeDraft}
            insight={insight}
            categories={categories}
            siteUrl={siteUrl}
            onReload={async () => {
              await load();
            }}
          />
        ) : null}
        {tab === "content" ? (
          <InsightContentTab
            insight={insight}
            siteUrl={siteUrl}
            onReload={async () => {
              await load();
            }}
            focusBlockId={focusBlockId}
            onFocusConsumed={() => setFocusBlockId(null)}
          />
        ) : null}
        {tab === "related" ? (
          <InsightRelatedTab
            insight={insight}
            siteUrl={siteUrl}
            onReload={async () => {
              await load();
            }}
          />
        ) : null}
        {tab === "history" ? (
          <WorkHistoryTab workId={insight.id} contentType="insight" />
        ) : null}
      </div>

      <div className="relative sticky bottom-0 z-20 -mx-4 mt-8 sm:-mx-6 lg:-mx-8">
        {canManageWorks && checkOpen && checkItems.length > 0 ? (
          <div className="absolute bottom-full left-0 right-0 border-t border-slate-200 bg-white">
            <div className="max-h-[40vh] overflow-y-auto px-4 sm:px-6 lg:px-8">
              <InsightPublishCheckList items={checkItems} onGo={goCheckItem} overlay />
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

      <ConfirmDialog
        open={saveBeforePublishOpen}
        title="저장하지 않은 변경이 있습니다. 저장하고 공개할까요?"
        confirmText="저장하고 공개"
        onConfirm={() => void confirmSaveBeforePublish()}
        onCancel={() => setSaveBeforePublishOpen(false)}
        description={
          <p>
            화면에만 있는 글자는 공개에 들어가지 않습니다. 먼저 저장한 뒤 공개 화면을 엽니다.
          </p>
        }
      />

      <PublishModal
        open={publishModalOpen}
        loading={publishPreviewLoading}
        publishing={saving}
        changedFields={publishChangedFields}
        firstPublish={publishFirst}
        note={publishNote}
        noteLoading={publishNoteLoading}
        checkSkipWarning={skipCheck && !canPublish}
        error={publishError}
        onNoteChange={setPublishNote}
        onClose={() => {
          setPublishModalOpen(false);
          setPublishError(null);
        }}
        onConfirm={() => void confirmPublish()}
        onRegenerate={() => void loadPublishNote(publishChangedFields, publishFirst)}
      />
    </div>
  );
}
