import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { buildHubEmailShell, EMAIL_HEADER_DIGEST, escapeHtml } from "@/lib/mail/hub-email";
import { isMentionEligible } from "@/lib/website/hub-actor";
import {
  isCompanyEmail,
  type MentionDelivery,
  type MentionMember
} from "@/lib/website/contact";

const HUB_ORIGIN = "https://hub.apollonworks.com";
const NOTIFY_CATEGORY = "website_inquiry";
const NOTIFY_SOURCE = "website_inquiry_mention";
/** 같은 문의로 같은 사람에게 이 시간 안에 다시 알리지 않는다 */
const RECENT_MS = 2 * 60 * 1000;

type ProfileRow = {
  id: string;
  name: string | null;
  email: string | null;
  department: string | null;
  role: string | null;
  status: string | null;
};

export type MentionTarget = MentionMember & { email: string | null };

export function inquiryPath(inquiryId: string): string {
  return `/website/contact?id=${encodeURIComponent(inquiryId)}`;
}

/**
 * @ 로 부를 수 있는 허브 사람 (isMentionEligible 기준).
 * 읽기에 실패하면 null. 빈 목록으로 넘기면 「아무도 안 불렀다」로 잘못 보이기 때문이다.
 */
export async function loadMentionTargets(admin: SupabaseClient): Promise<MentionTarget[] | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, name, email, department, role, status")
    .order("name");
  if (error) {
    console.error("[inquiry-mentions] members", error);
    return null;
  }
  return ((data ?? []) as ProfileRow[])
    .filter((row) => isMentionEligible(row))
    .map((row) => ({
      id: row.id,
      name: row.name?.trim() ?? "",
      team: row.department?.trim() || null,
      email: row.email?.trim() || null
    }))
    .filter((row) => row.name.length > 0);
}

/**
 * 메일에는 메모 내용 · 고객 정보를 넣지 않는다 (누가 불렀는지, 문의 제목, 허브 링크만).
 * 받는 주소는 회사 메일만 (호출하는 쪽에서 isCompanyEmail 로 거른다).
 */
async function sendMentionEmail(opts: {
  to: string;
  actorName: string;
  inquiryTitle: string;
  inquiryId: string;
}): Promise<boolean> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!resendApiKey || !fromEmail) {
    console.error("[inquiry-mentions] Resend env vars missing");
    return false;
  }
  const html = buildHubEmailShell({
    headerBg: EMAIL_HEADER_DIGEST,
    headerLabel: "홈페이지 문의",
    title: "문의 메모에서 불렸습니다",
    subtitle: `${opts.actorName}님이 불렀습니다`,
    bodyHtml: `<p style="margin:0 0 12px;font-size:15px;color:#111;font-weight:600;">${escapeHtml(opts.inquiryTitle)}</p>
      <p style="margin:0;font-size:13px;color:#666;">메모 내용은 허브에서 확인해 주세요.</p>`,
    cta: { href: `${HUB_ORIGIN}${inquiryPath(opts.inquiryId)}`, label: "허브에서 문의 보기" }
  });
  try {
    const resend = new Resend(resendApiKey);
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: opts.to,
      subject: `[아폴론 Hub] ${opts.actorName}님이 문의 메모에서 불렀습니다: ${opts.inquiryTitle}`,
      html
    });
    if (error) {
      console.error("[inquiry-mentions] Resend failed", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[inquiry-mentions] Resend threw", err);
    return false;
  }
}

/**
 * 2분 안에 같은 문의로 이미 허브 알림을 받은 사람 id.
 * 동시에 두 번 저장하면 둘 다 이 조회를 통과할 수 있다 (막는 잠금은 두지 않았다).
 * 조회가 실패하면 빈 목록으로 보고 그대로 보낸다 (알림이 한 번 더 갈 수는 있다).
 */
async function recentlyNotified(
  admin: SupabaseClient,
  inquiryId: string,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const since = new Date(Date.now() - RECENT_MS).toISOString();
  const { data, error } = await admin
    .from("hub_notifications")
    .select("target_user_id")
    .eq("category", NOTIFY_CATEGORY)
    .eq("meta->>source", NOTIFY_SOURCE)
    .eq("meta->>inquiry_id", inquiryId)
    .in("target_user_id", ids)
    .gte("created_at", since);
  if (error) {
    console.error("[inquiry-mentions] recent check", error);
    return new Set();
  }
  return new Set(
    ((data ?? []) as { target_user_id: string | null }[])
      .map((row) => row.target_user_id)
      .filter((id): id is string => Boolean(id))
  );
}

/** 새로 부른 사람마다 허브 알림 + 메일 (결과는 길마다 따로). 부른 사람 자신은 뺀다. */
export async function notifyInquiryMentions(
  admin: SupabaseClient,
  opts: {
    targets: MentionTarget[];
    actorId: string;
    actorName: string;
    inquiryId: string;
    inquiryTitle: string;
  }
): Promise<MentionDelivery[]> {
  const seen = new Set<string>();
  const targets = opts.targets.filter((target) => {
    if (target.id === opts.actorId || seen.has(target.id)) return false;
    seen.add(target.id);
    return true;
  });
  const recent = await recentlyNotified(
    admin,
    opts.inquiryId,
    targets.map((target) => target.id)
  );

  const deliveries: MentionDelivery[] = [];
  for (const target of targets) {
    if (recent.has(target.id)) {
      deliveries.push({
        id: target.id,
        name: target.name,
        hub: "skipped",
        email: "skipped",
        skipReason: "recent"
      });
      continue;
    }

    const { error } = await admin.from("hub_notifications").insert({
      category: NOTIFY_CATEGORY,
      title: `${opts.actorName}님이 문의 메모에서 불렀습니다`,
      body: opts.inquiryTitle,
      link: inquiryPath(opts.inquiryId),
      level: "info",
      scope: "user",
      target_user_id: target.id,
      meta: { source: NOTIFY_SOURCE, inquiry_id: opts.inquiryId }
    });
    if (error) console.error("[inquiry-mentions] in-app insert", error);

    const delivery: MentionDelivery = {
      id: target.id,
      name: target.name,
      hub: error ? "failed" : "ok",
      email: "skipped"
    };
    if (!target.email) {
      delivery.skipReason = "no_email";
    } else if (!isCompanyEmail(target.email)) {
      delivery.skipReason = "not_company";
    } else {
      const sent = await sendMentionEmail({
        to: target.email,
        actorName: opts.actorName,
        inquiryTitle: opts.inquiryTitle,
        inquiryId: opts.inquiryId
      });
      delivery.email = sent ? "ok" : "failed";
    }
    deliveries.push(delivery);
  }
  return deliveries;
}
