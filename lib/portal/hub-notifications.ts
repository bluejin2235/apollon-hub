import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  CATEGORY_PREF_LABEL,
  categoryPrefLabel,
  type NotificationFilter
} from "@/lib/portal/notification-display";

export type HubNotificationItem = {
  id: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  level: string;
  scope: string;
  created_at: string;
  read: boolean;
  meta: Record<string, unknown> | null;
};

export type HubNotificationCounts = {
  all: number;
  unread: number;
  luna: number;
  nas: number;
  wiki: number;
  problem: number;
};

export type HubNotificationPrefItem = {
  category: string;
  label: string;
  count: number;
  enabled: boolean;
};

function isMissingRelation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: string }).code) : "";
  const msg =
    "message" in error ? String((error as { message?: string }).message) : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

export function encodeNotificationCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

export function decodeNotificationCursor(
  cursor: string
): { createdAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const idx = raw.indexOf("|");
    if (idx <= 0) return null;
    const createdAt = raw.slice(0, idx);
    const id = raw.slice(idx + 1);
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** 사용자에게 보이는 알림 scope 필터 (PostgREST or 절) */
export function visibleNotificationsOrFilter(
  userId: string,
  isAdmin: boolean
): string {
  if (isAdmin) {
    return `scope.eq.all,scope.eq.admin,and(scope.eq.user,target_user_id.eq.${userId})`;
  }
  return `scope.eq.all,and(scope.eq.user,target_user_id.eq.${userId})`;
}

export async function resolveNotificationViewer(
  admin: SupabaseClient,
  user: User
): Promise<{ userId: string; isAdmin: boolean; orFilter: string }> {
  const isAdmin = await isSuperAdminUser(admin, user);
  return {
    userId: user.id,
    isAdmin,
    orFilter: visibleNotificationsOrFilter(user.id, isAdmin)
  };
}

function asMeta(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function notInList(values: string[]): string {
  return `(${values.map((v) => `"${v.replace(/"/g, "")}"`).join(",")})`;
}

function applyCategoryFilter<
  Q extends {
    gte: (col: string, val: string) => Q;
    lt: (col: string, val: string) => Q;
    eq: (col: string, val: string) => Q;
    in: (col: string, val: string[]) => Q;
  }
>(query: Q, filter: NotificationFilter): Q {
  if (filter === "luna") {
    return query.gte("category", "luna_").lt("category", "lunb");
  }
  if (filter === "nas") return query.eq("category", "nas_scan");
  if (filter === "wiki") return query.eq("category", "wiki_rules");
  if (filter === "problem") return query.in("level", ["error", "warn"]);
  return query;
}

export async function loadMutedCategories(
  admin: SupabaseClient,
  userId: string
): Promise<{ muted: string[]; missingTable: boolean }> {
  const { data, error } = await admin
    .from("hub_notification_prefs")
    .select("category, enabled")
    .eq("user_id", userId);

  if (error) {
    if (isMissingRelation(error)) {
      return { muted: [], missingTable: true };
    }
    throw new Error(error.message);
  }

  const muted = (data ?? [])
    .filter((r) => r.enabled === false)
    .map((r) => String(r.category));
  return { muted, missingTable: false };
}

async function loadReadIds(
  admin: SupabaseClient,
  userId: string,
  ids: string[]
): Promise<Set<string>> {
  const readSet = new Set<string>();
  if (ids.length === 0) return readSet;
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await admin
      .from("hub_notification_reads")
      .select("notification_id")
      .eq("user_id", userId)
      .in("notification_id", chunk);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      readSet.add(r.notification_id as string);
    }
  }
  return readSet;
}

type CompactRow = { id: string; category: string; level: string };

