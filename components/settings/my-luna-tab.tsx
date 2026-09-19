"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ANSWER_LENGTH_IDS,
  ANSWER_LENGTH_LABELS,
  type AnswerLength
} from "@/lib/luna/user-memory-shared";

type MemoryPayload = {
  memo: string;
  answer_length: AnswerLength;
  source_count: number;
  updated_at: string;
};

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 설정 › 나의 루나 — Claude 메모리 방식 (입력칸 없음) */
export function MyLunaTab() {
  const [memory, setMemory] = useState<MemoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/luna/my-memory", { cache: "no-store" });
      const json = (await res.json()) as {
        memory?: MemoryPayload | null;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "불러오지 못했습니다.");
        setMemory(null);
        return;
      }
      setMemory(json.memory ?? null);
    } catch {
      setError("불러오지 못했습니다.");
      setMemory(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasMemo = Boolean(memory?.memo?.trim());

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/luna/my-memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = (await res.json()) as {
        memory?: MemoryPayload | null;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "저장에 실패했습니다.");
        return;
      }
      setMemory(json.memory ?? null);
      setEditing(false);
    } catch {
      setError("저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function clearAll() {
    if (!window.confirm("루나가 아는 것을 전부 지울까요?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/luna/my-memory", { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setError(json.error ?? "지우기에 실패했습니다.");
        return;
      }
      setMemory(null);
      setEditing(false);
      setDraft("");
    } catch {
      setError("지우기에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const length: AnswerLength = memory?.answer_length ?? "normal";

  return (
    <section className="apollon-card p-6 md:p-8">
      <div className="mb-1 text-[13.5px] font-extrabold text-slate-900">
        루나가 아는 나
      </div>
      <p className="mb-4 text-[12px] leading-relaxed text-[#6b7280]">
        대화를 나누면서 알게 된 것입니다. 틀린 부분이 있으면 고치거나 지우세요.
      </p>

      {loading ? (
        <p className="py-4 text-[12px] text-[#9ca3af]">불러오는 중…</p>
      ) : !hasMemo && !editing ? (
        <p className="py-4 text-[12px] leading-[1.85] text-[#9ca3af]">
          아직 아무것도 모릅니다.
          <br />
          루나와 대화를 나누면 여기에 쌓입니다. 따로 쓰실 것은 없습니다.
        </p>
      ) : editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
            className="w-full resize-y rounded-[10px] border border-[#e5e7eb] bg-[#FAFAFB] px-[18px] py-4 text-[12.5px] leading-[2] text-slate-900 focus:border-[#534AB7] focus:outline-none"
          />
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void patch({ memo: draft })}
              className="rounded-[7px] border border-[#e5e7eb] bg-white px-[13px] py-1.5 text-[11.5px] text-[#3a3d43] hover:bg-slate-50 disabled:opacity-50"
            >
              저장
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setDraft(memory?.memo ?? "");
              }}
              className="rounded-[7px] border border-[#e5e7eb] bg-white px-[13px] py-1.5 text-[11.5px] text-[#3a3d43] hover:bg-slate-50"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="whitespace-pre-line rounded-[10px] border border-[#e5e7eb] bg-[#FAFAFB] px-[18px] py-4 text-[12.5px] leading-[2] text-slate-900">
            {memory?.memo}
          </div>
          <div className="mt-2.5 flex items-center gap-2.5 text-[11px] text-[#9ca3af]">
            <span>
              마지막 갱신 {formatUpdatedAt(memory!.updated_at)}
              {memory!.source_count > 0
                ? ` · 대화 ${memory!.source_count}건에서`
                : ""}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft(memory?.memo ?? "");
                setEditing(true);
              }}
              className="rounded-[7px] border border-[#e5e7eb] bg-white px-[13px] py-1.5 text-[11.5px] text-[#3a3d43] hover:bg-slate-50"
            >
              고치기
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void clearAll()}
              className="rounded-[7px] border border-[#e5e7eb] bg-white px-[13px] py-1.5 text-[11.5px] text-[#3a3d43] hover:bg-slate-50"
            >
              전부 지우기
            </button>
          </div>
        </>
      )}

      <div className="my-6 h-px bg-[#f1f2f4]" />

      <div className="mb-1 text-[13.5px] font-extrabold text-slate-900">답 길이</div>
      <p className="mb-3.5 text-[12px] leading-relaxed text-[#6b7280]">
        이것만 직접 정합니다. 나머지는 대화에서 알아서 배웁니다.
      </p>
      <div className="inline-flex">
        {ANSWER_LENGTH_IDS.map((id, i) => (
          <button
            key={id}
            type="button"
            disabled={saving || loading}
            onClick={() => void patch({ answer_length: id })}
            className={`border border-[#e5e7eb] px-[18px] py-2 text-[12.5px] transition ${
              i === 0 ? "rounded-l-lg" : ""
            } ${i === ANSWER_LENGTH_IDS.length - 1 ? "rounded-r-lg" : ""} ${
              i > 0 ? "border-l-0" : ""
            } ${
              length === id
                ? "border-[#534AB7] bg-[#534AB7] font-bold text-white"
                : "bg-white text-[#6b7280] hover:bg-slate-50"
            }`}
          >
            {ANSWER_LENGTH_LABELS[id]}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  );
}
