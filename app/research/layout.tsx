"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, FileText, Inbox, Send, Settings, Settings2, SquarePen, User, Users } from "lucide-react";
import { ResearchRoomsContext } from "@/components/research/research-rooms-context";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { MobileSubNav, MOBILE_SUBNAV_PADDING } from "@/components/portal/MobileSubNav";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";
import {
  isPersonalTrendRoom,
  isPublicTrendRoom,
  type TrendRoom,
  type TrendRoomType
} from "@/lib/research/types";
import { buildCurrentWeekRoomFields, PERSONAL_ROOM_DEFAULT_NAME } from "@/lib/research/room-create";
import { getTrendRoomDisplayName } from "@/lib/research/week-label";
import { supabase } from "@/lib/supabase/client";
import { useResearchManager } from "@/lib/services/use-service-permissions";

function CreateRoomButton({
  onCreated,
  variant = "sidebar"
}: {
  onCreated: (room: TrendRoom) => void;
  variant?: "sidebar" | "mobile";
}) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [roomType, setRoomType] = useState<TrendRoomType>("public");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [portalMounted, setPortalMounted] = useState(false);

  useEffect(() => {
    setPortalMounted(true);
  }, []);

  const openModal = () => {
    setRoomType("public");
    setNameValue(buildCurrentWeekRoomFields().week_label);
    setCreateError(null);
    setModalOpen(true);
  };

  const handleRoomTypeChange = (nextType: TrendRoomType) => {
    setRoomType(nextType);
    if (nextType === "personal") {
      setNameValue(PERSONAL_ROOM_DEFAULT_NAME);
    } else {
      setNameValue(buildCurrentWeekRoomFields().week_label);
    }
  };

  const handleConfirm = async () => {
    if (creating) return;

    setCreating(true);
    setCreateError(null);

    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        setCreateError("로그인 세션이 없습니다.");
        return;
      }

      const response = await fetch("/api/research/rooms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: nameValue.trim() || undefined,
          room_type: roomType
        })
      });

      const data = (await response.json()) as { room?: TrendRoom; error?: string };

      if (!response.ok || !data.room) {
        setCreateError(data.error ?? "채팅방 생성에 실패했습니다.");
        return;
      }

      onCreated(data.room);
      setModalOpen(false);
      router.push(`/research/${data.room.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "채팅방 생성에 실패했습니다.");
    } finally {
      setCreating(false);
    }
  };

  const modal =
    modalOpen && portalMounted ? (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-room-title"
      >
        <div className="relative z-[61] w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
          <h2 id="create-room-title" className="text-base font-semibold text-[#0d0d0d]">
            새 채팅방 만들기
          </h2>
          <p className="mt-1 text-sm text-[#676767]">방 유형을 선택하고 이름을 입력하세요.</p>
          <div className="mt-4 flex gap-2">
            {(
              [
                { value: "personal" as const, label: "개인방" },
                { value: "public" as const, label: "공개방" }
              ] as const
            ).map((option) => {
              const selected = roomType === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleRoomTypeChange(option.value)}
                  className={`flex-1 rounded-xl border px-4 py-2 text-sm font-medium transition ${
                    selected
                      ? "border-[#534AB7] bg-[#534AB7]/10 text-[#534AB7]"
                      : "border-[rgba(0,0,0,0.12)] text-[#676767] hover:border-[rgba(0,0,0,0.2)]"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            value={nameValue}
            onChange={(event) => setNameValue(event.target.value)}
            className="mt-4 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2.5 text-sm text-[#0d0d0d] focus:border-[#0d0d0d] focus:outline-none"
            placeholder={roomType === "personal" ? "개인방 이름" : "공개방 이름"}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleConfirm();
            }}
          />
          {createError ? <p className="mt-2 text-sm text-red-600">{createError}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              disabled={creating}
              className="rounded-lg px-4 py-2 text-sm text-[#676767] hover:bg-[#f4f4f4]"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={creating}
              className="rounded-lg bg-[#0d0d0d] px-4 py-2 text-sm font-medium text-white hover:bg-[#333] disabled:opacity-50"
            >
              {creating ? "생성 중…" : "확인"}
            </button>
          </div>
        </div>
      </div>
    ) : null;

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        disabled={creating}
        aria-label="새 공개방 만들기"
        className={
          variant === "mobile"
            ? "rounded-lg p-1.5 text-[#534AB7] transition hover:bg-[#534AB7]/10 disabled:opacity-50"
            : "rounded-lg p-1.5 text-white transition hover:bg-white/10 disabled:opacity-50"
        }
      >
        <SquarePen className="h-4 w-4" aria-hidden />
      </button>

      {modal ? createPortal(modal, document.body) : null}
    </>
  );
}

