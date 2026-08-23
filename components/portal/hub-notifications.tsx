"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  HUB_NOTIFICATIONS_CHANGED,
  NOTIFICATIONS_SETTINGS_URL
} from "@/lib/portal/notification-display";

type HubNotificationItem = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read: boolean;
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return "방금";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;

  const now = new Date();
  const d = new Date(t);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86400000;
  if (t >= startYesterday && t < startToday) return "어제";

  const days = Math.floor(diffSec / 86400);
  if (days < 7) return `${days}일 전`;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function HubNotifications() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<HubNotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (document.getElementById("tabler-icons-css")) return;
    const link = document.createElement("link");
    link.id = "tabler-icons-css";
    link.rel = "stylesheet";
    link.href =
      "https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.34.1/dist/tabler-icons.min.css";
    document.head.appendChild(link);
  }, []);

  const fetchPage = useCallback(async (cursor?: string | null) => {
    const token = await getAccessToken();
    if (!token) {
      return { items: [] as HubNotificationItem[], unread_count: 0, next_cursor: null };
    }
    const params = new URLSearchParams({ limit: "20" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`/api/notifications?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      console.error("[hub-notifications]", await res.text());
      return { items: [] as HubNotificationItem[], unread_count: 0, next_cursor: null };
    }
    return (await res.json()) as {
      items: HubNotificationItem[];
      unread_count: number;
      next_cursor: string | null;
    };
  }, []);

  const refreshUnread = useCallback(async () => {
    const json = await fetchPage();
    setUnreadCount(json.unread_count);
  }, [fetchPage]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const json = await fetchPage();
      setItems(json.items);
      setUnreadCount(json.unread_count);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    void refreshUnread();
    const timer = window.setInterval(() => {
      void refreshUnread();
    }, 60_000);
    const onChanged = () => {
      void refreshUnread();
    };
    window.addEventListener(HUB_NOTIFICATIONS_CHANGED, onChanged);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(HUB_NOTIFICATIONS_CHANGED, onChanged);
    };
  }, [refreshUnread]);

  useEffect(() => {
    if (open) void loadList();
  }, [open, loadList]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function markRead(id: string) {
    const token = await getAccessToken();
    if (!token || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id })
      });
      if (!res.ok) return;
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead() {
    const token = await getAccessToken();
    if (!token || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/notifications/read-all", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } finally {
      setBusy(false);
    }
  }

  function openFullPage() {
    setOpen(false);
    router.push(NOTIFICATIONS_SETTINGS_URL);
  }

  async function onRowClick(item: HubNotificationItem) {
    if (!item.read) await markRead(item.id);
    if (item.link) {
      setOpen(false);
      router.push(item.link);
    }
  }

  const badge = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-gray-900 transition hover:border-slate-400 hover:bg-slate-50"
        aria-label="알림"
        title="알림"
        aria-expanded={open}
      >
        <i className="ti ti-bell text-lg leading-none" aria-hidden />
        {unreadCount > 0 ? (
          <>
            <span
              className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-rose-500"
              aria-hidden
            />
            <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {badge}
            </span>
          </>
        ) : null}
      </button>

      {open ? (
        <div
          className="fixed inset-x-0 top-14 z-[60] max-h-[min(28rem,calc(100dvh-4rem))] overflow-hidden border-b border-slate-200 bg-white shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[22rem] sm:max-h-[28rem] sm:rounded-xl sm:border sm:border-slate-200"
          role="dialog"
          aria-label="알림"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-slate-900">알림</span>
            <button
              type="button"
              disabled={busy || unreadCount === 0}
              onClick={() => void markAllRead()}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-40"
            >
              모두 읽음
            </button>
          </div>

          <ul className="max-h-[min(22rem,calc(100dvh-9rem))] overflow-y-auto sm:max-h-80">
            {loading ? (
              <li className="px-4 py-8 text-center text-sm text-slate-500">
                불러오는 중…
              </li>
            ) : items.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-slate-500">
                알림이 없습니다
              </li>
            ) : (
              items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void onRowClick(n)}
                    className={`w-full border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50 ${
                      n.read ? "bg-white" : "bg-rose-50/70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`line-clamp-1 text-sm ${
                          n.read ? "font-medium text-slate-800" : "font-semibold text-slate-900"
                        }`}
                      >
                        {n.title}
                      </p>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {formatRelativeTime(n.created_at)}
                      </span>
                    </div>
                    {n.body ? (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                        {n.body}
                      </p>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="border-t border-slate-100 bg-[#FBFAFF] px-4 py-2.5">
            <button
              type="button"
              onClick={openFullPage}
              className="w-full rounded-lg py-1.5 text-xs font-semibold text-[#534AB7] hover:bg-white"
            >
              더 보기
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
