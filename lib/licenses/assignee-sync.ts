import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * services.assignee_id 를 license_managers 와 맞춘다.
 * 알림·권한은 license_managers 만 보고, assignee_id 는 표시·정렬용 첫 담당자.
 *
 * @param firstProfileId 지정하면 그 값을 쓴다(폼 선택 순서). 생략하면 created_at 오름차순 첫 행.
 */
export async function syncServiceAssigneeId(
  client: SupabaseClient,
  serviceId: string,
  firstProfileId?: string | null
): Promise<{ error: string | null }> {
  let assigneeId: string | null;

  if (firstProfileId !== undefined) {
    assigneeId = firstProfileId;
  } else {
    const { data, error } = await client
      .from("license_managers")
      .select("profile_id")
      .eq("service_id", serviceId)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) return { error: error.message };
    assigneeId = (data?.[0]?.profile_id as string | undefined) ?? null;
  }

  const { error } = await client
    .from("services")
    .update({
      assignee_id: assigneeId,
      updated_at: new Date().toISOString()
    })
    .eq("id", serviceId);

  return { error: error?.message ?? null };
}
