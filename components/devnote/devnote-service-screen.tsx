"use client";

import { useEffect, useState } from "react";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { DevnoteDecisionList } from "@/components/devnote/devnote-decision-list";
import { DevnoteMarkdownPanel } from "@/components/devnote/devnote-markdown-panel";
import { DevnoteStatusBadge } from "@/components/devnote/devnote-status-badge";
import { DevnoteTodoList } from "@/components/devnote/devnote-todo-list";
import { DevnoteButton, DevnoteError } from "@/components/devnote/devnote-ui";
import { formatDevnoteDate } from "@/lib/devnote/overview";
import {
  loadDevnoteServiceNote,
  servicePathHref,
  updateDevnoteServiceMarkdown
} from "@/lib/devnote/service";
import {
  parseDevnoteServiceTab,
  type DevnoteDecisionRow,
  type DevnoteServiceRow,
  type DevnoteServiceTab,
  type DevnoteTodoRow
} from "@/lib/devnote/types";
import { supabase } from "@/lib/supabase/client";

function tabHref(slug: string, tab: DevnoteServiceTab) {
  return tab === "overview"
    ? `/devnote/s/${slug}`
    : `/devnote/s/${slug}?tab=${tab}`;
}

export function DevnoteServiceScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = parseDevnoteServiceTab(searchParams.get("tab"));

  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [service, setService] = useState<DevnoteServiceRow | null>(null);
  const [decisions, setDecisions] = useState<DevnoteDecisionRow[]>([]);
  const [todos, setTodos] = useState<DevnoteTodoRow[]>([]);
  const [editingMd, setEditingMd] = useState(false);
  const [draft, setDraft] = useState("");
  const [savingMd, setSavingMd] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    void loadDevnoteServiceNote(supabase, slug)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setMissing(true);
          return;
        }
        setService(data.service);
        setDecisions(data.decisions);
        setTodos(data.todos);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    setEditingMd(false);
    setAdding(false);
    setError(null);
  }, [tab]);

  if (missing) {
    notFound();
  }

  const mdColumn = tab === "data" ? "data_notes" : "overview";
  const mdContent = service
    ? tab === "data"
      ? service.data_notes
      : service.overview
    : "";

  function startMdEdit() {
    setDraft(mdContent);
    setError(null);
    setEditingMd(true);
  }

  async function saveMd() {
    if (!service || savingMd) return;
    setSavingMd(true);
    setError(null);
    try {
      const next = await updateDevnoteServiceMarkdown(
        supabase,
        service.id,
        mdColumn,
        draft
      );
      setService(next);
      setEditingMd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setSavingMd(false);
    }
  }

  function goTab(next: DevnoteServiceTab) {
    router.replace(tabHref(slug, next), { scroll: false });
  }

  const decisionCount = decisions.length;
  const todoCount = todos.length;
  const showAdd = tab === "decisions" || tab === "todos";
  const showEdit = tab === "overview" || tab === "data";

  return (
    <div>
      <p className="mb-2.5 text-xs text-[#858C9A]">개발노트 · 서비스</p>
      {loading ? (
        <p className="text-sm text-[#858C9A]">불러오는 중…</p>
      ) : !service ? (
        <DevnoteError message={error ?? "서비스를 찾지 못했습니다."} />
      ) : (
        <>
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="flex flex-wrap items-center gap-2.5 text-[26px] font-bold tracking-tight text-[#15171C]">
                {service.name}
                <DevnoteStatusBadge status={service.status} />
              </h1>
              <p className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-[#858C9A]">
                {service.path ? (
                  <code className="rounded border border-[#EFF1F4] bg-[#F7F8FA] px-1 py-px font-mono text-[12.5px] text-[#15171C]">
                    {service.path}
                  </code>
                ) : null}
                {service.repo ? <span>{service.repo}</span> : null}
                {service.updated_at ? (
                  <span>최종 수정 {formatDevnoteDate(service.updated_at)}</span>
                ) : null}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {service.path ? (
                <a
                  href={servicePathHref(service.path)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-[7px] border border-[#E2E5EA] bg-white px-3 py-1.5 text-[13px] text-[#4A505C] hover:bg-[#F7F8FA]"
                >
                  서비스 열기
                </a>
              ) : null}
              {showEdit && !editingMd ? (
                <DevnoteButton onClick={startMdEdit}>편집</DevnoteButton>
              ) : null}
              {showAdd ? (
                <DevnoteButton tone="primary" onClick={() => setAdding(true)}>
                  추가
                </DevnoteButton>
              ) : null}
            </div>
          </div>

          <div className="mb-7 mt-6 flex gap-[18px] border-b border-[#E2E5EA]">
            {(
              [
                { key: "overview", label: "개요" },
                {
                  key: "decisions",
                  label:
                    decisionCount > 0 ? `결정 기록 ${decisionCount}` : "결정 기록"
                },
                { key: "data", label: "데이터" },
                {
                  key: "todos",
                  label: todoCount > 0 ? `할 일 ${todoCount}` : "할 일"
                }
              ] as const
            ).map((item) => {
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

          {error && tab !== "overview" && tab !== "data" ? (
            <DevnoteError message={error} />
          ) : null}

          {tab === "overview" || tab === "data" ? (
            <DevnoteMarkdownPanel
              content={mdContent}
              editing={editingMd}
              draft={draft}
              saving={savingMd}
              error={error}
              onChangeDraft={setDraft}
              onSave={() => void saveMd()}
              onCancel={() => {
                setEditingMd(false);
                setError(null);
              }}
              onStartEdit={startMdEdit}
            />
          ) : null}

          {tab === "decisions" ? (
            <DevnoteDecisionList
              serviceId={service.id}
              items={decisions}
              adding={adding}
              onAddingChange={setAdding}
              onChange={setDecisions}
            />
          ) : null}

          {tab === "todos" ? (
            <DevnoteTodoList
              serviceId={service.id}
              items={todos}
              adding={adding}
              onAddingChange={setAdding}
              onChange={setTodos}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
