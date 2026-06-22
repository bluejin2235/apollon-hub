import { supabase } from "@/lib/supabase/client";
import type { PortalProfileRow } from "@/lib/portal/profile";

/**
 * 서비스별 권한 체크 헬퍼.
 *
 * - 상위 앱(라이선스매니저/아슐랭/아르테/물품창고/트렌드레이더)은 `services` 테이블의
 *   `is_hub_card = true` 행이며, slug 가 없으므로 `url`(라우트)로 식별한다.
 * - 서비스 단위 "중간관리자" 는 `service_user_roles` 테이블에 저장된다.
 * - 개별 라이선스 담당자는 기존 `license_managers` 테이블을 사용한다.
 */

/** Hub 카드 url 기준 서비스 식별 상수. */
export const SERVICE_URL = {
  LICENSE_MANAGER: "/licenses",
  ASHULENG: "/restaurants",
  ARTE: "/agents",
  SUPPLIES: "/supplies",
  RESEARCH: "/research"
} as const;

export type ServiceUrl = (typeof SERVICE_URL)[keyof typeof SERVICE_URL];

/** service_user_roles 의 서비스 단위 역할 (현재는 하나뿐). */
export type ServiceUserRole = "중간관리자";

export type ServiceRoleAssignment = {
  id: string;
  service_id: string;
  profile_id: string;
  role: ServiceUserRole;
  created_at: string;
};

const SUPER_ADMIN_ROLE = "슈퍼관리자";
const MIDDLE_ADMIN_ROLE: ServiceUserRole = "중간관리자";

/**
 * url → service_id 모듈 레벨 캐시.
 * 첫 호출 시 DB 조회 후 캐싱, 이후는 캐시 반환.
 * 페이지 새로고침(번들 재평가) 시 자동 초기화된다.
 */
const serviceIdCache = new Map<string, string | null>();

/** `services` 에서 url + is_hub_card=true 로 서비스 id 조회 (캐시). */
export async function getServiceIdByUrl(url: string): Promise<string | null> {
  if (serviceIdCache.has(url)) {
    return serviceIdCache.get(url) ?? null;
  }

  const { data, error } = await supabase
    .from("services")
    .select("id")
    .eq("url", url)
    .eq("is_hub_card", true)
    .limit(1);

  if (error) {
    // 오류는 캐싱하지 않아 다음 호출에서 재시도 가능.
    console.error("[permissions] getServiceIdByUrl 실패", { url, error });
    return null;
  }

  const id = data?.[0]?.id ?? null;
  serviceIdCache.set(url, id);
  return id;
}

/** 슈퍼관리자 여부. */
export function isSuperAdmin(profile: PortalProfileRow | null | undefined): boolean {
  return profile?.role === SUPER_ADMIN_ROLE;
}

/** 특정 서비스(url)의 중간관리자 여부. */
export async function isMiddleAdmin(
  userId: string | null | undefined,
  serviceUrl: string
): Promise<boolean> {
  if (!userId) return false;

  const serviceId = await getServiceIdByUrl(serviceUrl);
  if (!serviceId) return false;

  const { data, error } = await supabase
    .from("service_user_roles")
    .select("id")
    .eq("service_id", serviceId)
    .eq("profile_id", userId)
    .eq("role", MIDDLE_ADMIN_ROLE)
    .limit(1);

  if (error) {
    console.error("[permissions] isMiddleAdmin 실패", { userId, serviceUrl, error });
    return false;
  }

  return Boolean(data && data.length > 0);
}

/** 해당 라이선스(서비스 id)의 license_managers 담당자 여부. */
export async function isLicenseManager(
  userId: string | null | undefined,
  licenseServiceId: string | null | undefined
): Promise<boolean> {
  if (!userId || !licenseServiceId) return false;

  const { data, error } = await supabase
    .from("license_managers")
    .select("id")
    .eq("service_id", licenseServiceId)
    .eq("profile_id", userId)
    .limit(1);

  if (error) {
    console.error("[permissions] isLicenseManager 실패", { userId, licenseServiceId, error });
    return false;
  }

  return Boolean(data && data.length > 0);
}

/**
 * 라이선스 관리 권한.
 * 슈퍼관리자 OR 라이선스매니저 서비스 중간관리자 OR 해당 license_managers 담당자.
 */
export async function canManageLicense(
  userProfile: PortalProfileRow | null | undefined,
  licenseServiceId: string | null | undefined
): Promise<boolean> {
  if (!userProfile?.id) return false;
  if (isSuperAdmin(userProfile)) return true;
  if (await isMiddleAdmin(userProfile.id, SERVICE_URL.LICENSE_MANAGER)) return true;
  if (await isLicenseManager(userProfile.id, licenseServiceId)) return true;
  return false;
}

/**
 * 라이선스 생성 권한.
 * 슈퍼관리자 OR 라이선스매니저 서비스 중간관리자.
 */
export async function canCreateLicense(
  userProfile: PortalProfileRow | null | undefined
): Promise<boolean> {
  if (!userProfile?.id) return false;
  if (isSuperAdmin(userProfile)) return true;
  if (await isMiddleAdmin(userProfile.id, SERVICE_URL.LICENSE_MANAGER)) return true;
  return false;
}

/** 비품 등록 권한: 인증된 멤버이면 누구나 가능. */
export function canCreateSupply(userProfile: PortalProfileRow | null | undefined): boolean {
  return Boolean(userProfile?.id);
}

/**
 * 비품 관리(수정/삭제 등) 권한.
 * 슈퍼관리자 OR 비품담당자(manager_id 일치) OR 물품창고 중간관리자.
 */
export async function canManageSupply(
  userProfile: PortalProfileRow | null | undefined,
  supplyManagerId: string | null | undefined
): Promise<boolean> {
  if (!userProfile?.id) return false;
  if (isSuperAdmin(userProfile)) return true;
  if (supplyManagerId && supplyManagerId === userProfile.id) return true;
  if (await isMiddleAdmin(userProfile.id, SERVICE_URL.SUPPLIES)) return true;
  return false;
}

/**
 * 맛집 관리 권한.
 * 슈퍼관리자 OR 등록자(registered_by 일치) OR 아슐랭 중간관리자.
 */
export async function canManageRestaurant(
  userProfile: PortalProfileRow | null | undefined,
  restaurantRegisteredBy: string | null | undefined
): Promise<boolean> {
  if (!userProfile?.id) return false;
  if (isSuperAdmin(userProfile)) return true;
  if (restaurantRegisteredBy && restaurantRegisteredBy === userProfile.id) return true;
  if (await isMiddleAdmin(userProfile.id, SERVICE_URL.ASHULENG)) return true;
  return false;
}