function IconInbox(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" />
      <path d="M4 13h3l3 3h4l3 -3h3" />
    </svg>
  );
}

function ResearchRoomList({
  pathname,
  rooms,
  tone = "dark",
  onNavigate
}: {
  pathname: string;
  rooms: TrendRoom[];
  tone?: "dark" | "light";
  onNavigate?: () => void;
}) {
  const activeRoomId = pathname.match(
    /^\/research\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  )?.[1];

  if (rooms.length === 0) {
    return (
      <p className={`mt-2 px-3 text-xs ${tone === "light" ? "text-neutral-500" : "text-neutral-500"}`}>
        등록된 방이 없습니다.
      </p>
    );
  }

  return (
    <nav className="mt-1 flex flex-col">
      {rooms.map((room) => {
        const isActive = activeRoomId === room.id;
        const isPersonal = isPersonalTrendRoom(room);
        const Icon = isPersonal ? User : Users;
        const badge = isPersonal ? "개인" : "공개";

        return (
          <Link
            key={room.id}
            href={`/research/${room.id}`}
            onClick={onNavigate}
            className={`flex h-11 items-center gap-2 px-3 ${
              isActive
                ? "bg-[#EEEDFE] font-medium text-[#26215C]"
                : tone === "light"
                  ? "text-slate-800 hover:bg-slate-50"
                  : "text-white hover:bg-white/5"
            }`}
          >
            <Icon
              className={`h-3.5 w-3.5 shrink-0 ${
                isActive
                  ? "text-[#534AB7]"
                  : tone === "light"
                    ? "text-slate-500"
                    : "text-neutral-400"
              }`}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-[13.5px]">
              {getTrendRoomDisplayName(room)}
            </span>
            <span
              className={`shrink-0 text-[10px] ${
                isActive
                  ? "text-[#534AB7]"
                  : tone === "light"
                    ? "text-slate-500"
                    : "text-neutral-500"
              }`}
            >
              {badge}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function sectionLabelClass(tone: "dark" | "light", compactTop = false): string {
  const color = tone === "light" ? "text-[#8e8e8e]" : "text-neutral-500";
  return compactTop
    ? `px-3 pt-3 text-[11px] font-semibold uppercase tracking-wide ${color} first:pt-2`
    : `px-3 pt-4 text-[11px] font-semibold uppercase tracking-wide ${color} first:pt-0`;
}

function ResearchRoomSections({
  pathname,
  personalRooms,
  publicRooms,
  tone = "dark",
  onNavigate
}: {
  pathname: string;
  personalRooms: TrendRoom[];
  publicRooms: TrendRoom[];
  tone?: "dark" | "light";
  onNavigate?: () => void;
}) {
  const hasPersonal = personalRooms.length > 0;
  const hasPublic = publicRooms.length > 0;

  if (!hasPersonal && !hasPublic) {
    return (
      <p className={`mt-4 px-3 text-xs ${tone === "light" ? "text-neutral-500" : "text-neutral-500"}`}>
        등록된 방이 없습니다.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {hasPersonal ? (
        <section>
          <p className={sectionLabelClass(tone, true)}>개인방</p>
          <ResearchRoomList
            pathname={pathname}
            rooms={personalRooms}
            tone={tone}
            onNavigate={onNavigate}
          />
        </section>
      ) : null}
      {hasPublic ? (
        <section>
          <p className={sectionLabelClass(tone, false)}>공개방</p>
          <ResearchRoomList
            pathname={pathname}
            rooms={publicRooms}
            tone={tone}
            onNavigate={onNavigate}
          />
        </section>
      ) : null}
    </div>
  );
}

function ResearchDrawerPanel({
  pathname,
  personalRooms,
  publicRooms,
  onCreated,
  canCreateRoom,
  onNavigate
}: {
  pathname: string;
  personalRooms: TrendRoom[];
  publicRooms: TrendRoom[];
  onCreated: (room: TrendRoom) => void;
  canCreateRoom: boolean;
  onNavigate: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-3">
        <h2 className="text-sm font-semibold text-slate-900">✦ 트렌드 레이더</h2>
        {canCreateRoom ? <CreateRoomButton onCreated={onCreated} variant="mobile" /> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        <ResearchRoomSections
          pathname={pathname}
          personalRooms={personalRooms}
          publicRooms={publicRooms}
          tone="light"
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}

const RESEARCH_MOBILE_SUBNAV_ITEMS = [
  { href: "/research", label: "수집함", icon: <Inbox aria-hidden /> },
  { href: "/research/sources", label: "구독함", icon: <Bookmark aria-hidden /> },
  { href: "/research/publishing", label: "Publishing", icon: <Send aria-hidden /> },
  { href: "/research/publishing/prompts", label: "프롬프트", icon: <Settings2 aria-hidden /> }
];

export default function ResearchLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, profile } = useRequirePortalSession();
  const [rooms, setRooms] = useState<TrendRoom[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadRooms = useCallback(async () => {
    if (!profile?.id) return;

    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) return;

      const personalResponse = await fetch("/api/research/rooms", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const personalData = (await personalResponse.json()) as { room?: TrendRoom; error?: string };

      const { data, error } = await supabase
        .from("trend_rooms")
        .select("*")
        .order("week_start", { ascending: false });

      if (error) return;

      let merged = (data ?? []) as TrendRoom[];

      if (personalResponse.ok && personalData.room) {
        const personalRoom = personalData.room;
        const existingIndex = merged.findIndex((room) => room.id === personalRoom.id);
        if (existingIndex >= 0) {
          merged = merged.map((room, index) => (index === existingIndex ? personalRoom : room));
        } else {
          merged = [personalRoom, ...merged];
        }
      }

      setRooms(merged);
    } catch {
      // 목록 갱신 실패 시 기존 state 유지
    }
  }, [profile?.id]);

  useEffect(() => {
    if (status !== "ready" || !profile?.id) return;
    void loadRooms();
  }, [status, profile?.id, loadRooms]);

  const sortedRooms = useMemo(
    () => [...rooms].sort((a, b) => new Date(b.week_start).getTime() - new Date(a.week_start).getTime()),
    [rooms]
  );

  const personalRooms = useMemo(() => {
    if (!profile?.id) return [];
    return sortedRooms.filter(
      (room) => room.room_type === "personal" && room.owner_id === profile.id
    );
  }, [sortedRooms, profile?.id]);

  const publicRooms = useMemo(() => {
    return sortedRooms.filter((room) => isPublicTrendRoom(room));
  }, [sortedRooms]);

  const handleRoomCreated = useCallback((room: TrendRoom) => {
    setRooms((prev) => [room, ...prev.filter((item) => item.id !== room.id)]);
  }, []);

  const handleRoomUpdated = useCallback((room: TrendRoom) => {
    setRooms((prev) => prev.map((item) => (item.id === room.id ? room : item)));
  }, []);

  const handleRemoveRoom = useCallback((roomId: string) => {
    setRooms((prev) => prev.filter((item) => item.id !== roomId));
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);

  const roomsContextValue = useMemo(
    () => ({
      onRoomUpdated: handleRoomUpdated,
      removeRoom: handleRemoveRoom,
      openDrawer,
      closeDrawer
    }),
    [handleRoomUpdated, handleRemoveRoom, openDrawer, closeDrawer]
  );
  const canManageResearch = useResearchManager() === true;

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";
  const isRoomDetail = /^\/research\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
    pathname
  );
  const canCreateRoom = Boolean(profile?.id);

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-white md:h-auto md:max-h-none md:min-h-screen md:overflow-visible">
      <PortalHeader userInfoLine={userInfoLine} onLogout={() => void signOutAndRedirectToLogin()} />

      <div
        className={`flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden pt-14 md:h-[calc(100vh-3.5rem)] ${MOBILE_SUBNAV_PADDING}`}
      >
        <div className="relative flex min-h-0 flex-1 overflow-hidden md:h-[calc(100vh-3.5rem)]">
          <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 flex-col overflow-hidden bg-[#171717] md:flex">
            <div className="shrink-0 px-3 pt-5">
              <div className="flex items-center justify-between px-3">
                <h2 className="text-base font-semibold text-white">✦ 트렌드 레이더</h2>
                {canCreateRoom ? (
                  <CreateRoomButton onCreated={handleRoomCreated} />
                ) : null}
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-neutral-400">
                <IconInbox className="h-4 w-4 shrink-0" />
                트렌드 수집함
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
              <ResearchRoomSections
                pathname={pathname}
                personalRooms={personalRooms}
                publicRooms={publicRooms}
                tone="dark"
              />
            </div>

            <div className="shrink-0 border-t border-white/10 px-3 py-4">
              <nav className="flex flex-col gap-0.5">
                <Link
                  href="/research/sources"
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-neutral-400 transition hover:bg-white/5 hover:text-neutral-200"
                >
                  <Settings className="h-4 w-4 shrink-0" aria-hidden />
                  트렌드 구독함
                </Link>
                {canManageResearch ? (
                  <>
                    <Link
                      href="/research/publishing"
                      className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-neutral-400 transition hover:bg-white/5 hover:text-neutral-200"
                    >
                      <Send className="h-4 w-4 shrink-0" aria-hidden />
                      Publishing
                    </Link>
                    <Link
                      href="/research/publishing/prompts"
                      className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-neutral-400 transition hover:bg-white/5 hover:text-neutral-200"
                    >
                      <FileText className="h-4 w-4 shrink-0" aria-hidden />
                      프롬프트 관리
                    </Link>
                  </>
                ) : null}
              </nav>
            </div>
          </aside>

          {/* 모바일 드로어 */}
          <div
            className={`fixed inset-0 z-50 md:hidden ${drawerOpen ? "" : "pointer-events-none"}`}
            aria-hidden={!drawerOpen}
          >
            <button
              type="button"
              aria-label="메뉴 닫기"
              className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
                drawerOpen ? "opacity-100" : "opacity-0"
              }`}
              onClick={closeDrawer}
            />
            <div
              className={`absolute inset-y-0 left-0 flex w-[min(280px,86vw)] transform bg-white shadow-xl transition-transform duration-200 ${
                drawerOpen ? "translate-x-0" : "-translate-x-full"
              }`}
            >
              <div className="h-full w-full p-2 pt-[calc(3.5rem+0.5rem)]">
                <ResearchDrawerPanel
                  pathname={pathname}
                  personalRooms={personalRooms}
                  publicRooms={publicRooms}
                  onCreated={(room) => {
                    handleRoomCreated(room);
                    closeDrawer();
                  }}
                  canCreateRoom={canCreateRoom}
                  onNavigate={closeDrawer}
                />
              </div>
            </div>
          </div>

          <ResearchRoomsContext.Provider value={roomsContextValue}>
            <div
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white md:h-[calc(100vh-3.5rem)] md:overflow-y-auto"
              style={
                {
                  "--color-background-secondary": "#f4f4f4",
                  "--color-border": "rgba(0, 0, 0, 0.1)"
                } as React.CSSProperties
              }
            >
              <div
                className={`flex min-h-0 min-w-0 flex-1 flex-col ${
                  isRoomDetail ? "overflow-hidden" : "overflow-y-auto overscroll-contain"
                }`}
              >
                {children}
              </div>
            </div>
          </ResearchRoomsContext.Provider>
        </div>
      </div>

      <MobileSubNav items={RESEARCH_MOBILE_SUBNAV_ITEMS} />
    </div>
  );
}
