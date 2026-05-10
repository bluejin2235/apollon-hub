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

const defaultSelect = "id, email, name, department, role";

/** 세션 로드 + 프로필 조회 전체 상한 (getUser/토큰 갱신 무한 대기 방지) */
const PORTAL_AUTH_READY_MS = 25_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("portal_auth_timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Loads Supabase session + current user's profile row; redirects to `/` when unauthenticated
 * and signs out + redirects when the profile row is missing.
 *
 * Uses `getSession()` (local session + 필요 시 갱신만) instead of `getUser()`.
 * `getUser()`는 Web Locks 안에서 Auth 서버 `GET /user`를 호출해 네트워크가 멈추면
 * 잠금이 오래 잡혀 UI가 "인증 확인 중"에 머무는 경우가 있습니다.
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
        await withTimeout(
          (async () => {
            const {
              data: { session },
              error: sessionError
            } = await supabase.auth.getSession();

            if (cancelled) {
              return;
            }

            const email = session?.user?.email;
            if (sessionError || !email) {
              routerRef.current.replace("/");
              return;
            }

            const { data, error } = await supabase
              .from("profiles")
              .select(profileSelect)
              .eq("email", email)
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
          })(),
          PORTAL_AUTH_READY_MS
        );
      } catch (e) {
        console.error("[useRequirePortalSession]", e);
        if (!cancelled) {
          try {
            await supabase.auth.signOut({ scope: "local" });
          } catch {
            /* ignore */
          }
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
