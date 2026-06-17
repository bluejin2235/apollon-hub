export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const EXCLUDED_TEAM_EMAIL = "apollon@apollonworks.com";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildItemCard(mainText: string, subText: string): string {
  return `<div style="background: rgba(230,204,190,0.15); border: 0.5px solid #E6CCBE; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: 14px; color: #5A5353; font-weight: 500;">${escapeHtml(mainText)}</span>
      <span style="font-size: 11px; color: #776274;">${escapeHtml(subText)}</span>
    </div>`;
}

/** KST 기준 `YYYY년 M월 D일` (기본: 현재 시각) */
export function toKstDateString(utcMs: number = Date.now()): string {
  const kst = new Date(utcMs + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  const d = kst.getUTCDate();
  return `${y}년 ${m}월 ${d}일`;
}

/** KST 기준 `YYYY년 M월 D일 HH:mm (KST)` (기본: 현재 시각) */
export function toKstDateTimeString(utcMs: number = Date.now()): string {
  const kst = new Date(utcMs + KST_OFFSET_MS);
  const h = String(kst.getUTCHours()).padStart(2, "0");
  const min = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${toKstDateString(utcMs)} ${h}:${min} (KST)`;
}

type HubEmailShellParams = {
  title: string;
  subtitle: string;
  bodyHtml: string;
  cta?: { href: string; label: string };
};

/** Hub 메일 공통 레이아웃 (헤더 + 본문 + 선택 CTA + 푸터) */
export function buildHubEmailShell(params: HubEmailShellParams): string {
  const ctaHtml = params.cta
    ? `<div style="text-align: center; margin-top: 24px;">
      <a href="${params.cta.href}" style="display: inline-block; background: #5A5353; color: #E6CCBE; font-size: 14px; font-weight: 500; padding: 12px 32px; border-radius: 8px; text-decoration: none; letter-spacing: 0.02em;">${escapeHtml(params.cta.label)}</a>
    </div>`
    : "";

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e0d8d4;">
  <div style="background: #5A5353; padding: 28px 32px;">
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
      <div style="width: 28px; height: 28px; background: #A07178; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #E6CCBE;">A</div>
      <span style="color: #E6CCBE; font-size: 12px; font-weight: 500; letter-spacing: 0.05em;">APOLLON HUB</span>
    </div>
    <h1 style="color: #ffffff; font-size: 20px; font-weight: 500; margin: 0 0 4px;">${escapeHtml(params.title)}</h1>
    <p style="color: #C8CC92; font-size: 13px; margin: 0;">${escapeHtml(params.subtitle)}</p>
  </div>
  <div style="padding: 24px 32px; background: #ffffff;">
    ${params.bodyHtml}
    ${ctaHtml}
  </div>
  <div style="padding: 16px 32px; background: rgba(160,113,120,0.1); border-top: 0.5px solid #E6CCBE; text-align: center;">
    <p style="font-size: 12px; color: #776274; margin: 0;">아폴론이머시브웍스 · hub@apollonworks.com</p>
  </div>
</div>`;
}
