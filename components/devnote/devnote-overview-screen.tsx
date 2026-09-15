"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DevnoteMarkdownPanel } from "@/components/devnote/devnote-markdown-panel";
import { DevnoteButton, DevnoteError } from "@/components/devnote/devnote-ui";
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

  function startEdit() {
    setDraft(row[tab]);
    setError(null);
    setEditing(true);
  }

  function goTab(next: DevnoteOverviewTab) {
    const href = tabHref(next);
    if (pathname === "/devnote" && href === "/devnote") {
      router.replace("/devnote", { scroll: false });
      return;
    }
    router.replace(href, { scroll: false });
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
          <DevnoteButton onClick={startEdit}>편집</DevnoteButton>
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

      {error && !editing ? <DevnoteError message={error} /> : null}

      {loading ? (
        <p className="text-sm text-[#858C9A]">불러오는 중…</p>
      ) : (
        <DevnoteMarkdownPanel
          content={row[tab]}
          editing={editing}
          draft={draft}
          saving={saving}
          error={editing ? error : null}
          onChangeDraft={setDraft}
          onSave={() => void save()}
          onCancel={() => {
            setEditing(false);
            setError(null);
          }}
          onStartEdit={startEdit}
        />
      )}
    </div>
  );
}
