"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isCurrentWeekRoom, type TrendRoom } from "@/lib/research/types";
import { supabase } from "@/lib/supabase/client";

export default function ResearchPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
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
      const currentRoom = rooms.find((room) => isCurrentWeekRoom(room));
      const fallbackRoom = rooms.find((room) => !room.is_archived) ?? rooms[0];

      const target = currentRoom ?? fallbackRoom;
      if (target) {
        router.replace(`/research/${target.id}`);
        return;
      }

      setError("이용 가능한 채팅방이 없습니다.");
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-600">{error}</div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center text-sm text-slate-500">채팅방으로 이동하는 중…</div>
  );
}
