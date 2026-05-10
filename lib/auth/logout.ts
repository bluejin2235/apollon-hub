"use client";

import { supabase } from "@/lib/supabase/client";

/**
 * Clears the browser session without calling Supabase revoke (global) APIs.
 * Global signOut can fail behind strict networks and pairs poorly with immediate client-side redirects.
 */
export async function signOutAndRedirectToLogin(): Promise<void> {
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      console.warn("[auth] signOut:", error.message);
    }
  } catch (e) {
    console.warn("[auth] signOut failed:", e);
  }
  if (typeof window !== "undefined") {
    window.location.assign("/");
  }
}
