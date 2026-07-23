"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { MIDDLE_ADMIN_DESCRIPTIONS } from "@/lib/services/permission-descriptions";
import { getServiceIdByUrl, SERVICE_URL, type ServiceUrl } from "@/lib/services/permissions";
import { supabase } from "@/lib/supabase/client";

const SERVICE_OPTIONS = [
  { url: SERVICE_URL.LICENSE_MANAGER, label: "라이선스매니저" },
  { url: SERVICE_URL.ASHULENG, label: "아슐랭" },
  { url: SERVICE_URL.ARTE, label: "아르테" },
  { url: SERVICE_URL.SUPPLIES, label: "물품창고" },
  { url: SERVICE_URL.RESEARCH, label: "트렌드 레이더" }
] as const;

const MIDDLE_ADMIN_ROLE = "중간관리자";
const SUPER_ADMIN_ROLE = "슈퍼관리자";

type ProfileRow = {
  id: string;
  name: string;
  email: string;
  department: string;
  role: string;
  status: string;
};

type AssignmentRow = {
  id: string;
  profile_id: string;
  created_at: string;
};

export function ServicePermissionsTab({ canManage }: { canManage: boolean }) {
  const [selectedUrl, setSelectedUrl] = useState<ServiceUrl>(SERVICE_URL.LICENSE_MANAGER);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [allProfiles, setAllProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [removeTarget, setRemoveTarget] = useState<AssignmentRow | null>(null);

  const selectedLabel = SERVICE_OPTIONS.find((o) => o.url === selectedUrl)?.label ?? "";

  const loadAssignments = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const sid = await getServiceIdByUrl(selectedUrl);
    setServiceId(sid);
    if (!sid) {
      setAssignments([]);
      setLoadError("해당 서비스를 services 테이블에서 찾을 수 없습니다.");
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("service_user_roles")
      .select("id, profile_id, created_at")
      .eq("service_id", sid)
      .eq("role", MIDDLE_ADMIN_ROLE)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[service-permissions] 목록 조회 실패", error);
      setLoadError(error.message);
      setAssignments([]);
      setLoading(false);
      return;
    }
    setAssignments((data ?? []) as AssignmentRow[]);
    setLoading(false);
  }, [selectedUrl]);

  useEffect(() => {
    if (!canManage) return;
    void loadAssignments();
  }, [canManage, loadAssignments]);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    const loadProfiles = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, email, department, role, status")
        .order("name", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("[service-permissions] 멤버 목록 조회 실패", error);
        return;
      }
      setAllProfiles((data ?? []) as ProfileRow[]);
    };
    void loadProfiles();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const profileMap = useMemo(() => {
    const map = new Map<string, ProfileRow>();
    for (const p of allProfiles) map.set(p.id, p);
    return map;
  }, [allProfiles]);

  const assignedIds = useMemo(
    () => new Set(assignments.map((a) => a.profile_id)),
    [assignments]
  );

  const addCandidates = useMemo(() => {
    const keyword = addSearch.trim().toLowerCase();
    return allProfiles.filter((p) => {
      if (p.status === "퇴사") return false;
      if (p.role === SUPER_ADMIN_ROLE) return false;
      if (assignedIds.has(p.id)) return false;
      if (!keyword) return true;
      return (
        p.name.toLowerCase().includes(keyword) ||
        p.email.toLowerCase().includes(keyword) ||
        p.department.toLowerCase().includes(keyword)
      );
    });
  }, [allProfiles, addSearch, assignedIds]);

  const openAddModal = () => {
    setAddSearch("");
    setMessage(null);
    setAddModalOpen(true);
  };

  const handleAdd = async (profileId: string) => {
    if (!serviceId) return;
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.from("service_user_roles").insert({
      service_id: serviceId,
      profile_id: profileId,
      role: MIDDLE_ADMIN_ROLE
    });
    setBusy(false);
    if (error) {
      console.error("[service-permissions] 추가 실패", error);
      setMessage(`추가 실패: ${error.message}`);
      return;
    }
    setAddModalOpen(false);
    const added = profileMap.get(profileId);
    setMessage(`${added?.name ?? "멤버"} 님을 ${selectedLabel} 중간관리자로 추가했습니다.`);
    await loadAssignments();
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setBusy(true);
    const { error } = await supabase
      .from("service_user_roles")
      .delete()
      .eq("id", removeTarget.id);
    setBusy(false);
    if (error) {
      console.error("[service-permissions] 제거 실패", error);
      setMessage(`제거 실패: ${error.message}`);
      return;
    }
    const removed = profileMap.get(removeTarget.profile_id);
    setRemoveTarget(null);
    setMessage(`${removed?.name ?? "멤버"} 님을 중간관리자에서 제거했습니다.`);
    await loadAssignments();
  };

  if (!canManage) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        서비스 권한 관리는 슈퍼관리자만 접근 가능합니다.
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <div className="apollon-card p-4">
        <p className="mb-3 text-sm text-slate-600">
          서비스별 <strong>중간관리자</strong>를 지정합니다. 중간관리자는 해당 서비스의 항목을
          관리(수정·삭제 등)할 수 있습니다.
        </p>
        <nav className="inline-flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
          {SERVICE_OPTIONS.map((opt) => (
            <button
              key={opt.url}
              type="button"
              onClick={() => {
                setSelectedUrl(opt.url);
                setMessage(null);
              }}
              className={`rounded-lg px-4 py-2 text-sm transition ${
                selectedUrl === opt.url
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </nav>

        <div className="mt-4 flex gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700">중간관리자 권한 안내</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {MIDDLE_ADMIN_DESCRIPTIONS[selectedUrl]}
            </p>
          </div>
        </div>
      </div>

      <div className="apollon-card flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-slate-700">
          <strong>{selectedLabel}</strong> 중간관리자
          <span className="ml-2 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {assignments.length}명
          </span>
        </p>
        <button
          type="button"
          onClick={openAddModal}
          disabled={!serviceId}
          className="shrink-0 rounded-lg bg-apollon-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-apollon-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          + 중간관리자 추가
        </button>
      </div>

      {message ? (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          {message}
        </p>
      ) : null}

      {loadError ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          목록을 불러오지 못했습니다. ({loadError})
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : assignments.length === 0 ? (
        <div className="apollon-card p-6 text-center text-sm text-slate-500">
          지정된 중간관리자가 없습니다. 위 “+ 중간관리자 추가” 버튼으로 지정해 보세요.
        </div>
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => {
            const profile = profileMap.get(a.profile_id);
            return (
              <article
                key={a.id}
                className="apollon-card flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-slate-900">
                    {profile?.name ?? "(알 수 없는 멤버)"}
                  </p>
                  <p className="truncate text-sm text-slate-600">
                    {profile ? `${profile.email} · ${profile.department}` : a.profile_id}
                  </p>
                  {profile?.status && profile.status !== "근무" ? (
                    <span className="mt-2 inline-flex rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                      {profile.status}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setRemoveTarget(a)}
                  className="shrink-0 rounded-md border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-50"
                >
                  제거
                </button>
              </article>
            );
          })}
        </div>
      )}

      {addModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-500/45 p-4 backdrop-blur-[2px]"
          onClick={() => setAddModalOpen(false)}
        >
          <div
            className="apollon-card flex max-h-[80vh] w-full max-w-lg flex-col p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">
                {selectedLabel} 중간관리자 추가
              </h3>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
              >
                닫기
              </button>
            </div>

            <input
              value={addSearch}
              onChange={(e) => setAddSearch(e.target.value)}
              placeholder="이름, 이메일, 부서로 검색..."
              className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
            />

            <p className="mb-2 text-xs text-slate-500">
              슈퍼관리자·이미 지정된 중간관리자·퇴사 멤버는 목록에서 제외됩니다.
            </p>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {addCandidates.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  추가할 수 있는 멤버가 없습니다.
                </p>
              ) : (
                addCandidates.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {p.name}
                        <span className="ml-2 text-xs font-normal text-slate-500">{p.role}</span>
                        {p.status !== "근무" ? (
                          <span className="ml-1 text-xs font-normal text-amber-700">
                            ({p.status})
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-slate-600">
                        {p.email} · {p.department}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleAdd(p.id)}
                      disabled={busy}
                      className="shrink-0 rounded-lg bg-apollon-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-apollon-400 disabled:opacity-50"
                    >
                      추가
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {removeTarget ? (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-500/45 p-4 backdrop-blur-[2px]"
          onClick={() => setRemoveTarget(null)}
        >
          <div
            className="apollon-card w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal
          >
            <h3 className="text-base font-bold text-slate-900">중간관리자 제거</h3>
            <p className="mt-2 text-sm text-slate-600">
              <strong>{profileMap.get(removeTarget.profile_id)?.name ?? "이 멤버"}</strong> 님을{" "}
              {selectedLabel} 중간관리자에서 제거할까요?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemoveTarget(null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void confirmRemove()}
                disabled={busy}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {busy ? "제거 중…" : "제거"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
