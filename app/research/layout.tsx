"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";
import { isCurrentWeekRoom, type TrendRoom } from "@/lib/research/types";
import { supabase } from "@/lib/supabase/client";

function ResearchSidebarNav({ pathname }: { pathname: string }) {
  const sourcesActive = pathname.startsWith("/research/sources");
  const shareActive = pathname === "/research" || pathname.startsWith("/research/");

  return (
    <nav className="mt-6 flex flex-col gap-1">
      <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">메뉴</p>
      <Link
        href="/research"
        className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${
          shareActive && !sourcesActive
            ? "bg-apollon-500/15 text-apollon-800 ring-1 ring-apollon-500/40"
            : "text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
        }`}
      >
        트렌드 공유
      </Link>
      <span className="cursor-not-allowed rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400">수집 소스 (준비 중)</span>
    </nav>
  );
}

function ResearchRoomList({ pathname, rooms }: { pathname: string; rooms: TrendRoom[] }) {
  const activeRoomId = pathname.match(/^\/research\/([^/]+)/)?.[1];

  if (rooms.length === 0) {
    return <p className="mt-3 px-3 text-xs text-slate-400">등록된 채팅방이 없습니다.</p>;
  }

  return (
    <div className="mt-6">
      <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">채팅방</p>
      <nav className="mt-2 flex flex-col gap-1">
        {rooms.map((room) => {
          const isCurrent = isCurrentWeekRoom(room);
          const isActive = activeRoomId === room.id;

          return (
            <Link
              key={room.id}
              href={`/research/${room.id}`}
              className={`rounded-xl px-3 py-2.5 text-sm transition ${
                isActive
                  ? "bg-apollon-500/15 font-semibold text-apollon-800 ring-1 ring-apollon-500/40"
                  : room.is_archived
                    ? "text-slate-500 hover:bg-slate-200/60 hover:text-slate-700"
                    : "font-medium text-slate-700 hover:bg-slate-200/80 hover:text-slate-900"
              }`}
            >
              <span className="flex items-center gap-2">
                {isCurrent ? (
                  <span className="rounded bg-apollon-500 px-1.5 py-0.5 text-[10px] font-bold text-white">현재</span>
                ) : room.is_archived ? (
                  <span className="text-[10px] text-slate-400">아카이브</span>
                ) : null}
                <span className="truncate">{room.week_label}</span>
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
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

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";

  return (
    <div className="min-h-screen">
      <PortalHeader userInfoLine={userInfoLine} onLogout={() => void signOutAndRedirectToLogin()} />

      <div className="flex w-full gap-0 pb-12 pt-0">
        <aside className="sticky top-14 z-10 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 px-4 py-6 md:block">
          <p className="text-xs font-semibold uppercase tracking-wider text-apollon-600">Research</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">✦ 트렌드 레이더</h2>
          <ResearchSidebarNav pathname={pathname} />
          <ResearchRoomList pathname={pathname} rooms={sortedRooms} />
        </aside>

        <div className="flex min-h-[calc(100vh-3.5rem)] min-w-0 flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </div>
      </div>
    </div>
  );
}
