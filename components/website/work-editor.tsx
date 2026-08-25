"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getMeta, getWork, updateWork } from "@/lib/website/api";
import { fillBasic, fillBody, fillFaq, fillRelated, PROBLEM_FLAGS } from "@/lib/website/checks";
import type { CheckWorks, WebsiteCategory } from "@/lib/website/types";
import {
  countAiUnconfirmed,
  draftFromWork,
  formatSavedAt,
  parseEditorTab,
  parseWorkDetail,
  todayYmd,
  worksPatchFromDraft,
  type EditorTab,
  type WorkBasicDraft,
  type WorkDetail
} from "@/lib/website/work-detail";
import { PublishCheckPanel } from "@/components/website/publish-check-panel";
import { WorkBasicTab } from "@/components/website/work-basic-tab";
import { WorkContentTab } from "@/components/website/work-content-tab";
import { WorkFaqTab } from "@/components/website/work-faq-tab";
import { WorkRelatedTab } from "@/components/website/work-related-tab";
import { GhostBtn, PrimaryBtn } from "@/components/website/work-editor-ui";

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

function shortageLine(work: WorkDetail, check: CheckWorks | null): { text: string; ok: boolean } {
  const problems = problemCount(check);
  if (problems > 0) {
    return { text: `공개하려면 ${problems}가지가 더 필요합니다`, ok: false };
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

  const [work, setWork] = useState<WorkDetail | null>(null);
  const [draft, setDraft] = useState<WorkBasicDraft | null>(null);
  const [categories, setCategories] = useState<WebsiteCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [checkOverride, setCheckOverride] = useState<CheckWorks | null>(null);

  const load = useCallback(async () => {
    const [workRes, metaRes] = await Promise.all([getWork(workId), getMeta()]);
    if (!workRes.ok) {
      setError(workRes.error + (workRes.details ? ` · ${JSON.stringify(workRes.details)}` : ""));
      setLoading(false);
      return;
    }
    const parsed = parseWorkDetail(workRes.data);
    if (!parsed) {
      setError("work_not_found");
      setLoading(false);
      return;
    }
    setWork(parsed);
    setDraft(draftFromWork(parsed));
    setCheckOverride(null);
    if (metaRes.ok) setCategories(metaRes.data.workCategories ?? []);
    setError(null);
    setLoading(false);
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setTab = useCallback(
    (next: EditorTab) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("tab", next);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const check = checkOverride ?? work?.check ?? null;
  const canPublish = problemCount(check) === 0;
  const previewHref = siteUrl ? `${siteUrl.replace(/\/$/, "")}/preview/works/${workId}` : "";
  const shortage = work ? shortageLine(work, check) : null;

  const onChangeDraft = useCallback((patch: Partial<WorkBasicDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  async function saveTemp() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const result = await updateWork(workId, worksPatchFromDraft(draft));
    setSaving(false);
    if (!result.ok) {
      setError(result.error + (result.details ? ` · ${JSON.stringify(result.details)}` : ""));
      return;
    }
    await load();
  }

  async function publish() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const result = await updateWork(workId, {
      ...worksPatchFromDraft(draft),
      status: "published",
      published_at: todayYmd()
    });
    setSaving(false);
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
  }

  async function toggleFaq(next: boolean) {
    setSaving(true);
    const result = await updateWork(workId, { show_faq: next });
    setSaving(false);
    if (!result.ok) {
      setError(result.error + (result.details ? ` · ${JSON.stringify(result.details)}` : ""));
      return;
    }
    await load();
  }

  if (loading) {
    return <p className="text-sm text-slate-500">불러오는 중...</p>;
  }
  if (!work || !draft) {
    return <p className="text-sm text-rose-600">{error ?? "work_not_found"}</p>;
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
        {previewHref ? (
          <a
            href={previewHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            미리보기 ↗
          </a>
        ) : (
          <GhostBtn disabled>미리보기 ↗</GhostBtn>
        )}
      </div>
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
          />
        ) : null}
        {tab === "content" ? (
          <WorkContentTab work={work} siteUrl={siteUrl} onReload={load} />
        ) : null}
        {tab === "faq" ? (
          <WorkFaqTab work={work} saving={saving} onToggleShowFaq={(next) => void toggleFaq(next)} />
        ) : null}
        {tab === "related" ? <WorkRelatedTab work={work} /> : null}
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 mt-8 border-t border-slate-200 bg-white px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={`min-w-[180px] flex-1 text-sm ${shortage?.ok ? "text-emerald-600" : "text-amber-600"}`}
          >
            {shortage?.text}
          </p>
          {previewHref ? (
            <a
              href={previewHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              미리보기 ↗
            </a>
          ) : (
            <GhostBtn disabled>미리보기 ↗</GhostBtn>
          )}
          <GhostBtn disabled={saving} onClick={() => void saveTemp()}>
            임시 저장
          </GhostBtn>
          <GhostBtn onClick={() => setPanelOpen(true)}>공개 전 점검</GhostBtn>
          <PrimaryBtn disabled={!canPublish || saving} onClick={() => void publish()}>
            등록하기
          </PrimaryBtn>
        </div>
      </div>

      {panelOpen ? (
        <PublishCheckPanel
          work={work}
          check={
            check ?? {
              id: work.id,
              slug: work.slug,
              title_ko: work.title?.ko ?? null,
              status: work.status,
              missing_summary_en: false,
              missing_key_alt: false,
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
              image_count: 0,
              caption_count: 0
            }
          }
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
    </div>
  );
}
