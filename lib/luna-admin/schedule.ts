/**
 * LUNA 관리자 야간 순서 (KST).
 * 03:00 Work · 03:20 노션 · 04:00 이미지(외부) · 04:30 2차 · 05:00 자습 · 05:30 신호 · 07:00 아침 메일
 */
export const ADMIN_WORK_INDEX_HOUR = 3;
export const ADMIN_WORK_INDEX_MINUTE = 0;

export const ADMIN_NOTION_INDEX_HOUR = 3;
export const ADMIN_NOTION_INDEX_MINUTE = 20;

export const ADMIN_IMAGE_INDEX_HOUR = 4;
export const ADMIN_IMAGE_INDEX_MINUTE = 0;

export const ADMIN_LINKS_HOUR = 4;
export const ADMIN_LINKS_MINUTE = 30;

export const ADMIN_SELFSTUDY_HOUR = 5;
export const ADMIN_SELFSTUDY_MINUTE = 0;

export const ADMIN_SIGNALS_HOUR = 5;
export const ADMIN_SIGNALS_MINUTE = 30;

export const ADMIN_REPORT_HOUR = 7;
export const ADMIN_REPORT_MINUTE = 0;

/**
 * 아침 리포트 수신자. LUNA_ADMIN_REPORT_TO (쉼표 구분).
 * 예: tjlee@apollonworks.com 또는 a@x.com,b@y.com
 */
export function getAdminReportRecipients(): string[] {
  const raw = process.env.LUNA_ADMIN_REPORT_TO?.trim() ?? "";
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.includes("@"))
    )
  ];
}

export const HUB_PUBLIC_ORIGIN = "https://hub.apollonworks.com";
