import type { SupabaseClient } from "@supabase/supabase-js";

/** LUNA 설정 화면 딥링크 (알림·아침 요약 공통) */
export const LUNA_LINKS = {
  dashboard: "/settings?tab=luna&luna=dashboard",
  selfstudyHistory: "/settings?tab=luna&luna=selfstudy&sub=history",
  candidatesPending: "/settings?tab=luna&luna=candidates&sub=pending",
  brainUpgrade: "/settings?tab=luna&luna=brain&sub=upgrade",
  brainReport: "/settings?tab=luna&luna=brain&sub=report",
  brainEval: "/settings?tab=luna&luna=brain&sub=eval",
  brainModel: "/settings?tab=luna&luna=brain&sub=model",
  knowledgeConflict: "/settings?tab=luna&luna=knowledge&sub=conflict",
  knowledgeWorkserver: "/settings?tab=luna&luna=knowledge&sub=workserver"
} as const;

export type LunaNotifyEvent =
  | "consolidation"
  | "study"
  | "reflect"
  | "conflict"
  | "prompt_change"
  | "exam"
  | "morning";

const DEFAULT_NOTIFY_EVENTS: Record<LunaNotifyEvent, boolean> = {
  consolidation: true,
  study: true,
  reflect: true,
  conflict: true,
  prompt_change: true,
  exam: true,
  morning: true
};

const EVENT_CATEGORY: Record<LunaNotifyEvent, string> = {
  consolidation: "luna_consolidation",
  study: "luna_study",
  reflect: "luna_reflect",
  conflict: "luna_conflict",
  prompt_change: "luna_prompt",
  exam: "luna_exam",
  morning: "luna_morning"
};

const EVENT_LINK: Record<LunaNotifyEvent, string> = {
  consolidation: LUNA_LINKS.candidatesPending,
  study: LUNA_LINKS.selfstudyHistory,
  reflect: LUNA_LINKS.candidatesPending,
  conflict: LUNA_LINKS.knowledgeConflict,
  prompt_change: LUNA_LINKS.brainUpgrade,
  exam: LUNA_LINKS.brainEval,
  morning: LUNA_LINKS.dashboard
};

export type LunaNotifyOptions = {
  level?: "info" | "success" | "warn" | "error";
  link?: string;
  meta?: Record<string, unknown>;
};

export async function isLunaNotifyEventEnabled(
  admin: SupabaseClient,
  event: LunaNotifyEvent
): Promise<boolean> {
  const { data, error } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", "notify_events")
    .maybeSingle();

  if (error) {
    console.error("[luna/notify] settings", error);
    return DEFAULT_NOTIFY_EVENTS[event];
  }

  const value = data?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_NOTIFY_EVENTS[event];
  }
  const flag = (value as Record<string, unknown>)[event];
  if (typeof flag === "boolean") return flag;
  return DEFAULT_NOTIFY_EVENTS[event];
}

/**
 * hub_notifications 에 scope='admin' 으로 삽입 (nas_scan_notify 와 동일 행 구조).
 * luna_settings.notify_events[event] 가 true 일 때만 동작.
 */
export async function lunaNotify(
  admin: SupabaseClient,
  event: LunaNotifyEvent,
  title: string,
  body: string,
  options: LunaNotifyOptions = {}
): Promise<string | null> {
  try {
    if (!(await isLunaNotifyEventEnabled(admin, event))) return null;

    const { data, error } = await admin
      .from("hub_notifications")
      .insert({
        category: EVENT_CATEGORY[event],
        title,
        body,
        link: options.link ?? EVENT_LINK[event],
        level: options.level ?? "info",
        scope: "admin",
        meta: { event, ...(options.meta ?? {}) }
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[luna/notify] insert", error);
      return null;
    }
    return (data?.id as string | undefined) ?? null;
  } catch (err) {
    console.error("[luna/notify]", err);
    return null;
  }
}
