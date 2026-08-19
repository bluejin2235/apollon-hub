"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GlossaryHighlightTerm } from "@/lib/glossary/highlight";
import { supabase } from "@/lib/supabase/client";

type Props = {
  termId: string | null;
  term: GlossaryHighlightTerm | null;
  anchor: HTMLElement | null;
  onClose: () => void;
  onSaved: (term: GlossaryHighlightTerm) => void;
};

function formatMetaDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric"
  }).formatToParts(d);
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!month || !day) return "";
  return `${month}월 ${day}일`;
}

async function token(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function GlossaryTermPopup({ termId, term, anchor, onClose, onSaved }: Props) {
  const popRef = useRef<HTMLDivElement>(null);
  const openedFor = useRef<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editorName, setEditorName] = useState<string | null>(null);

  useEffect(() => {
    if (!termId || !term) {
      openedFor.current = null;
      setEditing(false);
      setDraft("");
      setError("");
      setEditorName(null);
      setPos(null);
      return;
    }
    if (openedFor.current === termId) return;
    openedFor.current = termId;
    setDraft(term.definition ?? "");
    setEditing(false);
    setError("");
    setEditorName(null);
  }, [term, termId]);

  useEffect(() => {
    if (!termId) return;
    let cancelled = false;
    void (async () => {
      const t = await token();
      if (!t) return;
      try {
        const res = await fetch(`/api/glossary?id=${encodeURIComponent(termId)}`, {
          headers: { Authorization: `Bearer ${t}` }
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          term?: GlossaryHighlightTerm;
          versions?: Array<{ editor_name: string | null }>;
        };
        if (cancelled) return;
        if (json.term) onSaved(json.term);
        const name = json.versions?.[0]?.editor_name?.trim();
        if (name) setEditorName(name);
      } catch (err) {
        console.error("[glossary] popup detail", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [termId, onSaved]);

  useLayoutEffect(() => {
    if (!anchor || !popRef.current || !termId) return;

    function place() {
      const el = popRef.current;
      if (!anchor || !el) return;
      if (!anchor.isConnected) {
        onClose();
        return;
      }
      const r = anchor.getBoundingClientRect();
      const pop = el.getBoundingClientRect();
      const margin = 8;
      const gap = 9;
      let left = r.left;
      let top = r.bottom + gap;
      if (left + pop.width > window.innerWidth - margin) {
        left = window.innerWidth - pop.width - margin;
      }
      if (left < margin) left = margin;
      const overflowBottom = top + pop.height > window.innerHeight - margin;
      if (overflowBottom) {
        top = r.top - pop.height - gap;
      }
      if (top < margin) top = margin;
      setPos({ top, left });
    }

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, termId, editing, term?.definition, onClose]);

  useEffect(() => {
    if (!termId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onPtr(e: MouseEvent) {
      const el = popRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (target && el.contains(target)) return;
      if (anchor && target && anchor.contains(target)) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPtr);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPtr);
    };
  }, [termId, onClose, anchor]);

  if (!termId || !term || !anchor || typeof document === "undefined") return null;
  const current = term;

  const title = (current.term_ko || current.term_en || "용어").trim();
  const category = current.categories[0] || "공통";
  const metaBits = [
    editorName,
    formatMetaDate(term.updated_at),
    term.version ? `v${term.version}` : null
  ].filter(Boolean);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const t = await token();
      if (!t) {
        setError("로그인이 필요합니다.");
        return;
      }
      const res = await fetch("/api/glossary", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${t}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id: current.id,
          term_ko: current.term_ko ?? "",
          term_en: current.term_en,
          term_zh: current.term_zh,
          categories: current.categories.length > 0 ? current.categories : ["공통"],
          synonyms: current.synonyms,
          definition: draft,
          change_note: "본문 팝업에서 정의 수정"
        })
      });
      const json = (await res.json()) as { error?: string; term?: { id: string; version: number } };
      if (!res.ok) {
        setError(json.error ?? "저장하지 못했습니다.");
        return;
      }
      onSaved({
        ...current,
        definition: draft.trim() || null,
        version: json.term?.version ?? current.version + 1,
        updated_at: new Date().toISOString()
      });
      setEditing(false);
      if (!draft.trim()) onClose();
    } catch (err) {
      console.error("[glossary] popup save", err);
      setError("저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label={`${title} 뜻`}
      className="fixed z-[80] w-[290px] rounded-xl border border-[#e7e8ec] bg-white px-4 py-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.09)]"
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? "visible" : "hidden"
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[15px] font-extrabold text-[#1c1d21]">{title}</span>
        <span className="rounded-[9px] bg-[#f1f2f5] px-1.5 py-0.5 text-[9.5px] text-[#6b6f76]">
          {category}
        </span>
        <button
          type="button"
          className="ml-auto text-[11px] font-semibold text-[#534AB7]"
          onClick={() => {
            if (editing) {
              setDraft(term.definition ?? "");
              setEditing(false);
            } else {
              setEditing(true);
            }
          }}
        >
          {editing ? "읽기로" : "수정"}
        </button>
      </div>
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[70px] w-full rounded-[9px] border border-[#534AB7] bg-[#FCFCFD] px-2.5 py-2 text-[12.5px] leading-[1.75] text-[#1c1d21]"
            placeholder="뜻을 고칠 수 있습니다"
          />
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="rounded-lg bg-[#534AB7] px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              저장
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(term.definition ?? "");
                setEditing(false);
              }}
              className="rounded-lg border border-[#e7e8ec] px-2.5 py-1 text-[12px] text-[#1c1d21]"
            >
              취소
            </button>
          </div>
          <p className="mt-2.5 border-t border-[#eef0f3] pt-2 text-[10px] text-[#9aa0a8]">
            고치면 바로 반영되고 이력이 남습니다
          </p>
        </>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-[12.5px] leading-[1.8] text-[#2a2c31]">
            {(term.definition ?? "").trim()}
          </p>
          {metaBits.length > 0 ? (
            <p className="mt-2.5 border-t border-[#eef0f3] pt-2 text-[10px] text-[#9aa0a8]">
              {metaBits.join(" · ")}
            </p>
          ) : null}
        </>
      )}
      {error ? <p className="mt-2 text-[11px] text-[#A32D2D]">{error}</p> : null}
    </div>,
    document.body
  );
}
