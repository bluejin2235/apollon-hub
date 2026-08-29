"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getInsight, getMeta, updateInsight } from "@/lib/website/api";
import {
  fillInsightBasic,
  fillInsightBody,
  fillInsightRelated,
  INSIGHT_PROBLEM_FLAGS
} from "@/lib/website/checks";
import type { CheckInsights, WebsiteCategory } from "@/lib/website/types";
import {
  countInsightAiUnconfirmed,
  draftFromInsight,
  emptyInsightCheck,
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
import { InsightPublishCheckPanel } from "@/components/website/insight-publish-check-panel";
import { InsightRelatedTab } from "@/components/website/insight-related-tab";
import { useWebsitePermissions } from "@/components/website/website-permissions";
import { GhostBtn, PrimaryBtn } from "@/components/website/work-editor-ui";
import { showToast } from "@/components/website/toast";

const PUBLISH_REDIRECT_KEY = "website-publish-toast";

function websiteOrigin() {
  const raw = process.env.NEXT_PUBLIC_WEBSITE_ORIGIN?.trim() || "http://localhost:3100";
  return raw.replace(/\/$/, "");
}

const TABS: { id: InsightEditorTab; label: string }[] = [
  { id: "basic", label: "기본정보" },
  { id: "content", label: "본문" },
  { id: "related", label: "연결" }
];

function dotClass(state: "ok" | "warn" | "empty") {
  if (state === "ok") return "bg-emerald-500";
  if (state === "warn") return "bg-amber-500";
  return "bg-slate-300";
}

function tabDot(tab: InsightEditorTab, check: CheckInsights | null): "ok" | "warn" | "empty" {
  if (tab === "basic") return fillInsightBasic(check);
  if (tab === "content") return fillInsightBody(check);
  return fillInsightRelated(check);
}

function problemCount(check: CheckInsights | null): number {
  if (!check) return INSIGHT_PROBLEM_FLAGS.length;
  return INSIGHT_PROBLEM_FLAGS.filter((flag) => Boolean(check[flag])).length;
}

function draftLimitProblems(draft: InsightBasicDraft): string[] {
  const issues: string[] = [];
  if (draft.title.ko.trim() && draft.title.ko.length > 30) {
    issues.push("제목이 30자를 넘습니다");
  }
  if (draft.title.en.length > 60) {
    issues.push("영문 제목이 60자를 넘습니다");
  }
  if (draft.summary.ko.trim() && draft.summary.ko.length > 80) {
    issues.push("한 줄 요약이 80자를 넘습니다");
  }
  if (draft.summary.en.length > 155) {
    issues.push("영문 요약이 155자를 넘습니다");
  }
  return issues;
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

function shortageLine(
  insight: InsightDetail,
  check: CheckInsights | null,
  draft: InsightBasicDraft | null
): { text: string; ok: boolean } {
  const limits = draft ? draftLimitProblems(draft) : [];
  const problems = problemCount(check) + limits.length;
  if (problems > 0) {
    const extra = limits[0] ? ` — ${limits[0]}` : "";
    return { text: `공개하려면 ${problems}가지가 더 필요합니다${extra}`, ok: false };
  }
  if (check?.ai_unconfirmed) {
    const n = countInsightAiUnconfirmed(insight);
    return {
      text: n > 0 ? `AI가 만든 캡션 ${n}개가 확인 전입니다` : "AI가 만든 캡션이 확인 전입니다",
      ok: false
    };
  }
  const related = insight.content_related?.length ?? 0;
  if (related > 0) {
    return { text: `관련 콘텐츠 ${related}개 지정됨`, ok: true };
  }
  return { text: "등록할 수 있습니다", ok: true };
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
  const [panelOpen, setPanelOpen] = useState(false);
  const [checkOverride, setCheckOverride] = useState<CheckInsights | null>(null);
  const publishNavTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [insightRes, metaRes] = await Promise.all([getInsight(insightId), getMeta()]);
      if (!insightRes.ok) {
        setError(insightRes.error + (insightRes.details ? ` · ${JSON.stringify(insightRes.details)}` : ""));
        return;
      }
      const parsed = parseInsightDetail(insightRes.data);
      if (!parsed) {
        setError("insight_not_found");
        return;
      }
      setInsight(parsed);
      setDraft(draftFromInsight(parsed));
      setCheckOverride(null);
      if (metaRes.ok) setCategories(metaRes.data.insightCategories ?? []);
      setError(null);
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
  const limitIssues = draft ? draftLimitProblems(draft) : [];
  const canPublish = problemCount(check) === 0 && limitIssues.length === 0;
  const shortage = insight ? shortageLine(insight, check, draft) : null;

  const onChangeDraft = useCallback((patch: Partial<InsightBasicDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  async function saveTemp() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updateInsight(insightId, insightPatchFromDraft(draft));
      if (!result.ok) {
        setError(result.error + (result.details ? ` · ${JSON.stringify(result.details)}` : ""));
        return;
      }
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
      const result = await updateInsight(insightId, {
        ...insightPatchFromDraft(draft),
        status: "published"
      });
      if (!result.ok) {
        if (result.status === 409 && result.error === "publish_blocked") {
          setCheckOverride(mergeCheck(insight?.check ?? null, result.details));
          setPanelOpen(true);
          return;
        }
        setError(result.error + (result.details ? ` · ${JSON.stringify(result.details)}` : ""));
        return;
      }
      setPanelOpen(false);
      await load();

      const title = draft.title.ko.trim() || insight?.slug || "인사이트";
      const slug = draft.slug || insight?.slug || "";
      const publicHref = `${websiteOrigin()}/insight/${slug}`;
      try {
        sessionStorage.setItem(PUBLISH_REDIRECT_KEY, JSON.stringify({ title, at: Date.now() }));
      } catch {
        // ignore
      }

      showToast({
        message: "공개되었습니다",
        tone: "ok",
        durationMs: 4000,
        actions: [
          { label: "홈페이지에서 보기 ↗", href: publicHref },
          {
            label: "계속 편집",
            onClick: () => {
              cancelPublishNav();
              try {
                sessionStorage.removeItem(PUBLISH_REDIRECT_KEY);
              } catch {
                // ignore
              }
            }
          }
        ]
      });

      publishNavTimer.current = window.setTimeout(() => {
        publishNavTimer.current = null;
        router.push("/website/insights");
      }, 1500);
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
      <p className="mb-1 text-slate-400" style={{ fontSize: "var(--fs-caption)" }}>
        인사이트 &nbsp;›&nbsp;{" "}
        <Link href="/website/insights" className="hover:text-slate-600">
          글 목록
        </Link>{" "}
        &nbsp;›&nbsp; 편집
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-bold text-slate-900" style={{ fontSize: "var(--fs-title)" }}>
          {titleKo}
        </h1>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
            insight.status === "published"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {insight.status === "published" ? "공개" : "초안"}
        </span>
      </div>
      <p className="mt-1 text-slate-400" style={{ fontSize: "var(--fs-caption)" }}>
        마지막 저장 {formatSavedAt(insight.updated_at)}
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
            onReload={load}
          />
        ) : null}
        {tab === "content" ? (
          <InsightContentTab insight={insight} siteUrl={siteUrl} onReload={load} />
        ) : null}
        {tab === "related" ? (
          <InsightRelatedTab insight={insight} siteUrl={siteUrl} onReload={load} />
        ) : null}
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 mt-8 border-t border-slate-200 bg-white px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`min-w-[180px] flex-1 text-sm ${shortage?.ok ? "text-emerald-600" : "text-amber-600"}`}>
            {shortage?.text}
          </p>
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
        <InsightPublishCheckPanel
          insight={insight}
          check={check ?? emptyInsightCheck(insight)}
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
