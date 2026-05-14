"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { ServiceManagementTab } from "@/components/settings/service-management-tab";
import { TeamMemberEditModal, type TeamMemberRow } from "@/components/settings/team-member-edit-modal";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";
import { supabase } from "@/lib/supabase/client";

type TabKey = "profile" | "password" | "team" | "services";
type Role = "슈퍼관리자" | "중간관리자" | "멤버";

const roleOptions: Role[] = ["슈퍼관리자", "중간관리자", "멤버"];
export default function SettingsPage() {
  const { status, profile: sessionProfile } = useRequirePortalSession({
    profileSelect: "id, email, name, department, role"
  });
  const [activeTab, setActiveTab] = useState<TabKey>("profile");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileEmail, setProfileEmail] = useState("");
  const [profileRole, setProfileRole] = useState<Role>("멤버");
  const [profileName, setProfileName] = useState("");
  const [profileDepartment, setProfileDepartment] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [teamMessage, setTeamMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([]);
  const [editMember, setEditMember] = useState<TeamMemberRow | null>(null);
  const [search, setSearch] = useState("");
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDepartment, setInviteDepartment] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("멤버");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [invitedTemporaryPassword, setInvitedTemporaryPassword] = useState("");

  const canManageTeam = profileRole === "슈퍼관리자";
  const canManageServices = profileRole === "슈퍼관리자";

  const tabs = useMemo<Array<{ key: TabKey; label: string }>>(() => {
    const base: Array<{ key: TabKey; label: string }> = [
      { key: "profile", label: "프로필" },
      { key: "password", label: "비밀번호" },
      { key: "team", label: "팀원 관리" }
    ];
    if (canManageServices) {
      base.push({ key: "services", label: "서비스 관리" });
    }
    return base;
  }, [canManageServices]);

  useEffect(() => {
    if (status !== "ready" || !sessionProfile) {
      return;
    }
    setProfileId(sessionProfile.id);
    setProfileEmail(sessionProfile.email);
    setProfileName(sessionProfile.name);
    setProfileDepartment(sessionProfile.department);
    setProfileRole(sessionProfile.role as Role);
  }, [status, sessionProfile]);

  useEffect(() => {
    if (status !== "ready" || !sessionProfile?.id) {
      return;
    }
    let cancelled = false;
    setLoadingTeam(true);

    const loadMembers = async () => {
      const { data: members } = await supabase
        .from("profiles")
        .select("id, name, email, department, role, status, created_at")
        .order("created_at", { ascending: true });

      if (cancelled) {
        return;
      }
      setTeamMembers((members ?? []) as TeamMemberRow[]);
      setLoadingTeam(false);
    };

    void loadMembers();

    return () => {
      cancelled = true;
    };
  }, [status, sessionProfile?.id]);

  const handleLogout = () => {
    void signOutAndRedirectToLogin();
  };

  const filteredMembers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return teamMembers;
    }

    return teamMembers.filter((member) => {
      return (
        member.name.toLowerCase().includes(keyword) ||
        member.email.toLowerCase().includes(keyword) ||
        member.department.toLowerCase().includes(keyword)
      );
    });
  }, [search, teamMembers]);

  const resetInviteModalState = () => {
    setInviteName("");
    setInviteEmail("");
    setInviteDepartment("");
    setInviteRole("멤버");
    setInviteMessage("");
    setInviteError("");
    setInvitedTemporaryPassword("");
  };

  const handleOpenInviteModal = () => {
    resetInviteModalState();
    setInviteModalOpen(true);
  };

  const handleCloseInviteModal = () => {
    setInviteModalOpen(false);
    resetInviteModalState();
  };

  const handleCopyTemporaryPassword = async () => {
    if (!invitedTemporaryPassword) {
      return;
    }

    await navigator.clipboard.writeText(invitedTemporaryPassword);
    setInviteMessage("임시 비밀번호를 복사했습니다.");
  };

  const handleInviteMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInviteError("");
    setInviteMessage("");
    setInviteLoading(true);

    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setInviteError("인증 세션이 만료되었습니다. 다시 로그인해주세요.");
        return;
      }

      const response = await fetch("/api/team/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          name: inviteName,
          email: inviteEmail,
          department: inviteDepartment,
          role: inviteRole
        })
      });

      const result = (await response.json()) as {
        error?: string;
        temporaryPassword?: string;
        profile?: TeamMemberRow;
      };

      if (!response.ok || !result.profile || !result.temporaryPassword) {
        setInviteError(result.error ?? "팀원 초대에 실패했습니다.");
        return;
      }

      setTeamMembers((previous) => {
        const withoutInvited = previous.filter((member) => member.email !== result.profile?.email);
        return [...withoutInvited, result.profile as TeamMemberRow].sort((a, b) =>
          a.created_at && b.created_at ? a.created_at.localeCompare(b.created_at) : 0
        );
      });

      setInvitedTemporaryPassword(result.temporaryPassword);
      setInviteMessage("팀원 초대가 완료되었습니다. 임시 비밀번호를 전달해주세요.");
      setTeamMessage("새 팀원을 초대했습니다.");
    } catch (error) {
      console.error("Team invite failed", error);
      setInviteError("초대 처리 중 오류가 발생했습니다.");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleProfileSave = async () => {
    if (!profileId) {
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        name: profileName,
        department: profileDepartment
      })
      .eq("id", profileId);

    if (error) {
      setProfileMessage("프로필 저장에 실패했습니다.");
      return;
    }

    setProfileMessage("프로필 변경사항을 저장했습니다.");
  };

  const handlePasswordChange = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage("모든 비밀번호 항목을 입력해주세요.");
      return;
    }

    if (newPassword.length < 6) {
      setPasswordMessage("새 비밀번호는 최소 6자 이상이어야 합니다.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage("새 비밀번호와 확인 값이 일치하지 않습니다.");
      return;
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      setPasswordMessage("비밀번호 변경에 실패했습니다. 다시 시도해주세요.");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMessage("비밀번호를 변경했습니다.");
  };

  const handleEditMemberSaved = (updated: TeamMemberRow) => {
    setTeamMembers((previous) => previous.map((member) => (member.id === updated.id ? updated : member)));
    setTeamMessage("팀원 정보를 저장했습니다.");
    if (updated.id === profileId) {
      setProfileName(updated.name);
      setProfileDepartment(updated.department);
      setProfileRole(updated.role);
    }
  };

  if (status === "checking" || !sessionProfile) {
    return <PortalAuthChecking />;
  }

  return (
    <main className="min-h-screen">
      <PortalHeader
        userInfoLine={formatPortalHeaderUserInfo(sessionProfile)}
        onLogout={handleLogout}
        zIndexClass="z-10"
        showSettingsLink={false}
      />

      <div className="pb-10 pt-10">
        <div className="mb-7">
          <h1 className="text-3xl font-bold text-slate-900">설정</h1>
          <p className="mt-2 text-slate-600">프로필 및 계정 설정을 관리하세요.</p>
        </div>

        <div className="mb-7 flex items-center justify-between">
          <nav className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-lg px-4 py-2 text-sm transition ${
                  activeTab === tab.key
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {activeTab === "team" && canManageTeam ? (
            <button
              type="button"
              onClick={handleOpenInviteModal}
              className="rounded-lg bg-apollon-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-apollon-400"
            >
              + 팀원 추가
            </button>
          ) : null}
        </div>

        {activeTab === "profile" ? (
          <section className="apollon-card p-6 md:p-8">
            <div className="mb-6 flex items-center gap-4 border-b border-slate-200 pb-6">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-apollon-500 text-2xl font-bold text-white">
                {profileName.slice(0, 1) || "A"}
              </div>
              <div>
                <p className="text-2xl font-semibold text-slate-900">{profileName || "-"}</p>
                <p className="text-slate-600">{profileEmail || "-"}</p>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">이름</label>
                <input
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">부서</label>
                <input
                  value={profileDepartment}
                  onChange={(event) => setProfileDepartment(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">역할</p>
                <p className="mt-1 inline-flex rounded-md bg-violet-100 px-2 py-1 text-sm font-medium text-violet-800">
                  {profileRole}
                </p>
              </div>
              {profileMessage ? (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {profileMessage}
                </p>
              ) : null}
              <button
                type="button"
                onClick={handleProfileSave}
                className="w-full rounded-xl bg-apollon-500 px-4 py-3 font-semibold text-white transition hover:bg-apollon-400"
              >
                변경사항 저장
              </button>
            </div>
          </section>
        ) : null}

        {activeTab === "password" ? (
          <section className="apollon-card p-6 md:p-8">
            <div className="mb-6 border-b border-slate-200 pb-6">
              <h2 className="text-2xl font-semibold text-slate-900">비밀번호 변경</h2>
              <p className="mt-2 text-slate-600">보안을 위해 주기적으로 비밀번호를 변경해주세요.</p>
            </div>

            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">현재 비밀번호</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">새 비밀번호</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="최소 6자 이상"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  새 비밀번호 확인
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="새 비밀번호를 다시 입력하세요"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>
              {passwordMessage ? (
                <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                  {passwordMessage}
                </p>
              ) : null}
              <button
                type="button"
                onClick={handlePasswordChange}
                className="w-full rounded-xl bg-apollon-500 px-4 py-3 font-semibold text-white transition hover:bg-apollon-400"
              >
                비밀번호 변경
              </button>
            </div>
          </section>
        ) : null}

        {activeTab === "team" ? (
          <section className="space-y-4">
            <div className="apollon-card p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="이름, 이메일, 부서로 검색..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40 md:max-w-xl"
                />
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-lg px-3 py-1 text-sm ${
                      canManageTeam
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {canManageTeam ? "슈퍼관리자 접근 권한" : "읽기 전용"}
                  </span>
                </div>
              </div>
            </div>

            {!canManageTeam ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                팀원 관리는 슈퍼관리자만 접근 가능합니다.
              </p>
            ) : null}

            {teamMessage ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {teamMessage}
              </p>
            ) : null}

            {loadingTeam ? <p className="text-slate-600">팀원 목록을 불러오는 중...</p> : null}

            {/* 팀원 카드 목록 시작 */}
            {filteredMembers.map((member) => (
              <article
                key={member.id}
                className="apollon-card flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold text-slate-900">{member.name}</p>
                  <p className="truncate text-sm text-slate-600">
                    {member.email} · {member.department}
                  </p>
                  <p className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-md bg-violet-100 px-2 py-0.5 font-medium text-violet-800">
                      {member.role}
                    </span>
                    <span className="rounded-md bg-slate-200 px-2 py-0.5 font-medium text-slate-800">
                      {member.status}
                    </span>
                  </p>
                </div>

                {canManageTeam ? (
                  <button
                    type="button"
                    onClick={() => setEditMember(member)}
                    className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:border-apollon-400 hover:bg-slate-50"
                  >
                    수정
                  </button>
                ) : null}
              </article>
            ))}
          </section>
        ) : null}

        {activeTab === "services" ? (
          <ServiceManagementTab canManage={canManageServices} />
        ) : null}
      </div>

      {canManageTeam ? (
        <TeamMemberEditModal
          member={editMember}
          onClose={() => setEditMember(null)}
          onSaved={handleEditMemberSaved}
        />
      ) : null}

      {inviteModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-500/45 px-4 backdrop-blur-[2px]">
          <div className="apollon-card w-full max-w-lg p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">팀원 초대</h2>
              <button
                type="button"
                onClick={handleCloseInviteModal}
                className="rounded-md px-2 py-1 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                닫기
              </button>
            </div>

            <form onSubmit={handleInviteMember} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">이름</label>
                <input
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">이메일</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">부서</label>
                <input
                  value={inviteDepartment}
                  onChange={(event) => setInviteDepartment(event.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">권한</label>
                <select
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as Role)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>

              {inviteError ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {inviteError}
                </p>
              ) : null}
              {inviteMessage ? (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {inviteMessage}
                </p>
              ) : null}

              {invitedTemporaryPassword ? (
                <div className="rounded-xl border border-apollon-200 bg-apollon-50 p-3">
                  <p className="text-xs text-slate-600">임시 비밀번호</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <code className="rounded border border-slate-200 bg-slate-100 px-2 py-1 text-sm text-apollon-800">
                      {invitedTemporaryPassword}
                    </code>
                    <button
                      type="button"
                      onClick={() => void handleCopyTemporaryPassword()}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 transition hover:border-apollon-400 hover:bg-white"
                    >
                      복사
                    </button>
                  </div>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={inviteLoading}
                className="w-full rounded-xl bg-apollon-500 px-4 py-3 font-semibold text-white transition hover:bg-apollon-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {inviteLoading ? "초대 처리 중..." : "초대 보내기"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
