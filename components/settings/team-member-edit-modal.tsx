"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Role = "슈퍼관리자" | "중간관리자" | "멤버";
type Status = "근무" | "휴직" | "퇴사";

export type TeamMemberRow = {
  id: string;
  name: string;
  email: string;
  department: string;
  role: Role;
  status: Status;
  created_at?: string;
};

const roleOptions: Role[] = ["슈퍼관리자", "중간관리자", "멤버"];
const statusOptions: Status[] = ["근무", "휴직", "퇴사"];

type Props = {
  member: TeamMemberRow | null;
  onClose: () => void;
  onSaved: (updated: TeamMemberRow) => void;
};

export function TeamMemberEditModal({ member, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState<Role>("멤버");
  const [status, setStatus] = useState<Status>("근무");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!member) {
      return;
    }
    setName(member.name);
    setDepartment(member.department);
    setRole(member.role);
    setStatus(member.status);
    setNewPassword("");
    setConfirmPassword("");
    setMessage("");
    setError("");
  }, [member]);

  if (!member) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);

    try {
      const wantsPw = newPassword.trim().length > 0 || confirmPassword.trim().length > 0;
      if (wantsPw) {
        if (newPassword.length < 6) {
          setError("새 비밀번호는 최소 6자 이상이어야 합니다.");
          return;
        }
        if (newPassword !== confirmPassword) {
          setError("새 비밀번호와 확인 값이 일치하지 않습니다.");
          return;
        }
      }

      const { error: upErr } = await supabase
        .from("profiles")
        .update({
          name: name.trim(),
          department: department.trim(),
          role,
          status
        })
        .eq("id", member.id);

      if (upErr) {
        console.error(upErr);
        setError(`프로필 저장 실패: ${upErr.message}`);
        return;
      }

      if (wantsPw) {
        const {
          data: { session }
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          setError("인증 세션이 만료되었습니다. 다시 로그인해주세요.");
          return;
        }

        const res = await fetch("/api/team/reset-password", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            userId: member.id,
            newPassword: newPassword.trim()
          })
        });

        const body = (await res.json()) as { error?: string; success?: boolean };
        if (!res.ok || !body.success) {
          setError(body.error ?? "비밀번호 재설정에 실패했습니다.");
          return;
        }
      }

      const updated: TeamMemberRow = {
        ...member,
        name: name.trim(),
        department: department.trim(),
        role,
        status
      };
      onSaved(updated);
      setMessage(wantsPw ? "저장했고 비밀번호를 재설정했습니다." : "저장했습니다.");
      setNewPassword("");
      setConfirmPassword("");
      window.setTimeout(() => {
        onClose();
      }, 600);
    } catch (e) {
      console.error(e);
      setError("처리 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4" role="dialog" aria-modal>
      <div className="apollon-card w-full max-w-lg p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">팀원 수정</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            닫기
          </button>
        </div>

        <p className="mb-4 truncate text-sm text-slate-400">{member.email}</p>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">이름</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">부서</label>
            <input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">권한</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">상태</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
            >
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-slate-700/80 bg-slate-900/60 p-4">
            <p className="mb-3 text-sm font-medium text-slate-200">비밀번호 재설정 (선택)</p>
            <p className="mb-3 text-xs text-slate-500">입력 시 Supabase Auth 비밀번호가 즉시 변경됩니다.</p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">새 비밀번호</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="변경하지 않으려면 비워두세요"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">새 비밀번호 확인</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-apollon-400 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {error ? (
            <p className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">{error}</p>
          ) : null}
          {message ? (
            <p className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">
              {message}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-apollon-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-apollon-400 disabled:opacity-60"
            >
              {saving ? "저장 중…" : "저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
