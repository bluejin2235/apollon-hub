import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function isSuperAdminUser(
  admin: SupabaseClient,
  user: User
): Promise<boolean> {
  const { data, error } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[luna] isSuperAdminUser", error);
    return false;
  }
  return data?.role === "슈퍼관리자";
}
