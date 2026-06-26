"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type LunaPromptModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function LunaPromptModal({ open, onClose, onSaved }: LunaPromptModalProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const {
          data: { session }
        } = await supabase.auth.getSession();
        const token = session?.access_token;

        if (!token) {
          if (!cancelled) setError("로그인 세션이 없습니다.");
          return;
        }

        const response = await fetch("/api/research/prompt", {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = (await response.json()) as { error?: string; value?: string };

        if (!response.ok) {
          if (!cancelled) setError(data.error ?? "프롬프트를 불러오지 못했습니다.");
          return;
        }

        if (!cancelled) {
          setPrompt(data.value ?? "");
        }
      } catch (fetchError) {
        if (!cancelled) {
          const message =
            fetchError instanceof Error ? fetchError.message : "프롬프트를 불러오지 못했습니다.";
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleSave = async () => {
    if (saving || loading) return;

    const trimmed = prompt.trim();
    if (!trimmed) {
      setError("프롬프트 내용을 입력해 주세요.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        setError("로그인 세션이 없습니다.");
        return;
      }

      const response = await fetch("/api/research/prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ value: trimmed })
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }

      onSaved();
      onClose();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "저장에 실패했습니다.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-[#0d0d0d]">루나 시스템 프롬프트</h2>

        <p className="mt-3 text-sm text-red-500">
          ⚠️ 여기서 수정된 프롬프트는 이 채팅방뿐 아니라 모든 채팅방에 동일하게 적용됩니다.
        </p>

        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={loading || saving}
          rows={18}
          className="mt-4 min-h-[280px] flex-1 resize-y rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm leading-relaxed text-[#0d0d0d] focus:border-[#0d0d0d] focus:outline-none disabled:opacity-60"
        />

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm text-[#676767] hover:bg-[#f4f4f4] disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={loading || saving || !prompt.trim()}
            className="rounded-lg bg-[#0d0d0d] px-4 py-2 text-sm font-medium text-white hover:bg-[#333] disabled:opacity-50"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
