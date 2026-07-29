"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { isCurrentWeekRoom, isPublicTrendRoom, type TrendRoom } from "@/lib/research/types";
import { supabase } from "@/lib/supabase/client";

export default function ResearchPage() {
  const router = useRouter();
  const { status, profile } = useRequirePortalSession();
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    setIsMobile(window.matchMedia("(max-width: 767px)").matches);
  }, []);

  useEffect(() => {
    if (isMobile !== false || status !== "ready" || !profile?.id) return;

    let cancelled = false;

    void (async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        if (!cancelled) setError("로그인 세션이 없습니다.");
        return;
      }

      const personalResponse = await fetch("/api/research/rooms", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const personalData = (await personalResponse.json()) as { room?: TrendRoom; error?: string };

      const { data, error: fetchError } = await supabase
        .from("trend_rooms")
        .select("*")
        .order("week_start", { ascending: false });

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      const rooms = (data ?? []) as TrendRoom[];
      const personalRoom =
        personalResponse.ok && personalData.room
          ? personalData.room
          : rooms.find((room) => room.room_type === "personal" && room.owner_id === profile.id);

      const publicRooms = rooms.filter((room) => isPublicTrendRoom(room));
      const currentPublicRoom = publicRooms.find((room) => isCurrentWeekRoom(room));
      const fallbackPublicRoom = publicRooms.find((room) => !room.is_archived) ?? publicRooms[0];

      const target = personalRoom ?? currentPublicRoom ?? fallbackPublicRoom;
      if (target) {
        router.replace(`/research/${target.id}`);
        return;
      }

      setError("이용 가능한 채팅방이 없습니다.");
    })();

    return () => {
      cancelled = true;
    };
  }, [isMobile, status, profile?.id, router]);

  if (isMobile === true) {
    return null;
  }

  if (isMobile === null || status === "checking") {
    return (
      <div className="hidden flex-1 items-center justify-center text-sm text-slate-500 md:flex">
        채팅방으로 이동하는 중…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-600">{error}</div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center text-sm text-slate-500">채팅방으로 이동하는 중…</div>
  );
}
