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
import { isCurrentWeekRoom, isPublicTrendRoom, type TrendRoom, type TrendRoomType } from "@/lib/research/types";
import { buildCurrentWeekRoomFields, PERSONAL_ROOM_DEFAULT_NAME } from "@/lib/research/room-create";
import { getTrendRoomDisplayName } from "@/lib/research/week-label";
import { supabase } from "@/lib/supabase/client";

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

function isResearchChatSection(pathname: string): boolean {
  return !pathname.startsWith("/research/sources") && !pathname.startsWith("/research/publishing");
}

function ResearchRoomList({
  pathname,
  rooms,
  variant = "sidebar",
  showWeekIndicator = true
}: {
  pathname: string;
  rooms: TrendRoom[];
  variant?: "sidebar" | "mobile";
  showWeekIndicator?: boolean;
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
        const isCurrent = showWeekIndicator && isPublicTrendRoom(room) && isCurrentWeekRoom(room);
        const isActive = activeRoomId === room.id;
        const isPast = showWeekIndicator && (room.is_archived || !isCurrentWeekRoom(room));

        if (variant === "mobile") {
          return (
            <Link
              key={room.id}
              href={`/research/${room.id}`}
              className={`flex items-center gap-3 rounded-xl px-4 py-3.5 text-sm transition ${
                isActive ? "bg-[#534AB7]/10 text-[#534AB7]" : "text-[#0d0d0d] hover:bg-neutral-100"
              }`}
            >
              {showWeekIndicator ? (
                isCurrent ? (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[#534AB7]" aria-hidden />
                ) : (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-neutral-300" aria-hidden />
                )
              ) : (
                <span className="h-2 w-2 shrink-0" aria-hidden />
              )}
              <span className={`min-w-0 flex-1 truncate ${isCurrent && !isActive ? "font-semibold" : ""}`}>
                {getTrendRoomDisplayName(room)}
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
            {showWeekIndicator ? (
              isCurrent ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" aria-hidden />
              ) : (
                <span className="h-1.5 w-1.5 shrink-0" aria-hidden />
              )
            ) : (
              <span className="h-1.5 w-1.5 shrink-0" aria-hidden />
            )}
            <span
              className={`truncate ${isCurrent && !isActive ? "font-medium text-white" : isPast ? "text-neutral-500" : ""}`}
            >
              {getTrendRoomDisplayName(room)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function sectionLabelClass(variant: "sidebar" | "mobile"): string {
  return variant === "mobile"
    ? "px-3 pt-4 text-xs font-semibold uppercase tracking-wide text-[#8e8e8e] first:pt-0"
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
    return <p className={emptyClass}>등록된 채팅방이 없습니다.</p>;
  }

  return (
    <div className={variant === "mobile" ? "flex flex-col" : "mt-6 flex flex-col"}>
      {hasPersonal ? (
        <section>
          <p className={sectionLabelClass(variant)}>개인</p>
          <ResearchRoomList
            pathname={pathname}
            rooms={personalRooms}
            variant={variant}
            showWeekIndicator={false}
          />
        </section>
      ) : null}
      {hasPublic ? (
        <section>
          <p className={sectionLabelClass(variant)}>공개방</p>
          <ResearchRoomList pathname={pathname} rooms={publicRooms} variant={variant} />
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

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";
  const isChatActive = isResearchChatSection(pathname);
  const isSourcesActive = pathname.startsWith("/research/sources");
  const isPromptsActive = pathname.startsWith("/research/publishing/prompts");
  const isPublishingActive =
    pathname.startsWith("/research/publishing") && !isPromptsActive;
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
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
            <div className="flex items-center justify-between px-3">
              <h2 className="text-base font-semibold text-white">✦ 트렌드 레이더</h2>
              {canCreateRoom ? (
                <CreateRoomButton onCreated={handleRoomCreated} />
              ) : null}
            </div>
            <ResearchRoomSections
              pathname={pathname}
              personalRooms={personalRooms}
              publicRooms={publicRooms}
            />
          </div>

          <div className="shrink-0 border-t border-white/10 px-3 py-4">
            <nav className="flex flex-col gap-0.5">
              <Link
                href="/research"
                className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition ${
                  isChatActive
                    ? "bg-white/10 font-medium text-white"
                    : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
                }`}
              >
                <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
                채팅방
              </Link>
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
              <Link
                href="/research/publishing/prompts"
                className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition ${
                  isPromptsActive
                    ? "bg-white/10 font-medium text-white"
                    : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
                }`}
              >
                <FileText className="h-4 w-4 shrink-0" aria-hidden />
                프롬프트 관리
              </Link>
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
