export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const EXCLUDED_TEAM_EMAIL = "apollon@apollonworks.com";

export const EMAIL_HEADER_DIGEST = "#1a1a2e";
export const EMAIL_HEADER_LICENSE = "#0C447C";
export const EMAIL_HEADER_RESTAURANT = "#0F6E56";
export const EMAIL_HEADER_CREDIT = "#633806";

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

export function buildDigestItemRow(title: string, meta: string): string {
  return `<div style="padding: 10px 0; border-bottom: 1px solid #f1ebe8; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
    <span style="font-size: 14px; color: #5A5353; font-weight: 500;">${escapeHtml(title)}</span>
    <span style="font-size: 12px; color: #776274; text-align: right; flex-shrink: 0;">${escapeHtml(meta)}</span>
  </div>`;
}

export function buildChangeRow(label: string, before: string, after: string): string {
  return `<div style="padding: 12px 0; border-bottom: 1px solid #f1ebe8;">
    <p style="margin: 0 0 6px; font-size: 12px; color: #776274; font-weight: 500;">${escapeHtml(label)}</p>
    <p style="margin: 0; font-size: 14px;">
      <span style="color: #9ca3af; text-decoration: line-through;">${escapeHtml(before)}</span>
      <span style="color: #9ca3af; margin: 0 6px;">→</span>
      <span style="color: #5A5353; font-weight: 600;">${escapeHtml(after)}</span>
    </p>
  </div>`;
}

export function buildInfoTable(rows: { label: string; value: string }[]): string {
  const tableRows = rows
    .map(
      (row) => `<tr>
      <td style="padding: 10px 12px; border-bottom: 1px solid #f1ebe8; color: #776274; font-size: 13px; width: 36%; vertical-align: top;">${escapeHtml(row.label)}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #f1ebe8; color: #5A5353; font-size: 14px; font-weight: 500; vertical-align: top;">${escapeHtml(row.value)}</td>
    </tr>`
    )
    .join("\n");

  return `<table style="width: 100%; border-collapse: collapse; font-size: 14px;">${tableRows}</table>`;
}

export function buildAmountHighlightCard(label: string, amount: string): string {
  return `<div style="background: rgba(99,56,6,0.08); border: 1px solid rgba(99,56,6,0.2); border-radius: 10px; padding: 20px; margin-bottom: 20px; text-align: center;">
    <p style="margin: 0; font-size: 13px; color: #776274;">${escapeHtml(label)}</p>
    <p style="margin: 8px 0 0; font-size: 28px; font-weight: 700; color: #633806; letter-spacing: -0.02em;">${escapeHtml(amount)}</p>
  </div>`;
}

export function getNameInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "—") return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
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
  headerBg?: string;
  headerLabel?: string;
  cta?: { href: string; label: string };
};

export function buildReactionEmailBody(params: {
  emoji: string;
  reactorName: string;
  restaurantName: string;
  variant: "restaurant" | "review";
}): string {
  const initials = getNameInitials(params.reactorName);
  const contextLine =
    params.variant === "review"
      ? `${escapeHtml(params.restaurantName)} · 회원님의 리뷰`
      : escapeHtml(params.restaurantName);

  return `<div style="text-align: center; margin-bottom: 8px;">
    <div style="font-size: 48px; line-height: 1.2; margin-bottom: 24px;">${params.emoji}</div>
    <table style="margin: 0 auto; border-collapse: collapse;">
      <tr>
        <td style="vertical-align: middle; padding-right: 12px;">
          <div style="width: 44px; height: 44px; border-radius: 50%; background: ${EMAIL_HEADER_RESTAURANT}; color: #ffffff; font-size: 15px; font-weight: 600; line-height: 44px; text-align: center;">${escapeHtml(initials)}</div>
        </td>
        <td style="vertical-align: middle; text-align: left;">
          <p style="margin: 0; font-size: 15px; font-weight: 600; color: #5A5353;">${escapeHtml(params.reactorName)}</p>
          <p style="margin: 4px 0 0; font-size: 13px; color: #776274;">${contextLine}</p>
        </td>
      </tr>
    </table>
  </div>`;
}

/** Hub 메일 공통 레이아웃 (헤더 + 본문 + 선택 CTA + 푸터) */
export function buildHubEmailShell(params: HubEmailShellParams): string {
  const headerBg = params.headerBg ?? EMAIL_HEADER_DIGEST;
  const headerLabel = params.headerLabel ?? "APOLLON HUB";

  const ctaHtml = params.cta
    ? `<div style="text-align: center; margin-top: 24px;">
      <a href="${params.cta.href}" style="display: inline-block; background: ${headerBg}; color: #ffffff; font-size: 14px; font-weight: 500; padding: 12px 32px; border-radius: 8px; text-decoration: none; letter-spacing: 0.02em;">${escapeHtml(params.cta.label)}</a>
    </div>`
    : "";

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e0d8d4;">
  <div style="background: ${headerBg}; padding: 28px 32px;">
    <p style="color: rgba(255,255,255,0.75); font-size: 12px; font-weight: 500; letter-spacing: 0.06em; margin: 0 0 12px; text-transform: uppercase;">${escapeHtml(headerLabel)}</p>
    <h1 style="color: #ffffff; font-size: 20px; font-weight: 600; margin: 0 0 6px; line-height: 1.3;">${escapeHtml(params.title)}</h1>
    <p style="color: rgba(255,255,255,0.85); font-size: 13px; margin: 0; line-height: 1.5;">${escapeHtml(params.subtitle)}</p>
  </div>
  <div style="padding: 24px 32px; background: #ffffff;">
    ${params.bodyHtml}
    ${ctaHtml}
  </div>
  <div style="padding: 16px 32px; background: #fafafa; border-top: 1px solid #eeeeee; text-align: center;">
    <p style="font-size: 11px; color: #9ca3af; margin: 0;">아폴론이머시브웍스 · hub@apollonworks.com</p>
  </div>
</div>`;
}
