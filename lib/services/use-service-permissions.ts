"use client";

import { useEffect, useState } from "react";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import {
  canCreateLicense,
  canManageLicense,
  canManageResearch,
  canManageRestaurant,
  canManageSupply
} from "@/lib/services/permissions";

/**
 * 비동기 서비스 권한 체크용 커스텀 훅.
 *
 * 반환값: `boolean | null`
 *   - `null`  = 세션/권한 확인 중 (로딩)
 *   - `true`  = 권한 있음
 *   - `false` = 권한 없음
 *
 * 각 훅은 내부에서 `useRequirePortalSession()` 으로 현재 프로필(role 포함)을 가져온다.
 */

/** 라이선스 관리(수정/삭제) 권한. */
export function useCanManageLicense(licenseId: string | null | undefined): boolean | null {
  const { status, profile } = useRequirePortalSession();
  const [result, setResult] = useState<boolean | null>(null);

  useEffect(() => {
    if (status !== "ready") {
      setResult(null);
      return;
    }
    let cancelled = false;
    setResult(null);
    void (async () => {
      const ok = await canManageLicense(profile, licenseId);
      if (!cancelled) setResult(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, profile, licenseId]);

  return result;
}

/** 비품 관리(수정/삭제/라벨 등) 권한. */
export function useCanManageSupply(supplyManagerId: string | null | undefined): boolean | null {
  const { status, profile } = useRequirePortalSession();
  const [result, setResult] = useState<boolean | null>(null);

  useEffect(() => {
    if (status !== "ready") {
      setResult(null);
      return;
    }
    let cancelled = false;
    setResult(null);
    void (async () => {
      const ok = await canManageSupply(profile, supplyManagerId);
      if (!cancelled) {
        setResult(ok);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, profile, supplyManagerId]);

  return result;
}

/** 맛집 관리(수정/삭제) 권한. */
export function useCanManageRestaurant(
  registeredBy: string | null | undefined
): boolean | null {
  const { status, profile } = useRequirePortalSession();
  const [result, setResult] = useState<boolean | null>(null);

  useEffect(() => {
    if (status !== "ready") {
      setResult(null);
      return;
    }
    let cancelled = false;
    setResult(null);
    void (async () => {
      const ok = await canManageRestaurant(profile, registeredBy);
      if (!cancelled) setResult(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, profile, registeredBy]);

  return result;
}

/** 라이선스 생성 권한 (슈퍼관리자 OR 라이선스매니저 서비스 중간관리자). */
export function useCanCreateLicense(): boolean | null {
  const { status, profile } = useRequirePortalSession();
  const [result, setResult] = useState<boolean | null>(null);

  useEffect(() => {
    if (status !== "ready") {
      setResult(null);
      return;
    }
    let cancelled = false;
    setResult(null);
    void (async () => {
      const ok = await canCreateLicense(profile);
      if (!cancelled) setResult(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, profile]);

  return result;
}

/** 트렌드 레이더 관리 권한 (슈퍼관리자 OR /research 중간관리자). */
export function useResearchManager(): boolean | null {
  const { status, profile } = useRequirePortalSession();
  const [result, setResult] = useState<boolean | null>(null);

  useEffect(() => {
    if (status !== "ready") {
      setResult(null);
      return;
    }
    let cancelled = false;
    setResult(null);
    void (async () => {
      const ok = await canManageResearch(profile);
      if (!cancelled) setResult(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, profile]);

  return result;
}
