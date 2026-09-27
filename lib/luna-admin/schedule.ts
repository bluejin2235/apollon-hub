/**
 * LUNA 관리자 야간 순서 (KST).
 * 22:00 이미지 · 03:00 Work 스캔 · 03:10 본문 추출 · 03:20 노션
 * · 04:00 모드 A(PC) · 04:30 2차(Vercel) · 05:30 신호 · 07:00 아침 메일
 *
 * Work 본문: 플랜 A = 추출+trigram (임베딩 안 함).
 * 의미 검색 실패가 쌓이면 플랜 B(2024~ 임베딩)로 올린다. 전량(C)은 보류.
 */
export const ADMIN_WORK_INDEX_HOUR = 3;
export const ADMIN_WORK_INDEX_MINUTE = 0;

/** Work 문서 본문 추출 (NAS 스캔 직후) */
export const ADMIN_WORK_TEXT_HOUR = 3;
export const ADMIN_WORK_TEXT_MINUTE = 10;

/**
 * Work 본문 청크 임베딩 — 플랜 A 동안 스케줄 비활성.
 * 플랜 B 전환 시에만 켠다.
 */
export const ADMIN_WORK_TEXT_EMBED_HOUR = 3;
export const ADMIN_WORK_TEXT_EMBED_MINUTE = 25;
/** false = 플랜 A (임베딩 cron 돌리지 않음) */
export const ADMIN_WORK_TEXT_EMBED_ENABLED = false;

export const ADMIN_NOTION_INDEX_HOUR = 3;
export const ADMIN_NOTION_INDEX_MINUTE = 20;

export const ADMIN_IMAGE_INDEX_HOUR = 22;
export const ADMIN_IMAGE_INDEX_MINUTE = 0;

export const ADMIN_LINKS_HOUR = 4;
export const ADMIN_LINKS_MINUTE = 30;

/** PC 작업 스케줄러 「Apollon Luna Mode A」 — 07:00 메일 전에 끝나게 04:00 */
export const ADMIN_MODE_A_HOUR = 4;
export const ADMIN_MODE_A_MINUTE = 0;

/** 자습 표시 시각 = 모드 A PC. Vercel luna-selfstudy 는 쓰지 않는다. */
export const ADMIN_SELFSTUDY_HOUR = ADMIN_MODE_A_HOUR;
export const ADMIN_SELFSTUDY_MINUTE = ADMIN_MODE_A_MINUTE;

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
