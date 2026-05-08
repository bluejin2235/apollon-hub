"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type TabKey = "profile" | "password" | "team";
type Role = "슈퍼관리자" | "중간관리자" | "멤버";
type Status = "근무" | "휴직" | "퇴사";

type TeamMember = {
  id: string;
  name: string;
  email: string;
  department: string;
  role: Role;
  status: Status;
  created_at?: string;
};

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "profile", label: "프로필" },
  { key: "password", label: "비밀번호" },
  { key: "team", label: "팀원 관리" }
];

const roleOptions: Role[] = ["슈퍼관리자", "중간관리자", "멤버"];
const statusOptions: Status[] = ["근무", "휴직", "퇴사"];

export default function SettingsPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<"checking" | "ready">("checking");
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
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [search, setSearch] = useState("");
  const [loadingTeam, setLoadingTeam] = useState(true);

  const canManageTeam = profileRole === "슈퍼관리자";

  useEffect(() => {
    const loadData = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!session?.user?.email) {
        router.replace("/");
        return;
      }

      const { data: currentProfile, error: profileError } = await supabase
        .from("profiles")
        .select("id, email, name, department, role")
        .eq("email", session.user.email)
        .single();

      if (profileError || !currentProfile) {
        await supabase.auth.signOut();
        router.replace("/");
        return;
      }

      setProfileId(currentProfile.id);
      setProfileEmail(currentProfile.email);
      setProfileName(currentProfile.name);
      setProfileDepartment(currentProfile.department);
      setProfileRole(currentProfile.role as Role);

      const { data: members } = await supabase
        .from("profiles")
        .select("id, name, email, department, role, status, created_at")
        .order("created_at", { ascending: true });

      setTeamMembers((members ?? []) as TeamMember[]);
      setLoadingTeam(false);
      setAuthState("ready");
    };

    void loadData();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/");
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

  const handleMemberRoleChange = async (memberId: string, role: Role) => {
    if (!canManageTeam) {
      return;
    }

    await supabase.from("profiles").update({ role }).eq("id", memberId);
    setTeamMembers((previous) =>
      previous.map((member) => (member.id === memberId ? { ...member, role } : member))
    );
    setTeamMessage("팀원 권한을 업데이트했습니다.");
  };

  const handleMemberStatusChange = async (memberId: string, status: Status) => {
    if (!canManageTeam) {
      return;
    }

    await supabase.from("profiles").update({ status }).eq("id", memberId);
    setTeamMembers((previous) =>
      previous.map((member) => (member.id === memberId ? { ...member, status } : member))
    );
    setTeamMessage("팀원 상태를 업데이트했습니다.");
  };

  if (authState === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-300">
        인증 상태를 확인하는 중...
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-apollon-500/30 bg-cyan-900/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-apollon-500/90 text-center text-sm font-bold leading-7 text-white">
              A
            </div>
            <Link href="/hub" className="text-xl font-medium text-white">
              Apollon Hub
            </Link>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-md bg-white/10 px-2 py-1 text-slate-100">
              {profileName || "-"} / {profileDepartment || "-"}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md px-3 py-1.5 text-slate-100 transition hover:bg-white/10 hover:text-white"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-10 md:px-8">
        <div className="mb-7">
          <h1 className="text-3xl font-bold text-white">설정</h1>
          <p className="mt-2 text-slate-300">프로필 및 계정 설정을 관리하세요.</p>
        </div>

        <nav className="mb-7 inline-flex rounded-xl border border-slate-800/80 bg-slate-900/70 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-4 py-2 text-sm transition ${
                activeTab === tab.key
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === "profile" ? (
          <section className="apollon-card p-6 md:p-8">
            <div className="mb-6 flex items-center gap-4 border-b border-slate-800 pb-6">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-apollon-500 text-2xl font-bold text-white">
                {profileName.slice(0, 1) || "A"}
              </div>
              <div>
                <p className="text-2xl font-semibold text-white">{profileName || "-"}</p>
                <p className="text-slate-400">{profileEmail || "-"}</p>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">이름</label>
                <input
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">부서</label>
                <input
                  value={profileDepartment}
                  onChange={(event) => setProfileDepartment(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3">
                <p className="text-xs text-slate-400">역할</p>
                <p className="mt-1 inline-flex rounded-md bg-violet-500/20 px-2 py-1 text-sm font-medium text-violet-200">
                  {profileRole}
                </p>
              </div>
              {profileMessage ? (
                <p className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">
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
            <div className="mb-6 border-b border-slate-800 pb-6">
              <h2 className="text-2xl font-semibold text-white">비밀번호 변경</h2>
              <p className="mt-2 text-slate-400">보안을 위해 주기적으로 비밀번호를 변경해주세요.</p>
            </div>

            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">현재 비밀번호</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">새 비밀번호</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="최소 6자 이상"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white placeholder:text-slate-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  새 비밀번호 확인
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="새 비밀번호를 다시 입력하세요"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white placeholder:text-slate-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>
              {passwordMessage ? (
                <p className="rounded-xl border border-sky-500/40 bg-sky-950/30 px-3 py-2 text-sm text-sky-300">
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
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40 md:max-w-xl"
                />
                <span
                  className={`rounded-lg px-3 py-1 text-sm ${
                    canManageTeam
                      ? "bg-emerald-500/20 text-emerald-200"
                      : "bg-amber-500/20 text-amber-200"
                  }`}
                >
                  {canManageTeam ? "슈퍼관리자 접근 권한" : "읽기 전용"}
                </span>
              </div>
            </div>

            {!canManageTeam ? (
              <p className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                팀원 관리는 슈퍼관리자만 접근 가능합니다.
              </p>
            ) : null}

            {teamMessage ? (
              <p className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">
                {teamMessage}
              </p>
            ) : null}

            {loadingTeam ? <p className="text-slate-300">팀원 목록을 불러오는 중...</p> : null}

            {filteredMembers.map((member) => (
              <article
                key={member.id}
                className="apollon-card flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-white">{member.name}</p>
                  <p className="truncate text-sm text-slate-400">
                    {member.email} · {member.department}
                  </p>
                </div>

                <div className="flex flex-col gap-2 text-sm md:flex-row md:items-center">
                  <select
                    value={member.role}
                    disabled={!canManageTeam}
                    onChange={(event) =>
                      void handleMemberRoleChange(member.id, event.target.value as Role)
                    }
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 disabled:opacity-60"
                  >
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <select
                    value={member.status}
                    disabled={!canManageTeam}
                    onChange={(event) =>
                      void handleMemberStatusChange(member.id, event.target.value as Status)
                    }
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 disabled:opacity-60"
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
              </article>
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}
