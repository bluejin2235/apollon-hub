"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { MessageCircle, Send, Settings, SquarePen } from "lucide-react";
import { ResearchRoomsContext } from "@/components/research/research-rooms-context";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { MobileBottomTabBar, MOBILE_BOTTOM_TAB_PADDING, type MobileBottomTabItem } from "@/components/mobile/bottom-tab-bar";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";
import { isCurrentWeekRoom, type TrendRoom } from "@/lib/research/types";
import { formatWeekLabel, getTrendRoomWeekLabel } from "@/lib/research/week-label";
import { supabase } from "@/lib/supabase/client";

function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildCurrentWeekRoomFields(date = new Date()) {
  const monday = new Date(date);
  const dow = monday.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  monday.setDate(monday.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    week_label: formatWeekLabel(monday),
    week_start: formatLocalDate(monday),
    week_end: formatLocalDate(sunday)
  };
}

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
  const [creating, setCreating] = useState(false);

  const openModal = () => {
    setNameValue(buildCurrentWeekRoomFields().week_label);
    setModalOpen(true);
  };

  const handleConfirm = async () => {
    if (creating) return;

    setCreating(true);
    const { week_start, week_end } = buildCurrentWeekRoomFields();
    const week_label = nameValue.trim() || buildCurrentWeekRoomFields().week_label;

    const { data, error } = await supabase
      .from("trend_rooms")
      .insert({ week_label, week_start, week_end })
      .select("*")
      .single();

    setCreating(false);

    if (error || !data) return;

    const room = data as TrendRoom;
    onCreated(room);
    setModalOpen(false);
    router.push(`/research/${room.id}`);
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        disabled={creating}
        aria-label="새 채팅방 만들기"
        className={
          variant === "mobile"
            ? "rounded-lg p-1.5 text-[#534AB7] transition hover:bg-[#534AB7]/10 disabled:opacity-50"
            : "rounded-lg p-1.5 text-white transition hover:bg-white/10 disabled:opacity-50"
        }
      >
        <SquarePen className="h-4 w-4" aria-hidden />
      </button>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-[#0d0d0d]">새 채팅방 이름을 입력하세요</h2>
            <input
              type="text"
              value={nameValue}
              onChange={(event) => setNameValue(event.target.value)}
              className="mt-4 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2.5 text-sm text-[#0d0d0d] focus:border-[#0d0d0d] focus:outline-none"
              placeholder="채팅방 이름"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleConfirm();
              }}
            />
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
      ) : null}
    </>
  );
}

function isResearchChatSection(pathname: string): boolean {
  return !pathname.startsWith("/research/sources") && !pathname.startsWith("/research/publishing");
}

