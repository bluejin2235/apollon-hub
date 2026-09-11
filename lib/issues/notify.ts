import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import {
  buildHubEmailShell,
  EMAIL_HEADER_DIGEST,
  escapeHtml
} from "@/lib/mail/hub-email";
import { kstDayWindow, kstHour } from "@/lib/issues/time";
import {
  HUB_ISSUE_CATEGORY,
  HUB_ISSUES_URL,
  ISSUE_NOTIFY_NAME,
  type IssueKind
} from "@/lib/issues/types";

const IMMEDIATE_NEW_ISSUE_CAP = 3;
const DIGEST_HOUR_KST = 18;

type ProfileLite = { id: string; name: string | null; email: string | null };

function issueLink(seq: number): string {
  return `${HUB_ISSUES_URL}/${seq}`;
}

function issuePath(seq: number): string {
  return `/issues/${seq}`;
}

async function sendEmail(opts: {
  to: string;
  subject: string;
  title: string;
  subtitle: string;
  bodyHtml: string;
  seq: number;
}): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!resendApiKey || !fromEmail) {
    console.error("[issues/notify] Resend env vars missing");
    return;
  }
  const html = buildHubEmailShell({
    headerBg: EMAIL_HEADER_DIGEST,
    headerLabel: "문의 게시판",
    title: opts.title,
    subtitle: opts.subtitle,
    bodyHtml: opts.bodyHtml,
    cta: { href: issueLink(opts.seq), label: "문의 보기" }
  });
  const resend = new Resend(resendApiKey);
  const { error } = await resend.emails.send({
    from: fromEmail,
    to: opts.to,
    subject: opts.subject,
    html
  });
  if (error) {
    console.error("[issues/notify] Resend failed", error);
  }
}

async function insertInApp(
  admin: SupabaseClient,
  opts: {
    userId: string;
    title: string;
    body: string;
    seq: number;
    issueId: string;
  }
): Promise<void> {
  const { error } = await admin.from("hub_notifications").insert({
    category: HUB_ISSUE_CATEGORY,
    title: opts.title,
    body: opts.body,
    link: issuePath(opts.seq),
    level: "info",
    scope: "user",
    target_user_id: opts.userId,
    meta: { issue_id: opts.issueId, seq: opts.seq }
  });
  if (error) {
    console.error("[issues/notify] in-app insert", error);
  }
}

export async function loadIssueNotifyOwner(
  admin: SupabaseClient
): Promise<ProfileLite | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, name, email")
    .eq("name", ISSUE_NOTIFY_NAME)
    .maybeSingle();
  if (error) {
    console.error("[issues/notify] owner lookup", error);
    return null;
  }
  return (data as ProfileLite | null) ?? null;
}

export async function countNewIssuesToday(
  admin: SupabaseClient,
  nowMs = Date.now()
): Promise<number> {
  const { startIso, endIso } = kstDayWindow(nowMs);
  const { count, error } = await admin
    .from("issues")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startIso)
    .lt("created_at", endIso);
  if (error) {
    console.error("[issues/notify] today count", error);
    return 0;
  }
  return count ?? 0;
}

function shouldSendNewIssueNow(todayCount: number, nowMs = Date.now()): boolean {
  if (todayCount <= IMMEDIATE_NEW_ISSUE_CAP) return true;
  return kstHour(nowMs) >= DIGEST_HOUR_KST;
}

export async function notifyNewIssue(
  admin: SupabaseClient,
  opts: {
    seq: number;
    issueId: string;
    title: string;
    kind: IssueKind;
    area: string;
    authorId: string;
    authorName: string;
  }
): Promise<void> {
  const owner = await loadIssueNotifyOwner(admin);
  if (!owner || owner.id === opts.authorId) return;
  const todayCount = await countNewIssuesToday(admin);
  if (!shouldSendNewIssueNow(todayCount)) return;
  const email = owner.email?.trim();
  if (!email) return;
  await sendEmail({
    to: email,
    subject: `[아폴론 Hub] 새 문의 #${opts.seq} — ${opts.title}`,
    title: "새 문의가 올라왔습니다",
    subtitle: `${opts.authorName} · ${opts.kind} · ${opts.area}`,
    bodyHtml: `<p style="margin:0 0 8px;font-size:15px;color:#5A5353;font-weight:600;">${escapeHtml(opts.title)}</p>
      <p style="margin:0;font-size:13px;color:#776274;">#${opts.seq} · ${escapeHtml(opts.kind)} · ${escapeHtml(opts.area)}</p>`,
    seq: opts.seq
  });
}

