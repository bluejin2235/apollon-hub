import type { SupabaseClient } from "@supabase/supabase-js";

export const LUNA_SUPER_ADMIN_ROLE = "슈퍼관리자";

type CacheEntry = { ok: boolean };

const cache = new Map<string, CacheEntry>();

export function invalidateLunaAccessCache(profileId?: string): void {
  if (profileId) {
    cache.delete(profileId);
    return;
  }
  cache.clear();
}

function isSuperAdminRole(role: string | null | undefined): boolean {
  return String(role ?? "").trim() === LUNA_SUPER_ADMIN_ROLE;
}

/**
 * 루나·위키 베타 접근. 슈퍼관리자이거나 luna_beta_access 행이 있으면 true.
 * 서버(service role)·클라이언트(anon+세션) 모두 같은 시그니처.
 * 결과는 프로세스(세션) 동안 profileId 단위로 캐시한다.
 */
export async function hasLunaAccess(
  db: SupabaseClient,
  profileId: string,
  knownRole?: string | null
): Promise<boolean> {
  const id = profileId.trim();
  if (!id) return false;

  const hit = cache.get(id);
  if (hit) return hit.ok;

  if (isSuperAdminRole(knownRole)) {
    cache.set(id, { ok: true });
    return true;
  }

  if (knownRole == null) {
    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", id)
      .maybeSingle();
    if (profileError) {
      console.error("[luna] hasLunaAccess profile", profileError);
      return false;
    }
    if (isSuperAdminRole(profile?.role as string | undefined)) {
      cache.set(id, { ok: true });
      return true;
    }
  }

  const { data: row, error } = await db
    .from("luna_beta_access")
    .select("profile_id")
    .eq("profile_id", id)
    .maybeSingle();

  if (error) {
    console.error("[luna] hasLunaAccess beta", error);
    return false;
  }

  const ok = Boolean(row?.profile_id);
  cache.set(id, { ok });
  return ok;
}
