import type { SupabaseClient } from "@supabase/supabase-js";

export type HubActor = {
  role: string | null;
  name: string | null;
};

export async function getHubActor(admin: SupabaseClient, userId: string): Promise<HubActor> {
  const { data, error } = await admin
    .from("profiles")
    .select("role, name")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[hub-actor] getHubActor", error);
    return { role: null, name: null };
  }

  const row = data as { role?: unknown; name?: unknown } | null;
  return {
    role: typeof row?.role === "string" ? row.role : null,
    name: typeof row?.name === "string" ? row.name : null,
  };
}

/** 홈페이지 관리 API 로 넘기는 로그인 사용자. 이름은 encodeURIComponent. */
export function applyHubActorHeaders(headers: Headers, userId: string, name: string | null) {
  headers.set("X-Hub-User-Id", userId);
  headers.set("X-Hub-User-Name", encodeURIComponent(name?.trim() ?? ""));
}
