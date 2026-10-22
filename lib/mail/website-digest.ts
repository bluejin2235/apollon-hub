import {
  buildDigestItemRow,
  EMAIL_HEADER_DIGEST,
  escapeHtml
} from "@/lib/mail/hub-email";
import { TALENT_INTEREST_LABEL } from "@/lib/website/career";
import { websiteAdminFetch } from "@/lib/website/client";

const HUB_ORIGIN = "https://hub.apollonworks.com";
const NAME_CAP = 5;

type NewsletterRow = {
  name: string | null;
  confirmed: boolean;
};

type TalentRow = {
  name: string;
  interests: string[];
  notify_until: string;
  created_at: string;
};

function unwrapData(body: unknown): unknown {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  return "data" in record ? record.data : body;
}

function asItems<T>(body: unknown): T[] {
  const data = unwrapData(body);
  if (!data || typeof data !== "object") return [];
  const items = (data as { items?: unknown }).items;
  return Array.isArray(items) ? (items as T[]) : [];
}

function extraLine(total: number): string {
  const extra = total - NAME_CAP;
  if (extra <= 0) return "";
  return buildDigestItemRow(`외 ${extra}명`, "");
}

function periodLabel(createdAt: string, notifyUntil: string): string {
  const start = Date.parse(createdAt);
  const end = Date.parse(notifyUntil);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return "—";
  }
  const months = Math.round((end - start) / (30.44 * 24 * 60 * 60 * 1000));
  if (months >= 20) return "2년";
  if (months >= 10) return "1년";
  return "6개월";
}

function interestLabel(interests: string[]): string {
  if (!Array.isArray(interests) || interests.length === 0) return "—";
  return interests.map((id) => TALENT_INTEREST_LABEL[id] ?? id).join(", ");
}

function section(label: string, title: string, itemsHtml: string, href: string): string {
  return `<div style="margin-bottom: 20px;">
      <div style="margin-bottom: 12px;">
        <span style="display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; color: ${EMAIL_HEADER_DIGEST}; background: rgba(26,26,46,0.08); padding: 4px 10px; border-radius: 4px; margin-bottom: 6px;">${escapeHtml(label)}</span>
        <div style="font-size: 14px; font-weight: 600; color: #5A5353;">${escapeHtml(title)}</div>
      </div>
      ${itemsHtml}
      <div style="padding-top: 8px;">
        <a href="${escapeHtml(href)}" style="font-size: 12px; color: #776274; text-decoration: underline;">바로가기</a>
      </div>
    </div>`;
}

export async function loadWebsiteHomepageSection(
  startIso: string,
  endIso: string
): Promise<string | null> {
  const query = `since=${encodeURIComponent(startIso)}&until=${encodeURIComponent(endIso)}`;
  const [newsletterRes, talentRes] = await Promise.all([
    websiteAdminFetch(`/api/admin/newsletter?${query}`),
    websiteAdminFetch(`/api/admin/talent-pool?${query}&filter=all`)
  ]);

  if (newsletterRes.status >= 400) {
    console.error("[daily-digest] website newsletter", newsletterRes.status, newsletterRes.body);
  }
  if (talentRes.status >= 400) {
    console.error("[daily-digest] website talent-pool", talentRes.status, talentRes.body);
  }

  const newsletters = newsletterRes.status < 400 ? asItems<NewsletterRow>(newsletterRes.body) : [];
  const talents = talentRes.status < 400 ? asItems<TalentRow>(talentRes.body) : [];

  const parts: string[] = [];

  if (newsletters.length > 0) {
    const confirmed = newsletters.filter((row) => row.confirmed).length;
    const pending = newsletters.length - confirmed;
    const names = newsletters
      .slice(0, NAME_CAP)
      .map((row) => buildDigestItemRow((row.name ?? "").trim() || "—", ""));
    parts.push(
      section(
        "홈페이지",
        `뉴스레터 새 구독 ${newsletters.length}명 (확인 완료 ${confirmed} · 확인 대기 ${pending})`,
        `${names.join("\n")}${extraLine(newsletters.length)}`,
        `${HUB_ORIGIN}/website/newsletter`
      )
    );
  }

  if (talents.length > 0) {
    const rows = talents.slice(0, NAME_CAP).map((row) =>
      buildDigestItemRow(
        (row.name ?? "").trim() || "—",
        `${interestLabel(row.interests)} · ${periodLabel(row.created_at, row.notify_until)}`
      )
    );
    parts.push(
      section(
        "홈페이지",
        `채용 알림 신청 ${talents.length}명`,
        `${rows.join("\n")}${extraLine(talents.length)}`,
        `${HUB_ORIGIN}/website/career`
      )
    );
  }

  if (parts.length === 0) return null;
  return parts.join(
    '\n<div style="border-top: 0.5px solid #E6CCBE; margin: 16px 0;"></div>\n'
  );
}

export function isHubManagerRole(role: string | null | undefined): boolean {
  const value = String(role ?? "").trim();
  return value === "슈퍼관리자" || value === "중간관리자";
}

/** 시험 발송 전용. 실제 직원 전원 발송 경로에는 쓰지 않는다. */
export const DIGEST_TEST_ONLY_EMAIL = "tjlee@apollonworks.com";
