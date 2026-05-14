"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Profile } from "@/lib/licenses/types";
import { supabase } from "@/lib/supabase/client";

const ICON_TRASH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12Z" />
  </svg>
);

const ICON_USER_PLUS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-6 2.7-6 6m12-6h6m-3-3v6" />
  </svg>
);

const ICON_USER_MINUS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 8c0-3.3 2.7-6 6-6m12-3h-6" />
  </svg>
);

const ICON_KEY = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10" aria-hidden>
    <circle cx="8" cy="15" r="4" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m10.85 12.15 8.15-8.15M16 7l3 3" />
  </svg>
);

const ICON_SHIELD = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
  </svg>
);

const ICON_USERS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 0 0-3-3.87M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm10-3a3 3 0 1 1-3-3" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────────
 * 1) 서비스 담당자 카드 (license_managers)
 * ────────────────────────────────────────────────────────────── */

type ManagerRow = { id: string; service_id: string; profile_id: string };

export function ServiceManagersCard({
  serviceId,
  profiles,
  canEdit
}: {
  serviceId: string;
  profiles: Profile[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<ManagerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const profileMap = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("license_managers")
      .select("id, service_id, profile_id")
      .eq("service_id", serviceId)
      .order("created_at", { ascending: true });
    setRows((data ?? []) as ManagerRow[]);
    setLoading(false);
  }, [serviceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const usedIds = new Set(rows.map((r) => r.profile_id));
  const availableProfiles = profiles.filter((p) => !usedIds.has(p.id));

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!selectedId) {
      setErr("담당자를 선택해주세요.");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("license_managers")
      .insert({ service_id: serviceId, profile_id: selectedId });
    setBusy(false);
    if (error) {
      console.error("[license_managers][insert]", error);
      setErr(error.message ?? "추가에 실패했습니다.");
      return;
    }
    setPickerOpen(false);
    setSelectedId("");
    await refresh();
  };

  const handleRemove = async (rowId: string) => {
    const { error } = await supabase.from("license_managers").delete().eq("id", rowId);
    if (error) {
      console.error("[license_managers][delete]", error);
      return;
    }
    await refresh();
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
          <span className="text-slate-400">{ICON_USERS}</span>
          서비스 담당자
        </h2>
        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              setPickerOpen(true);
              setSelectedId("");
              setErr("");
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
          >
            {ICON_USER_PLUS}
            담당자 추가
          </button>
        ) : null}
      </header>

      {loading ? (
        <p className="text-sm text-slate-500">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          등록된 담당자가 없습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const p = profileMap.get(r.profile_id);
            return (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{p?.name ?? "(알 수 없음)"}</p>
                  {p?.email ? (
                    <p className="truncate text-xs text-slate-500">{p.email}</p>
                  ) : null}
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => void handleRemove(r.id)}
                    className="shrink-0 text-rose-500 transition hover:text-rose-700"
                    aria-label="담당자 제거"
                  >
                    {ICON_TRASH}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {pickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={(e) => void handleAdd(e)}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h3 className="text-lg font-bold text-slate-900">담당자 추가</h3>
            <p className="mt-1 text-xs text-slate-500">이 서비스의 담당자로 추가할 멤버를 선택하세요.</p>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              required
            >
              <option value="">멤버를 선택하세요</option>
              {availableProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.email})
                </option>
              ))}
            </select>
            {err ? <p className="mt-2 text-xs text-rose-600">{err}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
              >
                {busy ? "추가 중..." : "추가"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────
 * 2) 라이선스 사용자 카드 (license_users)
 * ────────────────────────────────────────────────────────────── */

type UserRow = { id: string; service_id: string; profile_id: string };

export function ServiceUsersCard({
  serviceId,
  profiles,
  capacity,
  canEdit,
  onCountChange
}: {
  serviceId: string;
  profiles: Profile[];
  capacity: number;
  canEdit: boolean;
  onCountChange?: (n: number) => void;
}) {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const profileMap = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("license_users")
      .select("id, service_id, profile_id")
      .eq("service_id", serviceId)
      .order("created_at", { ascending: true });
    const arr = (data ?? []) as UserRow[];
    setRows(arr);
    setLoading(false);
    onCountChange?.(arr.length);
  }, [serviceId, onCountChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const usedIds = new Set(rows.map((r) => r.profile_id));
  const availableProfiles = profiles.filter((p) => !usedIds.has(p.id));

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!selectedId) {
      setErr("사용자를 선택해주세요.");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("license_users")
      .insert({ service_id: serviceId, profile_id: selectedId });
    setBusy(false);
    if (error) {
      console.error("[license_users][insert]", error);
      setErr(error.message ?? "추가에 실패했습니다.");
      return;
    }
    setPickerOpen(false);
    setSelectedId("");
    await refresh();
  };

  const handleRemove = async (rowId: string) => {
    const { error } = await supabase.from("license_users").delete().eq("id", rowId);
    if (error) {
      console.error("[license_users][delete]", error);
      return;
    }
    await refresh();
  };

  const overflow = capacity > 0 && rows.length > capacity;
  const overflowCount = overflow ? rows.length - capacity : 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
          <span className="text-slate-400">{ICON_SHIELD}</span>
          라이선스 사용자
          {capacity > 0 ? (
            <span className={`text-sm font-medium ${overflow ? "text-rose-500" : "text-slate-500"}`}>
              ({rows.length}/{capacity})
            </span>
          ) : (
            <span className="text-sm font-medium text-slate-500">({rows.length})</span>
          )}
        </h2>
        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              setPickerOpen(true);
              setSelectedId("");
              setErr("");
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
          >
            {ICON_USER_PLUS}
            사용자 추가
          </button>
        ) : null}
      </header>

      {loading ? (
        <p className="text-sm text-slate-500">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          등록된 사용자가 없습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const p = profileMap.get(r.profile_id);
            return (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{p?.name ?? "(알 수 없음)"}</p>
                  <p className="truncate text-xs text-slate-500">
                    {p?.email ?? "—"}
                    {p?.department ? (
                      <>
                        <span className="mx-1.5 inline-block h-1 w-1 rounded-full bg-slate-300 align-middle" />
                        {p.department}
                      </>
                    ) : null}
                  </p>
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => void handleRemove(r.id)}
                    className="shrink-0 text-rose-500 transition hover:text-rose-700"
                    aria-label="사용자 제거"
                  >
                    {ICON_USER_MINUS}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {pickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={(e) => void handleAdd(e)}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h3 className="text-lg font-bold text-slate-900">사용자 추가</h3>
            <p className="mt-1 text-xs text-slate-500">이 라이선스를 사용할 멤버를 선택하세요.</p>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              required
            >
              <option value="">멤버를 선택하세요</option>
              {availableProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.email})
                </option>
              ))}
            </select>
            {err ? <p className="mt-2 text-xs text-rose-600">{err}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
              >
                {busy ? "추가 중..." : "추가"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {overflow ? (
        <p className="mt-3 text-xs font-medium text-rose-500">
          {overflowCount}명 초과 · 공동사용 중 (비용 {rows.length}명 분배)
        </p>
      ) : null}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────
 * 3) 인증 정보 카드 (license_credentials)
 * ────────────────────────────────────────────────────────────── */

type CredentialRow = {
  id: string;
  service_id: string;
  label: string;
  username: string | null;
  password: string | null;
  notes: string | null;
};

export function ServiceCredentialsCard({
  serviceId,
  canEdit
}: {
  serviceId: string;
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("license_credentials")
      .select("id, service_id, label, username, password, notes")
      .eq("service_id", serviceId)
      .order("created_at", { ascending: true });
    setRows((data ?? []) as CredentialRow[]);
    setLoading(false);
  }, [serviceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = () => {
    setLabel("");
    setUsername("");
    setPassword("");
    setNotes("");
    setErr("");
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!label.trim()) {
      setErr("라벨을 입력해주세요. (예: Admin 계정)");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("license_credentials").insert({
      service_id: serviceId,
      label: label.trim(),
      username: username.trim() || null,
      password: password.trim() || null,
      notes: notes.trim() || null
    });
    setBusy(false);
    if (error) {
      console.error("[license_credentials][insert]", error);
      setErr(error.message ?? "추가에 실패했습니다.");
      return;
    }
    setFormOpen(false);
    resetForm();
    await refresh();
  };

  const handleRemove = async (rowId: string) => {
    const { error } = await supabase.from("license_credentials").delete().eq("id", rowId);
    if (error) {
      console.error("[license_credentials][delete]", error);
      return;
    }
    await refresh();
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">인증 정보</h2>
        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              resetForm();
              setFormOpen(true);
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
          >
            + 추가
          </button>
        ) : null}
      </header>

      {loading ? (
        <p className="text-sm text-slate-500">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-slate-50 px-4 py-10 text-center">
          <span className="text-slate-400">{ICON_KEY}</span>
          <p className="text-sm text-slate-500">등록된 인증 정보가 없습니다</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl bg-slate-50 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{r.label}</p>
                  {r.username ? (
                    <p className="mt-0.5 truncate text-xs text-slate-500">계정: {r.username}</p>
                  ) : null}
                  {r.password ? (
                    <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-slate-500">
                      <span>비밀번호:</span>
                      <span className="font-mono">
                        {revealed[r.id] ? r.password : "•".repeat(Math.min(r.password.length, 8))}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setRevealed((prev) => ({ ...prev, [r.id]: !prev[r.id] }))
                        }
                        className="text-violet-600 hover:underline"
                      >
                        {revealed[r.id] ? "숨기기" : "보기"}
                      </button>
                    </p>
                  ) : null}
                  {r.notes ? (
                    <p className="mt-0.5 truncate text-xs text-slate-500">메모: {r.notes}</p>
                  ) : null}
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => void handleRemove(r.id)}
                    className="shrink-0 text-rose-500 transition hover:text-rose-700"
                    aria-label="인증 정보 삭제"
                  >
                    {ICON_TRASH}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={(e) => void handleAdd(e)}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h3 className="text-lg font-bold text-slate-900">인증 정보 추가</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">라벨</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  required
                  placeholder="예: 관리자 계정"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">계정 (선택)</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="이메일 또는 아이디"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">비밀번호 (선택)</label>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">메모 (선택)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
              </div>
            </div>
            {err ? <p className="mt-2 text-xs text-rose-600">{err}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
              >
                {busy ? "저장 중..." : "추가"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
