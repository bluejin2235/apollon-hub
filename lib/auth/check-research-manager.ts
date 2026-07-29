import type { SupabaseClient } from "@supabase/supabase-js";
import { SERVICE_URL } from "@/lib/services/permissions";

const SUPER_ADMIN_ROLE = "슈퍼관리자";
const RESEARCH_MIDDLE_ADMIN_ROLE = "중간관리자";

/** 서버(service role)에서 트렌드 레이더 관리 권한(슈퍼관리자 또는 /research 중간관리자) 확인 */
export async function isResearchManagerServer(
  admin: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    console.error("[check-research-manager] profile lookup failed", profileError);
    return false;
  }

  if (profile?.role === SUPER_ADMIN_ROLE) return true;

  const { data: service, error: serviceError } = await admin
    .from("services")
    .select("id")
    .eq("url", SERVICE_URL.RESEARCH)
    .eq("is_hub_card", true)
    .limit(1)
    .maybeSingle();

  if (serviceError || !service?.id) {
    if (serviceError) {
      console.error("[check-research-manager] service lookup failed", serviceError);
    }
    return false;
  }

  const { data: roleRows, error: roleError } = await admin
    .from("service_user_roles")
    .select("id")
    .eq("profile_id", userId)
    .eq("service_id", service.id)
    .eq("role", RESEARCH_MIDDLE_ADMIN_ROLE)
    .limit(1);

  if (roleError) {
    console.error("[check-research-manager] service_user_roles lookup failed", roleError);
    return false;
  }

  return Boolean(roleRows && roleRows.length > 0);
}
