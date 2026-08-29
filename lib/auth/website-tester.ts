// TODO(홈페이지 오픈 후 삭제) 개발 기간 한정 테스트 계정 권한

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export const WEBSITE_TESTER_ROLE = "홈페이지테스터";

export function isWebsiteTesterRole(role: string | null | undefined): boolean {
  return String(role ?? "").trim() === WEBSITE_TESTER_ROLE;
}

export function canAccessWebsiteAdmin(role: string | null | undefined): boolean {
  const r = String(role ?? "").trim();
  return r === "슈퍼관리자" || isWebsiteTesterRole(r);
}

/** 미들웨어: 홈페이지테스터가 접근할 수 있는 경로 */
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

const WORK_ID_PATH = /^works\/([^/]+)$/;
const INSIGHT_ID_PATH = /^insights\/([^/]+)$/;

/** 홈페이지테스터가 website API 프록시에서 막아야 하는 요청 */
export async function isWebsiteTesterBlockedApiRequest(
  method: string,
  joinedPath: string,
  request: NextRequest
): Promise<boolean> {
  const path = joinedPath.replace(/\/$/, "").split("?")[0] ?? "";

  if (method === "POST" && (path === "works" || path === "insights")) return true;

  if (method === "DELETE" && (WORK_ID_PATH.test(path) || INSIGHT_ID_PATH.test(path))) return true;

  if ((method === "PATCH" || method === "PUT") && (WORK_ID_PATH.test(path) || INSIGHT_ID_PATH.test(path))) {
    try {
      const text = await request.clone().text();
      if (!text.trim()) return false;
      const body = JSON.parse(text) as unknown;
      if (body && typeof body === "object" && "status" in body) return true;
    } catch {
      return false;
    }
  }

  return false;
}