function ResearchRoomList({
  pathname,
  rooms,
  variant = "sidebar"
}: {
  pathname: string;
  rooms: TrendRoom[];
  variant?: "sidebar" | "mobile";
}) {
  const activeRoomId = pathname.match(
    /^\/research\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  )?.[1];

  if (rooms.length === 0) {
    const emptyClass =
      variant === "mobile"
        ? "mt-4 px-3 text-sm text-neutral-500"
        : "mt-4 px-3 text-xs text-neutral-500";
    return <p className={emptyClass}>등록된 채팅방이 없습니다.</p>;
  }

  return (
    <nav className={variant === "mobile" ? "flex flex-col gap-1" : "mt-6 flex flex-col gap-0.5"}>
      {rooms.map((room) => {
        const isCurrent = isCurrentWeekRoom(room);
        const isActive = activeRoomId === room.id;
        const isPast = room.is_archived || !isCurrent;

        if (variant === "mobile") {
          return (
            <Link
              key={room.id}
              href={`/research/${room.id}`}
              className={`flex items-center gap-3 rounded-xl px-4 py-3.5 text-sm transition ${
                isActive ? "bg-[#534AB7]/10 text-[#534AB7]" : "text-[#0d0d0d] hover:bg-neutral-100"
              }`}
            >
              {isCurrent ? (
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#534AB7]" aria-hidden />
              ) : (
                <span className="h-2 w-2 shrink-0 rounded-full bg-neutral-300" aria-hidden />
              )}
              <span className={`min-w-0 flex-1 truncate ${isCurrent && !isActive ? "font-semibold" : ""}`}>
                {getTrendRoomWeekLabel(room)}
              </span>
            </Link>
          );
        }

        return (
          <Link
            key={room.id}
            href={`/research/${room.id}`}
            className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition ${
              isActive ? "bg-white/10 text-white" : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
            }`}
          >
            {isCurrent ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" aria-hidden />
            ) : (
              <span className="h-1.5 w-1.5 shrink-0" aria-hidden />
            )}
            <span className={`truncate ${isCurrent && !isActive ? "font-medium text-white" : isPast ? "text-neutral-500" : ""}`}>
              {getTrendRoomWeekLabel(room)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function MobileResearchRoomList({
  pathname,
  rooms,
  onCreated
}: {
  pathname: string;
  rooms: TrendRoom[];
  onCreated: (room: TrendRoom) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col md:hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-[rgba(0,0,0,0.08)] px-4 py-4">
        <h2 className="text-base font-semibold text-[#0d0d0d]">✦ 트렌드 레이더</h2>
        <CreateRoomButton onCreated={onCreated} variant="mobile" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <ResearchRoomList pathname={pathname} rooms={rooms} variant="mobile" />
      </div>
    </div>
  );
}

function ResearchMobileBottomNav({ pathname }: { pathname: string }) {
  const isChatActive = isResearchChatSection(pathname);
  const isSourcesActive = pathname.startsWith("/research/sources");
  const isPublishingActive = pathname.startsWith("/research/publishing");

  const items: MobileBottomTabItem[] = [
    {
      href: "/research",
      label: "채팅방",
      icon: <MessageCircle aria-hidden />,
      active: isChatActive
    },
    {
      href: "/research/sources",
      label: "수집사이트 설정",
      icon: <Settings aria-hidden />,
      active: isSourcesActive
    },
    {
      href: "/research/publishing",
      label: "Publishing",
      icon: <Send aria-hidden />,
      active: isPublishingActive
    }
  ];

  return <MobileBottomTabBar items={items} variant="dark" />;
}

export default function ResearchLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, profile } = useRequirePortalSession();
  const [rooms, setRooms] = useState<TrendRoom[]>([]);

  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("trend_rooms")
        .select("*")
        .order("week_start", { ascending: false });

      if (cancelled || error) return;
      setRooms((data ?? []) as TrendRoom[]);
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);

  const sortedRooms = useMemo(
    () => [...rooms].sort((a, b) => new Date(b.week_start).getTime() - new Date(a.week_start).getTime()),
    [rooms]
  );

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

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";
  const isSourcesActive = pathname.startsWith("/research/sources");
  const isPublishingActive = pathname.startsWith("/research/publishing");
  const showMobileRoomList = pathname === "/research";
  const isRoomDetail = /^\/research\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
    pathname
  );
  const mobileScrollLocked = showMobileRoomList || isRoomDetail;

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-white md:h-auto md:max-h-none md:min-h-screen md:overflow-visible">
      <PortalHeader userInfoLine={userInfoLine} onLogout={() => void signOutAndRedirectToLogin()} />

      <div
        className={`flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden pt-14 md:h-[calc(100vh-3.5rem)] md:overflow-visible ${MOBILE_BOTTOM_TAB_PADDING}`}
      >
        <div className="flex min-h-0 flex-1 overflow-hidden md:overflow-visible">
        <aside className="hidden w-64 shrink-0 flex-col bg-[#171717] md:flex">
          <div className="flex-1 overflow-y-auto px-3 py-5">
            <div className="flex items-center justify-between px-3">
              <h2 className="text-base font-semibold text-white">✦ 트렌드 레이더</h2>
              <CreateRoomButton onCreated={(room) => setRooms((prev) => [room, ...prev])} />
            </div>
            <ResearchRoomList pathname={pathname} rooms={sortedRooms} />
          </div>

          <div className="shrink-0 border-t border-white/10 px-3 py-4">
            <nav className="flex flex-col gap-0.5">
              <Link
                href="/research/sources"
                className={`block rounded-lg px-3 py-2.5 text-sm transition ${
                  isSourcesActive
                    ? "bg-white/10 font-medium text-white"
                    : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
                }`}
              >
                수집사이트 설정
              </Link>
              <Link
                href="/research/publishing"
                className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition ${
                  isPublishingActive
                    ? "bg-white/10 font-medium text-white"
                    : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
                }`}
              >
                <Send className="h-4 w-4 shrink-0" aria-hidden />
                Publishing
              </Link>
            </nav>
          </div>
        </aside>

        <ResearchRoomsContext.Provider value={roomsContextValue}>
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white md:overflow-visible"
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
                rooms={sortedRooms}
                onCreated={(room) => setRooms((prev) => [room, ...prev])}
              />
            ) : (
              <div
                className={`flex min-h-0 min-w-0 flex-1 flex-col md:overflow-visible ${
                  mobileScrollLocked ? "overflow-hidden" : "overflow-y-auto overscroll-contain"
                }`}
              >
                {children}
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
