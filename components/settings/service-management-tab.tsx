"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  HUB_SERVICE_ACCESS_LEVELS,
  HUB_SERVICE_COLUMNS,
  HUB_SERVICE_STATUSES,
  isHubServiceAccessLevel,
  isHubServiceStatus,
  type HubService,
  type HubServiceAccessLevel,
  type HubServiceStatus
} from "@/lib/services/hub-types";
import { supabase } from "@/lib/supabase/client";

type EditingState = {
  mode: "create" | "edit";
  id: string | null;
  name: string;
  description: string;
  icon: string;
  url: string;
  status: HubServiceStatus;
  access_level: HubServiceAccessLevel;
  order_index: number;
};

const emptyForm = (orderIndex: number): EditingState => ({
  mode: "create",
  id: null,
  name: "",
  description: "",
  icon: "✨",
  url: "",
  status: "활성",
  access_level: "전체",
  order_index: orderIndex
});

function badgeColor(status: HubServiceStatus): string {
  if (status === "활성") return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  if (status === "준비중") return "bg-slate-100 text-slate-700 ring-slate-200";
  return "bg-rose-100 text-rose-700 ring-rose-200";
}

function accessBadge(level: HubServiceAccessLevel): string {
  if (level === "전체") return "bg-sky-100 text-sky-800 ring-sky-200";
  if (level === "슈퍼관리자") return "bg-violet-100 text-violet-800 ring-violet-200";
  return "bg-amber-100 text-amber-800 ring-amber-200";
}