async function loadCompactRows(
  admin: SupabaseClient,
  orFilter: string
): Promise<CompactRow[]> {
  const rows: CompactRow[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("hub_notifications")
      .select("id, category, level")
      .or(orFilter)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as CompactRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

export async function countUnreadNotifications(
  admin: SupabaseClient,
  userId: string,
  orFilter: string,
  mutedCategories: string[] = []
): Promise<number> {
  const rows = await loadCompactRows(admin, orFilter);
  const muted = new Set(mutedCategories);
  const visible = rows.filter((r) => !muted.has(r.category));
  const ids = visible.map((r) => r.id);
  if (ids.length === 0) return 0;
  const readSet = await loadReadIds(admin, userId, ids);
  return ids.filter((id) => !readSet.has(id)).length;
}

export function computeNotificationCounts(
  rows: CompactRow[],
  readSet: Set<string>
): HubNotificationCounts {
  const counts: HubNotificationCounts = {
    all: rows.length,
    unread: 0,
    luna: 0,
    nas: 0,
    wiki: 0,
    problem: 0
  };
  for (const r of rows) {
    const unread = !readSet.has(r.id);
    if (unread) counts.unread += 1;
    if (r.category.startsWith("luna_")) counts.luna += 1;
    if (r.category === "nas_scan") counts.nas += 1;
    if (r.category === "wiki_rules") counts.wiki += 1;
    if (r.level === "error" || r.level === "warn") counts.problem += 1;
  }
  return counts;
}

export async function notificationFilterCounts(
  admin: SupabaseClient,
  userId: string,
  orFilter: string
): Promise<HubNotificationCounts> {
  const rows = await loadCompactRows(admin, orFilter);
  const readSet = await loadReadIds(
    admin,
    userId,
    rows.map((r) => r.id)
  );
  return computeNotificationCounts(rows, readSet);
}

type ListOpts = {
  filter: NotificationFilter;
  includeMuted: boolean;
  mutedCategories: string[];
  limit: number;
  cursor: { createdAt: string; id: string } | null;
};

export async function listHubNotifications(
  admin: SupabaseClient,
  userId: string,
  orFilter: string,
  opts: ListOpts
): Promise<{ items: HubNotificationItem[]; nextCursor: string | null }> {
  const pageSize = opts.limit;
  const acc: HubNotificationItem[] = [];
  let cursor = opts.cursor;
  let exhausted = false;
  let safety = 0;

  while (acc.length < pageSize + 1 && !exhausted && safety < 25) {
    safety += 1;
    const batchLimit = opts.filter === "unread" ? pageSize * 3 : pageSize + 1;
    let query = admin
      .from("hub_notifications")
      .select(
        "id, category, title, body, link, level, scope, created_at, meta"
      )
      .or(orFilter)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(batchLimit);

    query = applyCategoryFilter(query, opts.filter);

    if (!opts.includeMuted && opts.mutedCategories.length > 0) {
      query = query.not("category", "in", notInList(opts.mutedCategories));
    }

    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) {
      exhausted = true;
      break;
    }

    const readSet = await loadReadIds(
      admin,
      userId,
      rows.map((r) => r.id as string)
    );

    for (const r of rows) {
      const item: HubNotificationItem = {
        id: r.id as string,
        category: r.category as string,
        title: r.title as string,
        body: (r.body as string | null) ?? null,
        link: (r.link as string | null) ?? null,
        level: r.level as string,
        scope: r.scope as string,
        created_at: (r.created_at as string) ?? new Date(0).toISOString(),
        read: readSet.has(r.id as string),
        meta: asMeta(r.meta)
      };
      if (opts.filter === "unread" && item.read) continue;
      acc.push(item);
      if (acc.length >= pageSize + 1) break;
    }

    const last = rows[rows.length - 1];
    cursor = {
      createdAt: (last?.created_at as string) ?? "",
      id: (last?.id as string) ?? ""
    };
    if (rows.length < batchLimit) exhausted = true;
  }

  const hasMore = acc.length > pageSize;
  const page = hasMore ? acc.slice(0, pageSize) : acc;
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor:
      hasMore && last
        ? encodeNotificationCursor(last.created_at, last.id)
        : null
  };
}

export async function listMatchingNotificationIds(
  admin: SupabaseClient,
  userId: string,
  orFilter: string,
  opts: {
    filter: NotificationFilter;
    includeMuted: boolean;
    mutedCategories: string[];
    unreadOnly: boolean;
  }
): Promise<string[]> {
  let query = admin
    .from("hub_notifications")
    .select("id, category")
    .or(orFilter);

  query = applyCategoryFilter(query, opts.filter);

  if (!opts.includeMuted && opts.mutedCategories.length > 0) {
    query = query.not("category", "in", notInList(opts.mutedCategories));
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; category: string }>;
  const ids = rows.map((r) => r.id);
  if (!opts.unreadOnly || ids.length === 0) return ids;
  const readSet = await loadReadIds(admin, userId, ids);
  return ids.filter((id) => !readSet.has(id));
}

export async function listNotificationPrefs(
  admin: SupabaseClient,
  userId: string,
  orFilter: string
): Promise<{ items: HubNotificationPrefItem[]; missingTable: boolean }> {
  const compact = await loadCompactRows(admin, orFilter);
  const countByCat = new Map<string, number>();
  for (const r of compact) {
    countByCat.set(r.category, (countByCat.get(r.category) ?? 0) + 1);
  }

  const { muted, missingTable } = await loadMutedCategories(admin, userId);
  const mutedSet = new Set(muted);

  const categories = new Set<string>([
    ...Object.keys(CATEGORY_PREF_LABEL),
    ...countByCat.keys()
  ]);

  const items = [...categories]
    .map((category) => ({
      category,
      label: categoryPrefLabel(category),
      count: countByCat.get(category) ?? 0,
      enabled: !mutedSet.has(category)
    }))
    .filter((item) => item.count > 0 || CATEGORY_PREF_LABEL[item.category])
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));

  return { items, missingTable };
}

export async function upsertNotificationPref(
  admin: SupabaseClient,
  userId: string,
  category: string,
  enabled: boolean
): Promise<{ ok: boolean; missingTable: boolean }> {
  const { error } = await admin.from("hub_notification_prefs").upsert(
    { user_id: userId, category, enabled },
    { onConflict: "user_id,category" }
  );
  if (error) {
    if (isMissingRelation(error)) {
      return { ok: false, missingTable: true };
    }
    throw new Error(error.message);
  }
  return { ok: true, missingTable: false };
}

export async function markNotificationsRead(
  admin: SupabaseClient,
  userId: string,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const payload = chunk.map((notification_id) => ({
      notification_id,
      user_id: userId,
      read_at: now
    }));
    const { error } = await admin
      .from("hub_notification_reads")
      .upsert(payload, { onConflict: "notification_id,user_id" });
    if (error) throw new Error(error.message);
  }
}

export async function markNotificationsUnread(
  admin: SupabaseClient,
  userId: string,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { error } = await admin
      .from("hub_notification_reads")
      .delete()
      .eq("user_id", userId)
      .in("notification_id", chunk);
    if (error) throw new Error(error.message);
  }
}

export { parseNotificationFilter } from "@/lib/portal/notification-display";
