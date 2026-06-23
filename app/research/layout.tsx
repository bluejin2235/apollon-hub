"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { SquarePen } from "lucide-react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";
import { isCurrentWeekRoom, type TrendRoom } from "@/lib/research/types";
import { supabase } from "@/lib/supabase/client";

function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getIsoWeekYearAndNumber(date: Date): { isoYear: number; isoWeek: number } {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const isoYear = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { isoYear, isoWeek };
}

function buildCurrentWeekRoomFields(date = new Date()) {
  const monday = new Date(date);
  const dow = monday.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  monday.setDate(monday.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const { isoYear, isoWeek } = getIsoWeekYearAndNumber(date);
  return {
    week_label: `${isoYear}-W${String(isoWeek).padStart(2, "0")} 트렌드방`,
    week_start: formatLocalDate(monday),
    week_end: formatLocalDate(sunday)
  };
}

function CreateRoomButton({ onCreated }: { onCreated: (room: TrendRoom) => void }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (creating) return;

    setCreating(true);
    const { week_label, week_start, week_end } = buildCurrentWeekRoomFields();

    const { data, error } = await supabase
      .from("trend_rooms")
      .insert({ week_label, week_start, week_end })
      .select("*")
      .single();

    setCreating(false);

    if (error || !data) return;

    const room = data as TrendRoom;
    onCreated(room);
    router.push(`/research/${room.id}`);
  };

  return (
    <button
      type="button"
      onClick={() => void handleCreate()}
      disabled={creating}
      aria-label="새 채팅방 만들기"
      className="rounded-lg p-1.5 text-white transition hover:bg-white/10 disabled:opacity-50"
    >
      <SquarePen className="h-4 w-4" aria-hidden />
    </button>
  );
}

function ResearchRoomList({ pathname, rooms }: { pathname: string; rooms: TrendRoom[] }) {
  const activeRoomId = pathname.match(/^\/research\/([^/]+)/)?.[1];

  if (rooms.length === 0) {
    return <p className="mt-4 px-3 text-xs text-neutral-500">등록된 채팅방이 없습니다.</p>;
  }

  return (
    <nav className="mt-6 flex flex-col gap-0.5">
      {rooms.map((room) => {
        const isCurrent = isCurrentWeekRoom(room);
        const isActive = activeRoomId === room.id;
        const isPast = room.is_archived || !isCurrent;

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
              {room.week_label}
            </span>
          </Link>
        );
      })}
    </nav>
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
    <div className="min-h-screen bg-white">
      <PortalHeader userInfoLine={userInfoLine} onLogout={() => void signOutAndRedirectToLogin()} />

      <div className="flex h-[calc(100vh-3.5rem)] w-full">
        <aside className="hidden w-64 shrink-0 flex-col bg-[#171717] md:flex">
          <div className="flex-1 overflow-y-auto px-3 py-5">
            <div className="flex items-center justify-between px-3">
              <h2 className="text-base font-semibold text-white">✦ 트렌드 레이더</h2>
              <CreateRoomButton onCreated={(room) => setRooms((prev) => [room, ...prev])} />
            </div>
            <ResearchRoomList pathname={pathname} rooms={sortedRooms} />
          </div>

          <div className="shrink-0 border-t border-white/10 px-3 py-4">
            <span className="block cursor-not-allowed rounded-lg px-3 py-2.5 text-sm text-neutral-500">수집 소스</span>
          </div>
        </aside>

        <div
          className="flex min-w-0 flex-1 flex-col bg-white"
          style={
            {
              "--color-background-secondary": "#f4f4f4",
              "--color-border": "rgba(0, 0, 0, 0.1)"
            } as React.CSSProperties
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