export function ServiceManagementTab({ canManage }: { canManage: boolean }) {
  const [services, setServices] = useState<HubService[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HubService | null>(null);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("services")
      .select(HUB_SERVICE_COLUMNS)
      .eq("is_hub_card", true)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[service-mgmt] fetch failed", error);
      setLoadError(error.message);
      setLoading(false);
      return;
    }
    const rows: HubService[] = (data ?? [])
      .filter(
        (row) =>
          typeof row.name === "string" &&
          isHubServiceStatus(row.status) &&
          isHubServiceAccessLevel(row.access_level)
      )
      .map(
        (row): HubService => ({
          id: row.id as string,
          name: row.name as string,
          description: (row.description as string | null) ?? null,
          icon: (row.icon as string | null) ?? null,
          url: (row.url as string | null) ?? null,
          status: row.status as HubServiceStatus,
          access_level: row.access_level as HubServiceAccessLevel,
          order_index: (row.order_index as number) ?? 0,
          created_at: row.created_at as string
        })
      );
    setServices(rows);
    setLoadError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchServices();
  }, [fetchServices]);

  const openCreate = () => {
    const next = services.length > 0 ? services[services.length - 1].order_index + 1 : 0;
    setEditing(emptyForm(next));
    setMessage(null);
  };

  const openEdit = (svc: HubService) => {
    setEditing({
      mode: "edit",
      id: svc.id,
      name: svc.name,
      description: svc.description ?? "",
      icon: svc.icon ?? "",
      url: svc.url ?? "",
      status: svc.status,
      access_level: svc.access_level,
      order_index: svc.order_index
    });
    setMessage(null);
  };

  const closeEditor = () => {
    setEditing(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      setMessage("이름을 입력해주세요.");
      return;
    }

    setBusy(true);
    setMessage(null);

    const payload = {
      name,
      description: editing.description.trim() || null,
      icon: editing.icon.trim() || null,
      url: editing.url.trim() || null,
      status: editing.status,
      access_level: editing.access_level,
      order_index: editing.order_index,
      is_hub_card: true
    };

    let error;
    if (editing.mode === "create") {
      ({ error } = await supabase.from("services").insert(payload));
    } else if (editing.id) {
      ({ error } = await supabase.from("services").update(payload).eq("id", editing.id));
    }

    setBusy(false);
    if (error) {
      console.error("[service-mgmt] save failed", error);
      setMessage(`저장 실패: ${error.message}`);
      return;
    }

    closeEditor();
    await fetchServices();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    const { error } = await supabase
      .from("services")
      .delete()
      .eq("id", deleteTarget.id)
      .eq("is_hub_card", true);
    setBusy(false);
    if (error) {
      console.error("[service-mgmt] delete failed", error);
      setMessage(`삭제 실패: ${error.message}`);
      return;
    }
    setDeleteTarget(null);
    await fetchServices();
  };

  const moveOrder = async (svc: HubService, direction: -1 | 1) => {
    const idx = services.findIndex((s) => s.id === svc.id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= services.length) return;
    const a = services[idx];
    const b = services[swapIdx];

    setBusy(true);
    const ops = await Promise.all([
      supabase.from("services").update({ order_index: b.order_index }).eq("id", a.id),
      supabase.from("services").update({ order_index: a.order_index }).eq("id", b.id)
    ]);
    setBusy(false);
    const err = ops.find((r) => r.error);
    if (err?.error) {
      console.error("[service-mgmt] reorder failed", err.error);
      setMessage(`순서 변경 실패: ${err.error.message}`);
      return;
    }
    await fetchServices();
  };

  if (!canManage) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        서비스 관리는 슈퍼관리자만 접근 가능합니다.
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <div className="apollon-card flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-slate-600">
          허브(`/hub`)에 표시되는 서비스 카드를 관리합니다. 순서는 위/아래 버튼으로 변경하세요.
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="shrink-0 rounded-lg bg-apollon-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-apollon-400"
        >
          + 서비스 추가
        </button>
      </div>

      {message ? (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          {message}
        </p>
      ) : null}

      {loadError ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          서비스를 불러오지 못했습니다. ({loadError})
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : services.length === 0 ? (
        <div className="apollon-card p-6 text-center text-sm text-slate-500">
          등록된 서비스가 없습니다. 위 “+ 서비스 추가” 버튼으로 첫 서비스를 등록해 보세요.
        </div>
      ) : (
        <div className="space-y-3">
          {services.map((svc, idx) => (
            <article
              key={svc.id}
              className="apollon-card flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="text-2xl" aria-hidden>
                  {svc.icon ?? "✨"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold text-slate-900">{svc.name}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${badgeColor(svc.status)}`}
                    >
                      {svc.status}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${accessBadge(svc.access_level)}`}
                    >
                      {svc.access_level}
                    </span>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      #{svc.order_index}
                    </span>
                  </div>
                  {svc.description ? (
                    <p className="mt-1 text-sm text-slate-600">{svc.description}</p>
                  ) : null}
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {svc.url ?? "URL 없음"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void moveOrder(svc, -1)}
                  disabled={busy || idx === 0}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="위로 이동"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => void moveOrder(svc, 1)}
                  disabled={busy || idx === services.length - 1}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="아래로 이동"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(svc)}
                  className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-800 transition hover:bg-slate-100"
                >
                  수정
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(svc)}
                  className="rounded-md border border-rose-200 px-3 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-50"
                >
                  삭제
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-500/45 p-4 backdrop-blur-[2px]"
          onClick={closeEditor}
        >
          <form
            onSubmit={onSubmit}
            onClick={(e) => e.stopPropagation()}
            className="apollon-card w-full max-w-lg p-6"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">
                {editing.mode === "create" ? "서비스 추가" : "서비스 수정"}
              </h3>
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
              >
                닫기
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">이름</label>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">설명</label>
                <textarea
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  rows={2}
                  className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">아이콘 (이모지/문자)</label>
                  <input
                    value={editing.icon}
                    onChange={(e) => setEditing({ ...editing, icon: e.target.value })}
                    maxLength={4}
                    placeholder="✨"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">순서 (order_index)</label>
                  <input
                    type="number"
                    value={editing.order_index}
                    onChange={(e) =>
                      setEditing({ ...editing, order_index: Number(e.target.value) || 0 })
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">URL</label>
                <input
                  value={editing.url}
                  onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                  placeholder="/restaurants 또는 https://..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">상태</label>
                  <select
                    value={editing.status}
                    onChange={(e) =>
                      setEditing({ ...editing, status: e.target.value as HubServiceStatus })
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                  >
                    {HUB_SERVICE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">접근 권한</label>
                  <select
                    value={editing.access_level}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        access_level: e.target.value as HubServiceAccessLevel
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                  >
                    {HUB_SERVICE_ACCESS_LEVELS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {message ? <p className="text-sm text-rose-600">{message}</p> : null}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-apollon-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-apollon-400 disabled:opacity-50"
                >
                  {busy ? "저장 중…" : editing.mode === "create" ? "추가" : "저장"}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-500/45 p-4 backdrop-blur-[2px]"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="apollon-card w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal
          >
            <h3 className="text-base font-bold text-slate-900">서비스 삭제</h3>
            <p className="mt-2 text-sm text-slate-600">
              <strong>{deleteTarget.name}</strong> 카드를 정말 삭제할까요? 복구할 수 없습니다.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={busy}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {busy ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