export async function notifyMentioned(
  admin: SupabaseClient,
  opts: {
    seq: number;
    issueId: string;
    title: string;
    actorId: string;
    actorName: string;
    names: string[];
    members: ProfileLite[];
  }
): Promise<void> {
  const wanted = new Set(opts.names);
  for (const member of opts.members) {
    const name = member.name?.trim() ?? "";
    if (!wanted.has(name)) continue;
    if (member.id === opts.actorId) continue;
    const email = member.email?.trim();
    if (email) {
      await sendEmail({
        to: email,
        subject: `[아폴론 Hub] ${opts.actorName}님이 문의에서 불렀습니다 — ${opts.title}`,
        title: "문의에서 불렸습니다",
        subtitle: `${opts.actorName}님이 @${name} 으로 불렀습니다`,
        bodyHtml: `<p style="margin:0;font-size:15px;color:#5A5353;font-weight:600;">${escapeHtml(opts.title)}</p>`,
        seq: opts.seq
      });
    }
  }
}

export async function notifyAssigned(
  admin: SupabaseClient,
  opts: {
    seq: number;
    issueId: string;
    title: string;
    assigneeId: string;
    actorId: string;
    actorName: string;
  }
): Promise<void> {
  if (opts.assigneeId === opts.actorId) return;
  const { data } = await admin
    .from("profiles")
    .select("id, name, email")
    .eq("id", opts.assigneeId)
    .maybeSingle();
  const profile = data as ProfileLite | null;
  if (!profile) return;
  const email = profile.email?.trim();
  if (!email) return;
  await sendEmail({
    to: email,
    subject: `[아폴론 Hub] 문의가 맡겨졌습니다 — ${opts.title}`,
    title: "문의가 맡겨졌습니다",
    subtitle: `${opts.actorName}님이 맡겼습니다`,
    bodyHtml: `<p style="margin:0;font-size:15px;color:#5A5353;font-weight:600;">${escapeHtml(opts.title)}</p>`,
    seq: opts.seq
  });
}

export async function notifyCommentInApp(
  admin: SupabaseClient,
  opts: {
    seq: number;
    issueId: string;
    title: string;
    authorId: string;
    commenterId: string;
    commenterName: string;
    watcherIds: string[];
  }
): Promise<void> {
  const targets = new Set<string>();
  if (opts.authorId !== opts.commenterId) targets.add(opts.authorId);
  for (const id of opts.watcherIds) {
    if (id !== opts.commenterId && id !== opts.authorId) targets.add(id);
  }
  for (const userId of targets) {
    const isAuthor = userId === opts.authorId;
    await insertInApp(admin, {
      userId,
      title: isAuthor ? "내 문의에 댓글이 달렸습니다" : "지켜보는 문의에 댓글이 달렸습니다",
      body: `${opts.commenterName} · ${opts.title}`,
      seq: opts.seq,
      issueId: opts.issueId
    });
  }
}

export async function notifyStatusInApp(
  admin: SupabaseClient,
  opts: {
    seq: number;
    issueId: string;
    title: string;
    authorId: string;
    actorId: string;
    fromStatus: string;
    toStatus: string;
  }
): Promise<void> {
  if (opts.authorId === opts.actorId) return;
  await insertInApp(admin, {
    userId: opts.authorId,
    title: "내 문의 상태가 바뀌었습니다",
    body: `${opts.title} · ${opts.fromStatus} → ${opts.toStatus}`,
    seq: opts.seq,
    issueId: opts.issueId
  });
}

export async function sendNewIssueDigest(
  admin: SupabaseClient,
  nowMs = Date.now()
): Promise<{ sent: boolean; extra: number }> {
  const owner = await loadIssueNotifyOwner(admin);
  const email = owner?.email?.trim();
  if (!owner || !email) return { sent: false, extra: 0 };

  const { startIso, endIso } = kstDayWindow(nowMs);
  const { data, error } = await admin
    .from("issues")
    .select("seq, title, kind, area, created_at")
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[issues/notify] digest fetch", error);
    return { sent: false, extra: 0 };
  }
  const rows = data ?? [];
  if (rows.length <= IMMEDIATE_NEW_ISSUE_CAP) {
    return { sent: false, extra: 0 };
  }
  const extra = rows.slice(IMMEDIATE_NEW_ISSUE_CAP);
  const list = extra
    .map(
      (row) =>
        `<div style="padding:8px 0;border-bottom:1px solid #f1ebe8;">
          <span style="font-size:14px;color:#5A5353;font-weight:500;">#${escapeHtml(String(row.seq))} ${escapeHtml(String(row.title ?? ""))}</span>
          <span style="font-size:12px;color:#776274;margin-left:8px;">${escapeHtml(String(row.kind ?? ""))} · ${escapeHtml(String(row.area ?? ""))}</span>
        </div>`
    )
    .join("");
  await sendEmail({
    to: email,
    subject: `[아폴론 Hub] 오늘 새 문의 ${rows.length}건`,
    title: "오늘 올라온 문의를 묶었습니다",
    subtitle: `바로 보낸 3건을 빼고 ${extra.length}건을 모았습니다`,
    bodyHtml: list,
    seq: Number(extra[0]?.seq ?? rows[0]?.seq ?? 0)
  });
  return { sent: true, extra: extra.length };
}
