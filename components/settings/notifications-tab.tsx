"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  NOTIFICATION_FILTERS,
  categoryBadge,
  emitHubNotificationsChanged,
  formatCardTime,
  formatMetaLine,
  groupNotificationsByDate,
  levelIcon,
  normalizeLevel,
  notificationAction,
  notificationBody,
  type NotificationFilter,
  type NotificationLevel
} from "@/lib/portal/notification-display";

type HubNotificationItem = {
  id: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  level: string;
  created_at: string;
  read: boolean;
  meta: Record<string, unknown> | null;
};

type Counts = {
  all: number;
  unread: number;
  luna: number;
  nas: number;
  wiki: number;
  problem: number;
};

type PrefItem = {
  category: string;
  label: string;
  count: number;
  enabled: boolean;
};

const EMPTY_COUNTS: Counts = {
  all: 0,
  unread: 0,
  luna: 0,
  nas: 0,
  wiki: 0,
  problem: 0
};

const LEVEL_TONE: Record<
  NotificationLevel,
  { bg: string; fg: string }
> = {
  success: { bg: "#E6F5EF", fg: "#0F6E56" },
  info: { bg: "#E9F1F9", fg: "#2E6FA8" },
  warn: { bg: "#FBF3E4", fg: "#B0782B" },
  error: { bg: "#FBECEB", fg: "#B3403A" }
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function NotificationsTab() {
  const router = useRouter();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [items, setItems] = useState<HubNotificationItem[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useState<PrefItem[]>([]);
  const [prefsMissing, setPrefsMissing] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    undoIds?: string[];
  } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback(
    (message: string, undoIds?: string[]) => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      setToast({ message, undoIds });
      toastTimer.current = window.setTimeout(() => setToast(null), 6000);
    },
    []
  );

  const loadPrefs = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    const res = await fetch("/api/notifications/prefs", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const json = (await res.json()) as {
      items: PrefItem[];
      missing_table?: boolean;
    };
    setPrefs(json.items ?? []);
    setPrefsMissing(json.missing_table === true);
  }, []);

  const fetchPage = useCallback(
    async (cursor?: string | null) => {
      const token = await getAccessToken();
      if (!token) {
        return {
          items: [] as HubNotificationItem[],
          counts: EMPTY_COUNTS,
          unread_count: 0,
          total_count: 0,
          next_cursor: null as string | null
        };
      }
      const params = new URLSearchParams({
        limit: "30",
        filter,
        include_muted: "1",
        with_counts: "1"
      });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/notifications?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        console.error("[notifications-tab]", await res.text());
        return {
          items: [] as HubNotificationItem[],
          counts: EMPTY_COUNTS,
          unread_count: 0,
          total_count: 0,
          next_cursor: null as string | null
        };
      }
      return (await res.json()) as {
        items: HubNotificationItem[];
        counts?: Counts;
        unread_count: number;
        total_count?: number;
        next_cursor: string | null;
      };
    },
    [filter]
  );

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const json = await fetchPage();
      setItems(json.items);
      setNextCursor(json.next_cursor);
      if (json.counts) setCounts(json.counts);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const json = await fetchPage(nextCursor);
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...json.items.filter((n) => !seen.has(n.id))];
      });
      setNextCursor(json.next_cursor);
      if (json.counts) setCounts(json.counts);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, loading, loadingMore, nextCursor]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "240px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore, nextCursor]);

  async function toggleRead(item: HubNotificationItem) {
    const token = await getAccessToken();
    if (!token || busy) return;
    setBusy(true);
    const nextRead = !item.read;
    try {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: item.id, read: nextRead })
      });
      if (!res.ok) return;
      setItems((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, read: nextRead } : n))
      );
      setCounts((prev) => ({
        ...prev,
        unread: Math.max(0, prev.unread + (nextRead ? -1 : 1))
      }));
      emitHubNotificationsChanged();
    } finally {
      setBusy(false);
    }
  }

  async function markFilterRead() {
    const token = await getAccessToken();
    if (!token || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/notifications/read-all", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ filter, include_muted: true })
      });
      if (!res.ok) return;
      const json = (await res.json()) as { marked: number; ids: string[] };
      const idSet = new Set(json.ids ?? []);
      setItems((prev) =>
        prev.map((n) => (idSet.has(n.id) ? { ...n, read: true } : n))
      );
      setCounts((prev) => ({
        ...prev,
        unread: Math.max(0, prev.unread - (json.marked ?? 0))
      }));
      emitHubNotificationsChanged();
      if ((json.marked ?? 0) > 0) {
        showToast(
          `${json.marked}건을 읽음 처리했습니다`,
          json.ids
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function undoMarkRead(ids: string[]) {
    const token = await getAccessToken();
    if (!token || ids.length === 0) return;
    const res = await fetch("/api/notifications/read", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ids, read: false })
    });
    if (!res.ok) return;
    const idSet = new Set(ids);
    setItems((prev) =>
      prev.map((n) => (idSet.has(n.id) ? { ...n, read: false } : n))
    );
    setCounts((prev) => ({
      ...prev,
      unread: prev.unread + ids.length
    }));
    emitHubNotificationsChanged();
    setToast(null);
  }

  async function setPref(category: string, enabled: boolean) {
    const token = await getAccessToken();
    if (!token) return;
    setPrefs((prev) =>
      prev.map((p) => (p.category === category ? { ...p, enabled } : p))
    );
    const res = await fetch("/api/notifications/prefs", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ category, enabled })
    });
    if (!res.ok) {
      setPrefs((prev) =>
        prev.map((p) =>
          p.category === category ? { ...p, enabled: !enabled } : p
        )
      );
      if (res.status === 503) setPrefsMissing(true);
      return;
    }
    emitHubNotificationsChanged();
  }

  const groups = groupNotificationsByDate(items);
  const unreadInView = items.filter((n) => !n.read).length;

  return (
    <section className="rounded-xl border border-[#e7e8ec] bg-white px-5 py-6 md:px-8">
      <h2 className="text-[19px] font-extrabold text-[#1c1d21]">알림</h2>
      <p className="mb-[15px] mt-1 text-[11.5px] text-[#6b6f76]">
        안 읽은 것 {counts.unread}건 · 전체 {counts.all}건
      </p>

      <div className="mb-[13px] flex flex-wrap items-center gap-[7px]">
        {NOTIFICATION_FILTERS.map((f) => {
          const count = counts[f.key];
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-2xl border px-3 py-[5px] text-[11.5px] ${
                on
                  ? "border-[#534AB7] bg-[#534AB7] font-semibold text-white"
                  : "border-[#e7e8ec] text-[#6b6f76] hover:border-[#d5d6dc]"
              }`}
            >
              {f.label}{" "}
              <span className={`text-[10px] ${on ? "opacity-75" : ""}`}>
                {count}
              </span>
            </button>
          );
        })}
        <span className="flex-1" />
        <button
          type="button"
          disabled={busy || unreadInView === 0}
          onClick={() => void markFilterRead()}
          className="text-[11px] font-semibold text-[#534AB7] disabled:opacity-40"
        >
          모두 읽음
        </button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-xs text-[#9aa0a8]">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-xs text-[#9aa0a8]">
          {filter === "unread" ? "안 읽은 알림이 없습니다" : "알림이 없습니다"}
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.key}>
            <div className="mb-2 mt-4 flex items-center gap-[9px] text-[11px] font-bold text-[#9aa0a8]">
              {group.label}
              <span className="h-px flex-1 bg-[#eef0f3]" />
            </div>
            {group.items.map((n) => (
              <NotificationCard
                key={n.id}
                item={n}
                busy={busy}
                onToggleRead={() => void toggleRead(n)}
                onAction={(href) => router.push(href)}
              />
            ))}
          </div>
        ))
      )}

      <div ref={sentinelRef} />
      {nextCursor ? (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          className="mt-3 w-full rounded-lg py-2 text-[11.5px] font-medium text-[#6b6f76] hover:bg-[#f5f6f8] disabled:opacity-40"
        >
          {loadingMore ? "불러오는 중…" : "더 오래된 알림 불러오기"}
        </button>
      ) : items.length > 0 ? (
        <p className="mt-4 text-[11px] leading-relaxed text-[#9aa0a8]">
          더 오래된 알림은 스크롤하면 계속 불러옵니다.
        </p>
      ) : null}

      <div className="mt-6 border-t border-[#eef0f3] pt-4">
        <button
          type="button"
          onClick={() => setPrefsOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left text-[13px] font-bold text-[#1c1d21]"
        >
          받을 알림 고르기
          <span className="text-[11px] font-medium text-[#9aa0a8]">
            {prefsOpen ? "접기" : "펼치기"}
          </span>
        </button>
        <p className="mt-1 text-[11px] leading-relaxed text-[#9aa0a8]">
          받지 않는 알림도 여기서는 볼 수 있어요. 종 아이콘 뱃지와 드롭다운에서만
          빠집니다.
        </p>
        {prefsOpen ? (
          <ul className="mt-3 space-y-1">
            {prefsMissing ? (
              <li className="rounded-lg bg-[#FBF3E4] px-3 py-2 text-[11.5px] text-[#B0782B]">
                종류별 설정 테이블이 아직 없습니다. 마이그레이션 적용 후 저장됩니다.
              </li>
            ) : null}
            {prefs.map((p) => (
              <li key={p.category}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-[#f5f6f8]">
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    disabled={prefsMissing}
                    onChange={(e) => void setPref(p.category, e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#534AB7]"
                  />
                  <span className="flex-1 text-[#1c1d21]">{p.label}</span>
                  <span className="font-mono text-[10.5px] text-[#9aa0a8]">
                    {p.category}
                  </span>
                  <span className="text-[11px] text-[#6b6f76]">{p.count}건</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-[60] flex max-w-sm -translate-x-1/2 items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
          <span>{toast.message}</span>
          {toast.undoIds && toast.undoIds.length > 0 ? (
            <button
              type="button"
              onClick={() => void undoMarkRead(toast.undoIds!)}
              className="font-semibold text-[#c4bfff] hover:text-white"
            >
              되돌리기
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-slate-300 hover:text-white"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
      ) : null}
    </section>
  );
}

function NotificationCard({
  item,
  busy,
  onToggleRead,
  onAction
}: {
  item: HubNotificationItem;
  busy: boolean;
  onToggleRead: () => void;
  onAction: (href: string) => void;
}) {
  const level = normalizeLevel(item.level);
  const tone = LEVEL_TONE[level];
  const action = notificationAction(item.category, item.link);
  const metaLine = formatMetaLine(item.meta);
  const body = notificationBody(item.body, item.meta);
  const unread = !item.read;

  return (
    <article
      className="relative mb-2 flex gap-3 rounded-[11px] border p-[13px_15px]"
      style={{
        borderColor: unread ? "#DDD8F2" : "#e7e8ec",
        background: unread ? "#FCFBFF" : "#ffffff"
      }}
    >
      {unread ? (
        <span
          aria-hidden
          className="absolute bottom-[13px] left-0 top-[13px] w-[3px] rounded-r-[3px] bg-[#534AB7]"
        />
      ) : null}
      <span
        className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-[14px]"
        style={{ background: tone.bg, color: tone.fg }}
      >
        {levelIcon(level, item.category)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-[7px]">
          <span className="text-[13px] font-bold text-[#1c1d21]">{item.title}</span>
          <span
            className="rounded-md px-[7px] py-px text-[9.5px] font-bold"
            style={{ background: tone.bg, color: tone.fg }}
          >
            {categoryBadge(item.category)}
          </span>
          <span className="ml-auto shrink-0 whitespace-nowrap text-[10.5px] text-[#9aa0a8]">
            {formatCardTime(item.created_at)}
          </span>
        </div>
        {body ? (
          <p className="whitespace-pre-wrap text-[12.5px] leading-[1.75] text-[#2a2c31]">
            {body}
          </p>
        ) : null}
        {metaLine ? (
          <p className="mt-1.5 font-mono text-[10.5px] text-[#9aa0a8]">{metaLine}</p>
        ) : null}
        <div className="mt-2.5 flex items-center gap-1.5">
          {action ? (
            <button
              type="button"
              onClick={() => onAction(action.href)}
              className="rounded-lg border border-[#534AB7] bg-[#534AB7] px-3 py-[5px] text-[11px] font-semibold text-white"
            >
              {action.label}
            </button>
          ) : null}
          <span className="flex-1" />
          <button
            type="button"
            disabled={busy}
            onClick={onToggleRead}
            className="border-0 bg-transparent px-1 py-[5px] text-[11px] font-semibold text-[#9aa0a8] hover:text-[#534AB7] disabled:opacity-40"
          >
            {unread ? "읽음" : "안 읽음으로"}
          </button>
        </div>
      </div>
    </article>
  );
}
