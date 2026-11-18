import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { buildHubEmailShell, EMAIL_HEADER_DIGEST, escapeHtml } from "@/lib/mail/hub-email";
import { WEBSITE_TESTER_ROLE } from "@/lib/auth/website-tester";
import type { MentionMember } from "@/lib/website/contact";

const HUB_ORIGIN = "https://hub.apollonworks.com";
const NOTIFY_CATEGORY = "website_inquiry";

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

/** @ 로 부를 수 있는 허브 사람. 홈페이지테스터 · 퇴사자는 뺀다. */
export async function loadMentionTargets(admin: SupabaseClient): Promise<MentionTarget[]> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, name, email, department, role, status")
    .order("name");
  if (error) {
    console.error("[inquiry-mentions] members", error);
    return [];
  }
  return ((data ?? []) as ProfileRow[])
    .filter((row) => row.role !== WEBSITE_TESTER_ROLE && row.status !== "퇴사")
    .map((row) => ({
      id: row.id,
      name: row.name?.trim() ?? "",
      team: row.department?.trim() || null,
      email: row.email?.trim() || null
    }))
    .filter((row) => row.name.length > 0);
}

function memoHtml(memo: string): string {
  return escapeHtml(memo).replace(/\r?\n/g, "<br>");
}

async function sendMentionEmail(opts: {
  to: string;
  actorName: string;
  inquiryTitle: string;
  memo: string;
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
      <p style="margin:0 0 6px;font-size:12px;color:#666;">내부 메모</p>
      <div style="padding:12px 14px;background:#f5f5f5;font-size:14px;line-height:1.6;color:#222;">${memoHtml(opts.memo)}</div>
      <p style="margin:12px 0 0;font-size:12px;color:#666;">문의한 고객에게는 보이지 않는 메모입니다.</p>`,
    cta: { href: `${HUB_ORIGIN}${inquiryPath(opts.inquiryId)}`, label: "문의 보기" }
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

/** 새로 부른 사람마다 허브 알림 + 메일. 부른 사람 자신은 뺀다. */
export async function notifyInquiryMentions(
  admin: SupabaseClient,
  opts: {
    targets: MentionTarget[];
    actorId: string;
    actorName: string;
    inquiryId: string;
    inquiryTitle: string;
    memo: string;
  }
): Promise<{ notified: string[]; mailFailed: string[] }> {
  const notified: string[] = [];
  const mailFailed: string[] = [];
  for (const target of opts.targets) {
    if (target.id === opts.actorId) continue;
    const { error } = await admin.from("hub_notifications").insert({
      category: NOTIFY_CATEGORY,
      title: `${opts.actorName}님이 문의 메모에서 불렀습니다`,
      body: opts.inquiryTitle,
      link: inquiryPath(opts.inquiryId),
      level: "info",
      scope: "user",
      target_user_id: target.id,
      meta: { source: "website_inquiry_mention", inquiry_id: opts.inquiryId }
    });
    if (error) console.error("[inquiry-mentions] in-app insert", error);

    const sent = target.email
      ? await sendMentionEmail({
          to: target.email,
          actorName: opts.actorName,
          inquiryTitle: opts.inquiryTitle,
          memo: opts.memo,
          inquiryId: opts.inquiryId
        })
      : false;
    if (!sent) mailFailed.push(target.name);
    if (!error || sent) notified.push(target.name);
  }
  return { notified, mailFailed };
}
