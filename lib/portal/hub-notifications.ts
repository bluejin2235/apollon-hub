import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isSuperAdminUser } from "@/lib/luna/auth";

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
};

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

export async function countUnreadNotifications(
  admin: SupabaseClient,
  userId: string,
  orFilter: string
): Promise<number> {
  const { data: rows, error } = await admin
    .from("hub_notifications")
    .select("id")
    .or(orFilter);

  if (error) {
    throw new Error(error.message);
  }

  const ids = (rows ?? []).map((r) => r.id as string);
  if (ids.length === 0) return 0;

  const { data: reads, error: readError } = await admin
    .from("hub_notification_reads")
    .select("notification_id")
    .eq("user_id", userId)
    .in("notification_id", ids);

  if (readError) {
    throw new Error(readError.message);
  }

  const readSet = new Set(
    (reads ?? []).map((r) => r.notification_id as string)
  );
  return ids.filter((id) => !readSet.has(id)).length;
}
