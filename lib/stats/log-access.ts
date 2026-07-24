"use client";

import { supabase } from "@/lib/supabase/client";

const SESSION_ID_KEY = "apollon_session_id";
const ACCESS_LOGGED_KEY = "access_logged";

function detectDevice(): "mobile" | "pc" {
  if (typeof navigator === "undefined") return "pc";
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "pc";
}

function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** 로그인 세션 시작 시 access_logs 1건 기록 (세션당 1회) */
export async function logAccess(): Promise<void> {
  try {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(ACCESS_LOGGED_KEY) === "1") return;

    const {
      data: { session }
    } = await supabase.auth.getSession();
    const profileId = session?.user?.id;
    if (!profileId) return;

    const sessionId = getOrCreateSessionId();
    const { error } = await supabase.from("access_logs").insert({
      profile_id: profileId,
      device: detectDevice(),
      session_id: sessionId
    });

    if (error) {
      console.error("[stats] access_logs insert failed", error);
      return;
    }

    sessionStorage.setItem(ACCESS_LOGGED_KEY, "1");
  } catch (e) {
    console.error("[stats] logAccess failed", e);
  }
}
