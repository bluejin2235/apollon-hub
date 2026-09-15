"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DevnoteMarkdown } from "@/components/devnote/devnote-markdown";
import {
  formatDevnoteDate,
  loadDevnoteOverview,
  updateDevnoteOverviewColumn
} from "@/lib/devnote/overview";
import {
  DEVNOTE_OVERVIEW_TABS,
  EMPTY_DEVNOTE_OVERVIEW,
  parseDevnoteOverviewTab,
  type DevnoteOverviewRow,
  type DevnoteOverviewTab
} from "@/lib/devnote/types";
import { supabase } from "@/lib/supabase/client";

function tabHref(tab: DevnoteOverviewTab) {
  return tab === "body" ? "/devnote" : `/devnote?tab=${tab}`;
}

export function DevnoteOverviewScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseDevnoteOverviewTab(searchParams.get("tab"));

  const [row, setRow] = useState<DevnoteOverviewRow>(EMPTY_DEVNOTE_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadDevnoteOverview(supabase)
      .then((data) => {
        if (cancelled) return;
        setRow(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
        setRow(EMPTY_DEVNOTE_OVERVIEW);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setEditing(false);
    setError(null);
  }, [tab]);

  const content = row[tab];
  const empty = !content.trim();
  const lineCount = useMemo(
    () => Math.max(18, draft.split("\n").length + 2),
    [draft]
  );

  function startEdit() {
    setDraft(row[tab]);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
    setDraft(row[tab]);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateDevnoteOverviewColumn(supabase, tab, draft);
      setRow(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function goTab(next: DevnoteOverviewTab) {
    const href = tabHref(next);
    if (pathname === "/devnote" && href === "/devnote") {
      router.replace("/devnote", { scroll: false });
      return;
    }
    router.replace(href, { scroll: false });
  }

  return (
    <div>
      <p className="mb-2.5 text-xs text-[#858C9A]">개발노트</p>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-bold tracking-tight text-[#15171C]">
            기본 정보
          </h1>
          {row.updated_at ? (
            <p className="mt-2 text-xs text-[#858C9A]">
              최종 수정 {formatDevnoteDate(row.updated_at)}
            </p>
          ) : null}
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="rounded-[7px] border border-[#E2E5EA] bg-white px-3 py-1.5 text-[13px] text-[#4A505C] hover:bg-[#F7F8FA]"
          >
            편집
          </button>
        ) : null}
      </div>

      <div className="mb-7 mt-6 flex gap-[18px] border-b border-[#E2E5EA]">
        {DEVNOTE_OVERVIEW_TABS.map((item) => {
          const on = item.key === tab;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => goTab(item.key)}
              className={`mb-[-1px] border-b-2 pb-2.5 text-[13px] ${
                on
                  ? "border-[#15171C] font-semibold text-[#15171C]"
                  : "border-transparent text-[#858C9A] hover:text-[#4A505C]"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {error && !editing ? (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-[#858C9A]">불러오는 중…</p>
      ) : editing ? (
        <div>
          {error ? (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
              {error}
            </p>
          ) : null}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={lineCount}
            disabled={saving}
            className="min-h-[400px] w-full resize-none rounded-lg border border-[#E2E5EA] bg-white p-3 font-mono text-[13px] leading-relaxed text-[#15171C] [field-sizing:content] disabled:opacity-70"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="rounded-[7px] border border-[#15171C] bg-[#15171C] px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
            >
              {saving ? "저장 중" : "저장"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={cancelEdit}
              className="rounded-[7px] border border-[#E2E5EA] bg-white px-3 py-1.5 text-[13px] text-[#4A505C] disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </div>
      ) : empty ? (
        <div className="rounded-[10px] border border-dashed border-[#E2E5EA] px-6 py-8 text-center">
          <p className="text-[13px] text-[#858C9A]">
            아직 비어 있습니다. 편집을 눌러 적어주세요.
          </p>
          <button
            type="button"
            onClick={startEdit}
            className="mt-3 rounded-[7px] border border-[#E2E5EA] bg-white px-3 py-1.5 text-[13px] text-[#4A505C] hover:bg-[#F7F8FA]"
          >
            편집
          </button>
        </div>
      ) : (
        <DevnoteMarkdown content={content} />
      )}
    </div>
  );
}
