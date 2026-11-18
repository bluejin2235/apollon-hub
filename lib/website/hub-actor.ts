import type { SupabaseClient } from "@supabase/supabase-js";
import { canAccessWebsiteAdmin, isWebsiteTesterRole } from "@/lib/auth/website-tester";

export type HubActor = {
  role: string | null;
  name: string | null;
  /** 근무 · 휴직 · 퇴사 */
  status: string | null;
};

export const OFFBOARDED_STATUS = "퇴사";

export async function getHubActor(admin: SupabaseClient, userId: string): Promise<HubActor> {
  const { data, error } = await admin
    .from("profiles")
    .select("role, name, status")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[hub-actor] getHubActor", error);
    return { role: null, name: null, status: null };
  }

  const row = data as { role?: unknown; name?: unknown; status?: unknown } | null;
  return {
    role: typeof row?.role === "string" ? row.role : null,
    name: typeof row?.name === "string" ? row.name : null,
    status: typeof row?.status === "string" ? row.status : null,
  };
}

/**
 * 문의 메모 @부르기에 낄 수 있는 사람 (부르는 사람 · 불리는 사람 같은 기준).
 * 홈페이지 어드민을 쓸 수 있고, 홈페이지테스터가 아니고, 퇴사자가 아니어야 한다.
 */
export function isMentionEligible(profile: {
  role: string | null | undefined;
  status: string | null | undefined;
}): boolean {
  if (!canAccessWebsiteAdmin(profile.role)) return false;
  if (isWebsiteTesterRole(profile.role)) return false;
  return String(profile.status ?? "").trim() !== OFFBOARDED_STATUS;
}

/** 홈페이지 관리 API 로 넘기는 로그인 사용자. 이름은 encodeURIComponent. */
export function applyHubActorHeaders(headers: Headers, userId: string, name: string | null) {
  headers.set("X-Hub-User-Id", userId);
  headers.set("X-Hub-User-Name", encodeURIComponent(name?.trim() ?? ""));
}
