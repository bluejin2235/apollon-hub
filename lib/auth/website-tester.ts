// 홈페이지 어드민 접근. 홈페이지테스터는 미들웨어로 다른 서비스를 막는다.

import type { SupabaseClient } from "@supabase/supabase-js";

export const WEBSITE_TESTER_ROLE = "홈페이지테스터";

const WEBSITE_ADMIN_ROLES = new Set([
  "슈퍼관리자",
  "중간관리자",
  "멤버",
  WEBSITE_TESTER_ROLE
]);

export function isWebsiteTesterRole(role: string | null | undefined): boolean {
  return String(role ?? "").trim() === WEBSITE_TESTER_ROLE;
}

/** Hub에 로그인한 직원(슈퍼·중간·멤버·홈페이지테스터)은 홈페이지 어드민을 쓸 수 있다 */
export function canAccessWebsiteAdmin(role: string | null | undefined): boolean {
  return WEBSITE_ADMIN_ROLES.has(String(role ?? "").trim());
}

/** 미들웨어: 홈페이지테스터가 접근할 수 있는 경로 (다른 서비스는 막음) */
export function isWebsiteTesterPathAllowed(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname.startsWith("/website")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/api/website")) return true;
  if (pathname.startsWith("/api/wiki")) return true;
  return false;
}

/** 로그인 후 이동 경로 (오픈 리다이렉트 방지 포함) */
export function postLoginPathForRole(
  role: string | null | undefined,
  redirectParam: string | null
): string {
  const fallback = isWebsiteTesterRole(role) ? "/website" : "/hub";

  if (!redirectParam?.trim()) return fallback;

  const path = redirectParam.trim();
  if (!path.startsWith("/") || path.startsWith("//") || /^https?:/i.test(path)) {
    return fallback;
  }

  if (isWebsiteTesterRole(role) && !path.startsWith("/website")) {
    return "/website";
  }

  return path;
}

export async function getProfileRole(
  admin: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[website-tester] getProfileRole", error);
    return null;
  }

  return typeof data?.role === "string" ? data.role : null;
}
