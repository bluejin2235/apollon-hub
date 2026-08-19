"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import { supabase } from "@/lib/supabase/client";

export function useHasLunaAccess(
  profileId: string | null | undefined,
  role: string | null | undefined
): { allowed: boolean; ready: boolean } {
  const [allowed, setAllowed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!profileId) {
      setAllowed(false);
      setReady(false);
      return;
    }
    let cancelled = false;
    setReady(false);
    void hasLunaAccess(supabase, profileId, role).then((ok) => {
      if (cancelled) return;
      setAllowed(ok);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [profileId, role]);

  return { allowed, ready };
}

/** 통과하지 못하면 /hub 로 보낸다. */
export function useRedirectUnlessLunaAccess(
  profileId: string | null | undefined,
  role: string | null | undefined,
  sessionReady: boolean
): { allowed: boolean; ready: boolean } {
  const router = useRouter();
  const { allowed, ready } = useHasLunaAccess(profileId, role);

  useEffect(() => {
    if (!sessionReady || !ready || !profileId) return;
    if (!allowed) router.replace("/hub");
  }, [sessionReady, ready, allowed, profileId, router]);

  return { allowed, ready };
}
