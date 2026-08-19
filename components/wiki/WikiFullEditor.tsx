"use client";

import { useEffect, useState } from "react";
import { WikiBodyEditor } from "@/components/wiki/WikiBodyEditor";
import { W } from "@/components/wiki/wiki-theme";
import { emptySection } from "@/lib/wiki/sections";
import type { WikiSection } from "@/lib/wiki/types";

export function WikiFullEditor({
  title,
  sections,
  slug,
  busy,
  onSave,
  onCancel
}: {
  title: string;
  sections: WikiSection[];
  slug: string;
  busy?: boolean;
  onSave: (next: { title: string; sections: WikiSection[]; note: string }) => void;
  onCancel: () => void;
}) {
  const [docTitle, setDocTitle] = useState(title);
  const [rows, setRows] = useState(sections);
  const [note, setNote] = useState("");
  const [editingHead, setEditingHead] = useState<string | null>(null);
  const [, setHistory] = useState<WikiSection[][]>([sections]);

  useEffect(() => {
    setDocTitle(title);
    setRows(sections);
    setHistory([sections]);
  }, [title, sections]);

  function push(next: WikiSection[]) {
    setRows(next);
    setHistory((h) => [...h.slice(-20), next]);
  }

  function undo() {
    setHistory((h) => {
      if (h.length < 2) return h;
      const next = h.slice(0, -1);
      setRows(next[next.length - 1]!);
      return next;
    });
  }

  return (
      <div className="overflow-hidden rounded-[11px] border" style={{ borderColor: W.luna }}>
      <div className="px-[14px] pt-3">
        <input
          value={docTitle}
          onChange={(e) => setDocTitle(e.target.value)}
          className="w-full border-b border-dashed bg-transparent py-1 text-[19px] font-extrabold outline-none"
          style={{ borderColor: W.line }}
        />
        <p className="mb-3 mt-1 text-[10px]" style={{ color: W.faint }}>
          문서 제목. 주소는 바뀌지 않습니다
        </p>
      </div>
      <div className="px-[14px] pb-2">
        {rows.map((s, idx) => (
          <div key={s.id} className="mb-4">
            <div className="mb-1 flex items-center gap-2">
              {editingHead === s.id ? (
                <input
                  autoFocus
                  value={s.title}
                  onChange={(e) =>
                    push(
                      rows.map((x, i) =>
                        i === idx ? { ...x, title: e.target.value } : x
                      )
                    )
                  }
                  onBlur={() => setEditingHead(null)}
                  className="rounded-[5px] px-1.5 py-0.5 text-[14px] font-bold outline-none"
                  style={{ background: "#F4F3FA" }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingHead(s.id)}
                  className="rounded-[5px] px-1.5 py-0.5 text-[14px] font-bold"
                  style={{ background: "#F4F3FA" }}
                >
                  {s.title || "절"}
                </button>
              )}
              <button
                type="button"
                disabled={idx === 0}
                onClick={() => {
                  if (idx === 0) return;
                  const next = [...rows];
                  const tmp = next[idx - 1]!;
                  next[idx - 1] = next[idx]!;
                  next[idx] = tmp;
                  push(next);
                }}
                className="text-[10px]"
                style={{ color: W.faint }}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={idx === rows.length - 1}
                onClick={() => {
                  if (idx >= rows.length - 1) return;
                  const next = [...rows];
                  const tmp = next[idx + 1]!;
                  next[idx + 1] = next[idx]!;
                  next[idx] = tmp;
                  push(next);
                }}
                className="text-[10px]"
                style={{ color: W.faint }}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => {
                  if (rows.length <= 1) return;
                  push(rows.filter((_, i) => i !== idx));
                }}
                className="text-[10px]"
                style={{ color: W.del }}
              >
                삭제
              </button>
            </div>
            <WikiBodyEditor
              value={s.body}
              onChange={(body) =>
                push(rows.map((x, i) => (i === idx ? { ...x, body } : x)))
              }
              slug={slug}
              showHeadingTools
              onHeading1={() => push([...rows, emptySection("새 절")])}
              onUndo={undo}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => push([...rows, emptySection("새 절")])}
          className="mb-3 text-[11.5px] font-semibold"
          style={{ color: W.luna }}
        >
          ＋ 절 추가
        </button>
      </div>
      <div className="border-t px-[14px] py-[11px]" style={{ borderColor: W.line }}>
        <p className="mb-1 text-[10.5px]" style={{ color: W.sub }}>
          무엇을 왜 바꾸셨나요?
        </p>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="예) 염분 대응 기준을 구체화"
          className="mb-2.5 w-full rounded-lg border px-[11px] py-2 text-[12px] outline-none"
          style={{ borderColor: W.line }}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave({ title: docTitle, sections: rows, note })}
            className="rounded-[9px] px-3 py-[7px] text-[11.5px] font-semibold text-white disabled:opacity-40"
            style={{ background: W.luna }}
          >
            저장
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[9px] border px-3 py-[7px] text-[11.5px] font-semibold"
            style={{ borderColor: W.line }}
          >
            취소
          </button>
          <span className="ml-auto text-[10.5px]" style={{ color: W.faint }}>
            회색 제목을 클릭하면 절 이름을 고칠 수 있습니다
          </span>
        </div>
      </div>
    </div>
  );
}
