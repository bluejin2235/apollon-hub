"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import type { PortalProfileRow } from "@/lib/portal/profile";
import { supabase } from "@/lib/supabase/client";

export type PortalSessionStatus = "checking" | "ready";

export type UseRequirePortalSessionOptions = {
  /** Passed to `.select()` for the current user's `profiles` row */
  profileSelect?: string;
};

const defaultSelect = "id, email, name, department";

/**
 * Loads Supabase session + current user's profile row; redirects to `/` when unauthenticated
 * and signs out + redirects when the profile row is missing.
 */
export function useRequirePortalSession(options: UseRequirePortalSessionOptions = {}) {
  const router = useRouter();
  /** `useRouter()` 참조가 렌더마다 바뀌면 effect가 반복 실행되어, cleanup으로 취소된 요청만 남고 `ready`가 영원히 안 잡힐 수 있음 */
  const routerRef = useRef(router);
  routerRef.current = router;

  const profileSelect = options.profileSelect ?? defaultSelect;
  const [status, setStatus] = useState<PortalSessionStatus>("checking");
  const [profile, setProfile] = useState<PortalProfileRow | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const {
          data: { user },
          error: userError
        } = await supabase.auth.getUser();

        if (cancelled) {
          return;
        }

        if (userError || !user?.email) {
          routerRef.current.replace("/");
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select(profileSelect)
          .eq("email", user.email)
          .single();

        if (cancelled) {
          return;
        }

        if (error || !data) {
          void signOutAndRedirectToLogin();
          return;
        }

        setProfile(data as unknown as PortalProfileRow);
        setStatus("ready");
      } catch (e) {
        console.error("[useRequirePortalSession]", e);
        if (!cancelled) {
          routerRef.current.replace("/");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [profileSelect]);

  return { status, profile };
}
