"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 *   - 유형: 로그인 / API 키 / 라이선스
 *   - 비밀번호/키: 기본 마스킹(••••••••) · 보기 클릭 시 5초간 표시 후 자동 마스킹
 *   - canEdit: 수정·삭제 가능 (RLS: 슈퍼관리자 또는 서비스 담당자만 행 접근)
 * ────────────────────────────────────────────────────────────── */

const CRED_TYPES = ["로그인", "API 키", "라이선스"] as const;
type CredentialType = (typeof CRED_TYPES)[number];

type CredentialRow = {
  id: string;
  service_id: string;
  type: CredentialType | string;
  label: string;
  username: string | null;
  password: string | null;
  notes: string | null;
};

function isCredentialType(v: unknown): v is CredentialType {
  return typeof v === "string" && (CRED_TYPES as readonly string[]).includes(v);
}

/** 유형별 컬러 (뱃지/포커스 링) */
const TYPE_STYLE: Record<CredentialType, { badge: string; ring: string; text: string }> = {
  "로그인": {
    badge: "bg-blue-100 text-blue-700",
    ring: "focus:border-blue-500 focus:ring-blue-500/40",
    text: "text-blue-700"
  },
  "API 키": {
    badge: "bg-purple-100 text-purple-700",
    ring: "focus:border-purple-500 focus:ring-purple-500/40",
    text: "text-purple-700"
  },
  "라이선스": {
    badge: "bg-emerald-100 text-emerald-700",
    ring: "focus:border-emerald-500 focus:ring-emerald-500/40",
    text: "text-emerald-700"
  }
};

/** 유형별 필드 라벨 */
const TYPE_FIELDS: Record<CredentialType, { nameLabel: string; valueLabel: string; namePlaceholder: string; valuePlaceholder: string; nameType: "text" }> = {
  "로그인": {
    nameLabel: "아이디",
    valueLabel: "비밀번호",
    namePlaceholder: "아이디",
    valuePlaceholder: "비밀번호 입력",
    nameType: "text"
  },
  "API 키": {
    nameLabel: "키 이름",
    valueLabel: "API 키 값",
    namePlaceholder: "예: Production API",
    valuePlaceholder: "API 키 값을 붙여넣기",
    nameType: "text"
  },
  "라이선스": {
    nameLabel: "라이선스 이름",
    valueLabel: "라이선스 키",
    namePlaceholder: "예: Photoshop Pro",
    valuePlaceholder: "라이선스 키 입력",
    nameType: "text"
  }
};

function valueLabelOf(type: string): string {
  return isCredentialType(type) ? TYPE_FIELDS[type].valueLabel : "값";
}

const MASKED_SECRET = "••••••••";

function maskSecret(_value: string | null | undefined): string {
  return MASKED_SECRET;
}

const REVEAL_AUTO_HIDE_MS = 5000;

