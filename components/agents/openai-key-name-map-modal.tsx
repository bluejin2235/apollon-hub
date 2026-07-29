"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentsModalPortal } from "@/components/agents/agents-modal-portal";
import {
  fetchOpenAiKeyNameMapRows,
  type OpenAiKeyNameMapRow
} from "@/lib/arte/openai-key-name-map";
import { supabase } from "@/lib/supabase/client";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function OpenAiKeyNameMapModal({ open, onClose }: Props) {
  const [rows, setRows] = useState<OpenAiKeyNameMapRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackingId, setTrackingId] = useState("");
  const [keyName, setKeyName] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mapRows, userRes] = await Promise.all([
        fetchOpenAiKeyNameMapRows(),
        supabase.auth.getUser()
      ]);
      setRows(mapRows);

      const userId = userRes.data.user?.id;
      if (userId) {
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
        setIsSuperAdmin(profile?.role === "슈퍼관리자");
      } else {
        setIsSuperAdmin(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    setShowAddForm(false);
    setTrackingId("");
    setKeyName("");
  }, [open, load]);

  const handleAdd = async () => {
    const tid = trackingId.trim();
    const name = keyName.trim();
    if (!tid || !name) {
      setError("Tracking ID와 키 이름을 모두 입력해 주세요.");
      return;
    }

    setSaving(true);
    setError(null);

    const {
      data: { user }
    } = await supabase.auth.getUser();

    const { error: insertError } = await supabase.from("openai_key_name_map").insert({
      tracking_id: tid,
      key_name: name,
      created_by: user?.id ?? null
    });

    setSaving(false);

    if (insertError) {
      console.error("[openai_key_name_map] insert failed", insertError);
      setError(insertError.message);
      return;
    }

    setTrackingId("");
    setKeyName("");
    setShowAddForm(false);
    await load();
  };

  const handleDelete = async (row: OpenAiKeyNameMapRow) => {
    if (!window.confirm(`"${row.tracking_id}" 매핑을 삭제하시겠습니까?`)) return;

    const { error: deleteError } = await supabase.from("openai_key_name_map").delete().eq("id", row.id);
    if (deleteError) {
      console.error("[openai_key_name_map] delete failed", deleteError);
      setError(deleteError.message);
      return;
    }
    await load();
  };

  return (
    <AgentsModalPortal open={open} title="API 키 이름 관리" onClose={onClose} maxWidthClass="max-w-xl">
      <p className="text-sm text-slate-600">
        OpenAI Tracking ID를 실제 키 이름으로 등록하면 CSV 업로드 시 자동으로 변환돼요.
      </p>

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">등록된 매핑 {rows.length}건</p>
        {isSuperAdmin ? (
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-100"
          >
            {showAddForm ? "추가 취소" : "키 추가"}
          </button>
        ) : null}
      </div>

      {showAddForm && isSuperAdmin ? (
        <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Tracking ID</label>
            <input
              type="text"
              value={trackingId}
              onChange={(e) => setTrackingId(e.target.value)}
              placeholder="key_xxxxxxxx"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">키 이름</label>
            <input
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="예: 아르테 프로덕션"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleAdd()}
            className="w-full rounded-lg bg-violet-600 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {saving ? "저장 중…" : "등록"}
          </button>
        </div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">등록된 매핑이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-slate-500">{row.tracking_id}</p>
                  <p className="truncate text-sm font-medium text-slate-900">{row.key_name}</p>
                </div>
                {isSuperAdmin ? (
                  <button
                    type="button"
                    onClick={() => void handleDelete(row)}
                    className="shrink-0 text-sm text-rose-500 hover:text-rose-700"
                  >
                    삭제
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {!isSuperAdmin ? (
        <p className="mt-3 text-xs text-slate-500">키 추가·삭제는 슈퍼관리자만 가능합니다.</p>
      ) : null}
    </AgentsModalPortal>
  );
}
