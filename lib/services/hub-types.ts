export const HUB_SERVICE_STATUSES = ["활성", "비활성", "준비중"] as const;
export type HubServiceStatus = (typeof HUB_SERVICE_STATUSES)[number];

export const HUB_SERVICE_ACCESS_LEVELS = ["전체", "슈퍼관리자", "중간관리자"] as const;
export type HubServiceAccessLevel = (typeof HUB_SERVICE_ACCESS_LEVELS)[number];

/** `public.services` 행 중 `is_hub_card = true` 인 허브 카드 표현. */
export type HubService = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  url: string | null;
  status: HubServiceStatus;
  access_level: HubServiceAccessLevel;
  order_index: number;
  created_at: string;
};

export const HUB_SERVICE_COLUMNS =
  "id, name, description, icon, url, status, access_level, order_index, created_at" as const;

/** 현재 로그인 유저 역할이 카드의 access_level 을 만족하는지 판정. */
export function canAccessHubService(
  level: HubServiceAccessLevel,
  role: string | null | undefined
): boolean {
  if (level === "전체") return true;
  if (!role) return false;
  if (level === "슈퍼관리자") return role === "슈퍼관리자";
  if (level === "중간관리자") return role === "슈퍼관리자" || role === "중간관리자";
  return false;
}

export function isHubServiceStatus(value: unknown): value is HubServiceStatus {
  return typeof value === "string" && (HUB_SERVICE_STATUSES as readonly string[]).includes(value);
}

export function isHubServiceAccessLevel(value: unknown): value is HubServiceAccessLevel {
  return (
    typeof value === "string" && (HUB_SERVICE_ACCESS_LEVELS as readonly string[]).includes(value)
  );
}