const ICON_EYE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const ICON_EYE_OFF = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a14.5 14.5 0 0 1-3.4 3.9M6.7 7.2A14.7 14.7 0 0 0 2.5 12s3.5 6 9.5 6a9.7 9.7 0 0 0 4-1M9.9 9.9a3 3 0 1 0 4.2 4.2" />
  </svg>
);
const ICON_COPY = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5" aria-hidden>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const ICON_EDIT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7m-1.4-9.4a2 2 0 1 1 2.8 2.8L11.7 19.5a4 4 0 0 1-1.7 1l-3.3.9.9-3.3a4 4 0 0 1 1-1.7L18.6 3.6Z" />
  </svg>
);

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
  const [editingId, setEditingId] = useState<string | null>(null);
  // 폼 상태
  const [credType, setCredType] = useState<CredentialType>("로그인");
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [notes, setNotes] = useState("");
  const [secretVisibleInForm, setSecretVisibleInForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 목록 상태
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const revealTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const timers = revealTimersRef.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  const hideSecret = useCallback((id: string) => {
    const t = revealTimersRef.current[id];
    if (t) {
      clearTimeout(t);
      delete revealTimersRef.current[id];
    }
    setRevealed((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const toggleRevealSecret = useCallback((id: string) => {
    setRevealed((prev) => {
      if (prev[id]) {
        hideSecret(id);
        const next = { ...prev };
        delete next[id];
        return next;
      }
      const existing = revealTimersRef.current[id];
      if (existing) clearTimeout(existing);
      revealTimersRef.current[id] = setTimeout(() => hideSecret(id), REVEAL_AUTO_HIDE_MS);
      return { ...prev, [id]: true };
    });
  }, [hideSecret]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("license_credentials")
      .select("id, service_id, type, label, username, password, notes")
      .eq("service_id", serviceId)
      .order("created_at", { ascending: true });
    setRows((data ?? []) as CredentialRow[]);
    setLoading(false);
  }, [serviceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = () => {
    setCredType("로그인");
    setName("");
    setSecret("");
    setNotes("");
    setEditingId(null);
    setErr("");
    setSecretVisibleInForm(false);
  };

  const openCreate = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (row: CredentialRow) => {
    setEditingId(row.id);
    setCredType(isCredentialType(row.type) ? row.type : "로그인");
    // 로그인 타입은 username 을 우선, 그 외에는 label 을 name 으로 표시.
    if (row.type === "로그인") {
      setName(row.username ?? row.label ?? "");
    } else {
      setName(row.label ?? "");
    }
    setSecret(row.password ?? "");
    setNotes(row.notes ?? "");
    setErr("");
    setSecretVisibleInForm(false);
    setFormOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!name.trim()) {
      setErr(`${TYPE_FIELDS[credType].nameLabel}을(를) 입력해주세요.`);
      return;
    }
    setBusy(true);

    const payload = {
      service_id: serviceId,
      type: credType,
      label: name.trim(),
      // 로그인은 아이디를 username 컬럼에도 저장해 호환성 유지.
      username: credType === "로그인" ? name.trim() : null,
      password: secret.trim() || null,
      notes: notes.trim() || null
    };

    const op = editingId
      ? supabase.from("license_credentials").update(payload).eq("id", editingId)
      : supabase.from("license_credentials").insert(payload);
    const { error } = await op;
    setBusy(false);
    if (error) {
      console.error("[license_credentials][submit]", error);
      setErr(error.message ?? "저장에 실패했습니다.");
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

  const handleCopy = async (text: string | null, id: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
    } catch (e) {
      console.error("[clipboard][writeText]", e);
    }
  };

  const fields = TYPE_FIELDS[credType];
  const style = TYPE_STYLE[credType];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">인증 정보</h2>
        {canEdit ? (
          <button
            type="button"
            onClick={openCreate}
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
          {rows.map((r) => {
            const rType = isCredentialType(r.type) ? r.type : "로그인";
            const badge = TYPE_STYLE[rType].badge;
            const valueLabel = valueLabelOf(rType);
            const isRevealed = Boolean(revealed[r.id]);
            return (
              <li key={r.id} className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge}`}
                      >
                        {rType}
                      </span>
                      <p className="truncate text-sm font-semibold text-slate-900">{r.label}</p>
                    </div>
                    {r.password ? (
                      <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        <span className="shrink-0">{valueLabel}:</span>
                        <span className="font-mono text-slate-700">
                          {isRevealed ? r.password : maskSecret(r.password)}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleRevealSecret(r.id)}
                          className="inline-flex items-center gap-1 text-violet-600 transition hover:text-violet-800"
                          aria-label={isRevealed ? "숨기기" : "보기"}
                        >
                          {isRevealed ? ICON_EYE_OFF : ICON_EYE}
                          <span>{isRevealed ? "숨기기" : "보기"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopy(r.password, r.id)}
                          className="inline-flex items-center gap-1 text-violet-600 transition hover:text-violet-800"
                          aria-label="값 복사"
                        >
                          {ICON_COPY}
                          <span>{copiedId === r.id ? "복사됨" : "복사"}</span>
                        </button>
                      </p>
                    ) : null}
                    {r.notes ? (
                      <p className="mt-0.5 truncate text-xs text-slate-500">메모: {r.notes}</p>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        className="text-slate-400 transition hover:text-slate-700"
                        aria-label="인증 정보 수정"
                        title="수정"
                      >
                        {ICON_EDIT}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemove(r.id)}
                        className="text-rose-500 transition hover:text-rose-700"
                        aria-label="인증 정보 삭제"
                        title="삭제"
                      >
                        {ICON_TRASH}
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h3 className="text-lg font-bold text-slate-900">
              {editingId ? "인증 정보 수정" : "인증 정보 추가"}
            </h3>

            {/* 유형 탭 */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              {CRED_TYPES.map((t) => {
                const active = credType === t;
                const s = TYPE_STYLE[t];
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setCredType(t);
                      setErr("");
                    }}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                      active
                        ? `${s.badge} border-transparent`
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  {fields.nameLabel}
                </label>
                <input
                  type={fields.nameType}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder={fields.namePlaceholder}
                  className={`w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 ${style.ring}`}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  {fields.valueLabel}
                </label>
                <div className="relative">
                  <input
                    type={secretVisibleInForm ? "text" : "password"}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={fields.valuePlaceholder}
                    className={`w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 pr-10 text-sm text-slate-900 focus:outline-none focus:ring-2 ${style.ring}`}
                  />
                  <button
                    type="button"
                    onClick={() => setSecretVisibleInForm((v) => !v)}
                    className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center rounded p-1 text-slate-400 transition hover:text-slate-700"
                    aria-label={secretVisibleInForm ? "숨기기" : "보기"}
                  >
                    {secretVisibleInForm ? ICON_EYE_OFF : ICON_EYE}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">메모 (선택)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="용도, 만료일 등 자유롭게 작성"
                  className={`w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 ${style.ring}`}
                />
              </div>
            </div>

            {err ? <p className="mt-2 text-xs text-rose-600">{err}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setFormOpen(false);
                  resetForm();
                }}
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
                {busy ? "저장 중..." : editingId ? "저장" : "추가"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
