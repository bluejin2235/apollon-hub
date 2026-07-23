"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, MessageCircle, Send, Settings, SquarePen } from "lucide-react";
import { ResearchRoomsContext } from "@/components/research/research-rooms-context";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { MobileBottomTabBar, MOBILE_BOTTOM_TAB_PADDING, type MobileBottomTabItem } from "@/components/mobile/bottom-tab-bar";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";
import { isPublicTrendRoom, type TrendRoom, type TrendRoomType } from "@/lib/research/types";
import { buildCurrentWeekRoomFields, PERSONAL_ROOM_DEFAULT_NAME } from "@/lib/research/room-create";
import { getTrendRoomDisplayName } from "@/lib/research/week-label";
import { supabase } from "@/lib/supabase/client";
import { useResearchManager } from "@/lib/services/use-service-permissions";
import { MiddleAdminNotice } from "@/components/services/middle-admin-notice";
import { SERVICE_URL } from "@/lib/services/permissions";

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

function isResearchChatSection(pathname: string): boolean {
  return !pathname.startsWith("/research/sources") && !pathname.startsWith("/research/publishing");
}

function ResearchRoomList({
  pathname,
  rooms,
  variant = "sidebar",
  showLeadingDot = false
}: {
  pathname: string;
  rooms: TrendRoom[];
  variant?: "sidebar" | "mobile";
  showLeadingDot?: boolean;
}) {
  const activeRoomId = pathname.match(
    /^\/research\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  )?.[1];

  if (rooms.length === 0) {
    const emptyClass =
      variant === "mobile"
        ? "mt-4 px-3 text-sm text-neutral-500"
        : "mt-4 px-3 text-xs text-neutral-500";
    return <p className={emptyClass}>등록된 방이 없습니다.</p>;
  }

  return (
    <nav className={variant === "mobile" ? "flex flex-col gap-1" : "mt-1 flex flex-col gap-0.5"}>
      {rooms.map((room) => {
        const isActive = activeRoomId === room.id;

        if (variant === "mobile") {
          return (
            <Link
              key={room.id}
              href={`/research/${room.id}`}
              className={`flex items-center gap-3 rounded-xl px-4 py-3.5 text-sm transition ${
                isActive ? "bg-[#534AB7]/70 font-medium text-white" : "text-[#0d0d0d] hover:bg-neutral-100"
              }`}
            >
              {showLeadingDot ? (
                <span className="shrink-0" aria-hidden>
                  •
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate">{getTrendRoomDisplayName(room)}</span>
            </Link>
          );
        }

        return (
          <Link
            key={room.id}
            href={`/research/${room.id}`}
            className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition ${
              isActive
                ? "bg-[#534AB7]/70 font-medium text-white"
                : "text-white hover:bg-white/5"
            }`}
          >
            {showLeadingDot ? (
              <span className="shrink-0" aria-hidden>
                •
              </span>
            ) : null}
            <span className="truncate">{getTrendRoomDisplayName(room)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function sectionLabelClass(variant: "sidebar" | "mobile", compactTop = false): string {
  if (variant === "mobile") {
    return "px-3 pt-4 text-xs font-semibold uppercase tracking-wide text-[#8e8e8e] first:pt-0";
  }
  return compactTop
    ? "px-3 pt-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 first:pt-2"
    : "px-3 pt-4 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 first:pt-0";
}

function ResearchRoomSections({
  pathname,
  personalRooms,
  publicRooms,
  variant = "sidebar"
}: {
  pathname: string;
  personalRooms: TrendRoom[];
  publicRooms: TrendRoom[];
  variant?: "sidebar" | "mobile";
}) {
  const hasPersonal = personalRooms.length > 0;
  const hasPublic = publicRooms.length > 0;

  if (!hasPersonal && !hasPublic) {
    const emptyClass =
      variant === "mobile" ? "mt-4 px-3 text-sm text-neutral-500" : "mt-4 px-3 text-xs text-neutral-500";
    return <p className={emptyClass}>등록된 방이 없습니다.</p>;
  }

  return (
    <div className={variant === "mobile" ? "flex flex-col" : "flex flex-col"}>
      {hasPersonal ? (
        <section>
          <p className={sectionLabelClass(variant, variant === "sidebar")}>개인방</p>
          <ResearchRoomList
            pathname={pathname}
            rooms={personalRooms}
            variant={variant}
            showLeadingDot={false}
          />
        </section>
      ) : null}
      {hasPublic ? (
        <section>
          <p className={sectionLabelClass(variant, false)}>공개방</p>
          <ResearchRoomList pathname={pathname} rooms={publicRooms} variant={variant} showLeadingDot />
        </section>
      ) : null}
    </div>
  );
}

function MobileResearchRoomList({
  pathname,
  personalRooms,
  publicRooms,
  onCreated,
  canCreateRoom
}: {
  pathname: string;
  personalRooms: TrendRoom[];
  publicRooms: TrendRoom[];
  onCreated: (room: TrendRoom) => void;
  canCreateRoom: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col md:hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-[rgba(0,0,0,0.08)] px-4 py-4">
        <h2 className="text-base font-semibold text-[#0d0d0d]">✦ 트렌드 레이더</h2>
        {canCreateRoom ? <CreateRoomButton onCreated={onCreated} variant="mobile" /> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <ResearchRoomSections
          pathname={pathname}
          personalRooms={personalRooms}
          publicRooms={publicRooms}
          variant="mobile"
        />
      </div>
    </div>
  );
}

function ResearchMobileBottomNav({ pathname }: { pathname: string }) {
  const isChatActive = isResearchChatSection(pathname);
  const isSourcesActive = pathname.startsWith("/research/sources");
  const isPromptsActive = pathname.startsWith("/research/publishing/prompts");
  const isPublishingActive =
    pathname.startsWith("/research/publishing") && !isPromptsActive;

  const items: MobileBottomTabItem[] = [
    {
      href: "/research",
      label: "트렌드 수집함",
      icon: <MessageCircle aria-hidden />,
      active: isChatActive
    },
    {
      href: "/research/sources",
      label: "트렌드 구독함",
      icon: <Settings aria-hidden />,
      active: isSourcesActive
    },
    {
      href: "/research/publishing",
      label: "Publishing",
      icon: <Send aria-hidden />,
      active: isPublishingActive
    },
    {
      href: "/research/publishing/prompts",
      label: "프롬프트 관리",
      icon: <FileText aria-hidden />,
      active: isPromptsActive
    }
  ];

  return <MobileBottomTabBar items={items} variant="dark" />;
}

export default function ResearchLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, profile } = useRequirePortalSession();
  const [rooms, setRooms] = useState<TrendRoom[]>([]);

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

  const roomsContextValue = useMemo(
    () => ({
      onRoomUpdated: handleRoomUpdated,
      removeRoom: handleRemoveRoom
    }),
    [handleRoomUpdated, handleRemoveRoom]
  );
  const canManageResearch = useResearchManager() === true;
  const showMiddleAdminNotice =
    pathname.startsWith("/research/sources") || pathname.startsWith("/research/publishing");

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";
  const showMobileRoomList = pathname === "/research";
  const isRoomDetail = /^\/research\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
    pathname
  );
  const mobileScrollLocked = showMobileRoomList || isRoomDetail;
  const canCreateRoom = Boolean(profile?.id);

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-white md:h-auto md:max-h-none md:min-h-screen md:overflow-visible">
      <PortalHeader userInfoLine={userInfoLine} onLogout={() => void signOutAndRedirectToLogin()} />

      <div
        className={`flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden pt-14 md:h-[calc(100vh-3.5rem)] ${MOBILE_BOTTOM_TAB_PADDING}`}
      >
        <div className="flex min-h-0 flex-1 overflow-hidden md:h-[calc(100vh-3.5rem)]">
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

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <ResearchRoomSections
              pathname={pathname}
              personalRooms={personalRooms}
              publicRooms={publicRooms}
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
            {showMobileRoomList ? (
              <MobileResearchRoomList
                pathname={pathname}
                personalRooms={personalRooms}
                publicRooms={publicRooms}
                onCreated={handleRoomCreated}
                canCreateRoom={canCreateRoom}
              />
            ) : (
              <div
                className={`flex min-h-0 min-w-0 flex-1 flex-col ${
                  mobileScrollLocked ? "overflow-hidden" : "overflow-y-auto overscroll-contain"
                }`}
              >
                {children}
                {showMiddleAdminNotice ? (
                  <div className="shrink-0 px-4 pb-6 sm:px-6">
                    <MiddleAdminNotice serviceUrl={SERVICE_URL.RESEARCH} />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </ResearchRoomsContext.Provider>
        </div>
      </div>

      <ResearchMobileBottomNav pathname={pathname} />
    </div>
  );
}
