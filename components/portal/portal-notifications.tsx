"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatSupplyDateTime } from "@/lib/supplies/utils";
type SupplyNotification = {
  id: string;
  message: string;
  is_read: boolean;
  created_at: string;
};
import { supabase } from "@/lib/supabase/client";

type Props = {
  userId: string;
};

function IconBell(props: { className?: string }) {
  return (
    <svg className={props.className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  );
}

export function PortalNotifications({ userId }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SupplyNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = items.filter((n) => !n.is_read).length;

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("supply_notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("[notifications]", error);
      setItems([]);
    } else {
      setItems((data ?? []) as SupplyNotification[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`supply_notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "supply_notifications", filter: `user_id=eq.${userId}` },
        () => void load()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, load]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const markRead = async (id: string) => {
    await supabase.from("supply_notifications").update({ is_read: true }).eq("id", id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const markAllRead = async () => {
    await supabase.from("supply_notifications").update({ is_read: true }).eq("user_id", userId).eq("is_read", false);
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-gray-900 transition hover:border-slate-400 hover:bg-slate-50"
        aria-label="알림"
        title="알림"
      >
        <IconBell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-slate-900">알림</span>
            {unreadCount > 0 ? (
              <button type="button" onClick={() => void markAllRead()} className="text-xs font-medium text-violet-600 hover:text-violet-700">
                모두 읽음
              </button>
            ) : null}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {loading ? (
              <li className="px-4 py-6 text-center text-sm text-slate-500">불러오는 중…</li>
            ) : items.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-slate-500">알림이 없습니다.</li>
            ) : (
              items.map((n) => (
                <li key={n.id} className={`border-b border-slate-50 px-4 py-3 ${n.is_read ? "bg-white" : "bg-violet-50/40"}`}>
                  <p className="text-sm text-slate-800">{n.message}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">{formatSupplyDateTime(n.created_at)}</span>
                    {!n.is_read ? (
                      <button
                        type="button"
                        onClick={() => void markRead(n.id)}
                        className="text-xs font-medium text-violet-600 hover:underline"
                      >
                        읽음
                      </button>
                    ) : null}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
