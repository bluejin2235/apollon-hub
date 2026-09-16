import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildHubEmailShell,
  escapeHtml,
  toKstDateString
} from "@/lib/mail/hub-email";
import { getSelfstudyStatus } from "@/lib/luna/selfstudy";
import { countOpenFailures } from "@/lib/luna/failures";
import { buildPrimarySources } from "@/lib/luna-admin/primary";
import { buildAdminDashboard } from "@/lib/luna-admin/dashboard";
import { countLinks, latestLinkAt, listLinks } from "@/lib/luna-admin/links";
import { listQuestions } from "@/lib/luna-admin/questions";
import { loadTonightState } from "@/lib/luna-admin/tonight";
import { lightEmoji, type TrafficLight } from "@/lib/luna-admin/traffic";
import {
  getAdminReportRecipients,
  HUB_PUBLIC_ORIGIN
} from "@/lib/luna-admin/schedule";
import { buildLunaAdminUrl } from "@/lib/luna-admin/nav";
import { collectStudyMorningLines } from "@/lib/luna/study-report";

export type AdminReportResult = {
  ok: boolean;
  skipped?: boolean;
  to?: string;
  subject?: string;
  messageId?: string;
  error?: string;
  textPreview?: string;
};

function hubHref(path: string): string {
  return `${HUB_PUBLIC_ORIGIN}${path}`;
}

function btn(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin-left:8px;padding:4px 10px;border:1px solid #d7d4ef;border-radius:8px;font-size:11px;color:#3C3489;text-decoration:none;font-weight:600;">${escapeHtml(label)}</a>`;
}

function section(
  light: TrafficLight | string,
  title: string,
  body: string,
  href: string,
  label: string
): string {
  const emoji =
    light === "green" || light === "yellow" || light === "red"
      ? lightEmoji(light)
      : light;
  return `<div style="padding:12px 0;border-bottom:1px solid #f1ebe8;">
    <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1c1d21;">${emoji} ${escapeHtml(title)} ${btn(href, label)}</p>
    <p style="margin:0;font-size:13px;color:#5A5353;line-height:1.7;">${body}</p>
  </div>`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function buildAdminReportHtml(
  admin: SupabaseClient,
  userId: string,
  now = new Date()
): Promise<{ subject: string; html: string; quiet: boolean; textPreview: string }> {
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const startIso = windowStart.toISOString();
  const endIso = windowEnd.toISOString();
  const dateLabel = toKstDateString(now.getTime());

  const [
    primary,
    dash,
    selfstudy,
    newLinks,
    latestLink,
    talkRows,
    talkUsers,
    questions,
    tonight,
    openFailures,
    studyLines
  ] = await Promise.all([
    buildPrimarySources(admin),
    buildAdminDashboard(admin, userId),
    getSelfstudyStatus(admin),
    countLinks(admin, { sinceIso: startIso }),
    latestLinkAt(admin),
    admin
      .from("luna_messages")
      .select("content")
      .eq("role", "user")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(80),
    admin
      .from("luna_conversations")
      .select("user_id")
      .gte("updated_at", startIso)
      .lt("updated_at", endIso)
      .limit(500),
    listQuestions(admin, { status: "pending" }),
    loadTonightState(admin),
    countOpenFailures(admin),
    collectStudyMorningLines(admin, startIso, endIso)
  ]);

  const collectStage = dash.stages.find((s) => s.key === "collect");
  const redIndex = [
    primary.work.status === "red" ? `Work ${primary.work.last_label}` : null,
    primary.notion.status === "red" ? `노션 ${primary.notion.last_label}` : null,
    primary.image.status === "red" ? `이미지 ${primary.image.last_label}` : null
  ].filter(Boolean);

  const userMsgs = (talkRows.data ?? [])
    .map((r) => String(r.content ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3);
  const talkSummary =
    userMsgs.length > 0
      ? userMsgs.map((m) => escapeHtml(m.length > 80 ? `${m.slice(0, 80)}…` : m)).join("<br>")
      : "지난 24시간 대화가 없습니다.";
  const talkLight: TrafficLight = userMsgs.length > 0 ? "green" : "yellow";

  const uids = [...new Set((talkUsers.data ?? []).map((r) => r.user_id).filter(Boolean))] as string[];
  let userLine = `${uids.length}명`;
  if (uids.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, name").in("id", uids);
    const names = (profiles ?? [])
      .map((p) => (typeof p.name === "string" ? p.name : ""))
      .filter(Boolean);
    if (names.length) userLine = `${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""} · ${uids.length}명`;
  }
  const userLight: TrafficLight = uids.length > 0 ? "green" : "yellow";

  const linkSamples = await listLinks(admin);
  const newLinkLines = linkSamples
    .filter((l) => l.created_at >= startIso)
    .slice(0, 5)
    .map((l) => escapeHtml(`${l.kind} · ${l.from_id} → ${l.to_id}`));
  const secondaryLight: TrafficLight = newLinks > 0 ? "green" : "yellow";

  const errors = redIndex.length
    ? redIndex.map((x) => escapeHtml(String(x))).join("<br>")
    : "표시할 오류가 없습니다.";

  const goods: string[] = [];
  if (collectStage?.light === "green") goods.push("1차 색인이 정상입니다.");
  if ((selfstudy.last_run?.submitted ?? 0) > 0) {
    goods.push(`자습 ${selfstudy.last_run?.submitted}건 제출`);
  }
  if (newLinks > 0) goods.push(`2차 데이터 ${newLinks}건 증가`);
  if (studyLines.length > 1) goods.push("어젯밤 자율 자습이 돌았습니다.");
  const goodLine = goods.length ? goods.map(escapeHtml).join("<br>") : "큰 변화는 없습니다.";
  const goodLight: TrafficLight = goods.length ? "green" : "yellow";

  const askLines =
    questions.length > 0
      ? questions
          .slice(0, 5)
          .map((q) => escapeHtml(q.question.length > 90 ? `${q.question.slice(0, 90)}…` : q.question))
          .join("<br>")
      : "지금 답할 질문은 없습니다.";

  const fixItems = tonight.items.filter((i) => !i.excluded && i.when === "tonight");
  const fixLine =
    fixItems.length > 0
      ? fixItems.map((i) => escapeHtml(`${i.title} — ${i.why}`)).join("<br>")
      : openFailures > 0
        ? `열린 실패 ${openFailures}건`
        : "지금 손볼 일은 없습니다.";
  const fixLight: TrafficLight =
    fixItems.length > 0 || openFailures > 0 ? "yellow" : "green";

  const studyHtml =
    studyLines.length > 0
      ? studyLines
          .map((line, idx) => {
            if (idx === 0) {
              return `<p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#1c1d21;">🌙 ${escapeHtml(line)}</p>`;
            }
            return `<p style="margin:0 0 10px;font-size:13px;color:#5A5353;line-height:1.7;white-space:pre-wrap;">${escapeHtml(line)}</p>`;
          })
          .join("")
      : `<p style="margin:0;font-size:13px;color:#5A5353;line-height:1.7;">어젯밤 자율 자습 실행이 없습니다.</p>`;

  const studyBlock = `<div style="padding:14px 0;border-bottom:1px solid #f1ebe8;">
    ${studyHtml}
    <p style="margin:8px 0 0;">${btn(hubHref(buildLunaAdminUrl("selfstudy", "history")), "자습 이력")}</p>
  </div>`;

  const quiet =
    userMsgs.length === 0 &&
    newLinks === 0 &&
    questions.length === 0 &&
    redIndex.length === 0 &&
    fixItems.length === 0 &&
    studyLines.length === 0;

  const body = [
    section(
      collectStage?.light ?? "yellow",
      "① 1차 데이터 색인 현황",
      `Work ${escapeHtml(primary.work.last_label)} · 노션 ${escapeHtml(primary.notion.last_label)} · 이미지 ${escapeHtml(primary.image.last_label)}`,
      hubHref(buildLunaAdminUrl("knowledge", "primary")),
      "지식"
    ),
    section(
      talkLight,
      "② 대화 — 어떤 내용이 많았나",
      talkSummary,
      hubHref(buildLunaAdminUrl("talk", "history")),
      "대화"
    ),
    section(
      userLight,
      "③ 사용자 — 누가 얼마나",
      escapeHtml(userLine),
      hubHref(buildLunaAdminUrl("talk", "metrics")),
      "관측"
    ),
    section(
      secondaryLight,
      "④ 2차 데이터 — 어떤 연결이 생겼나",
      newLinkLines.length
        ? newLinkLines.join("<br>")
        : `새 연결 ${newLinks}건${latestLink ? ` · 마지막 ${escapeHtml(latestLink)}` : ""}`,
      hubHref(buildLunaAdminUrl("knowledge", "secondary")),
      "2차"
    ),
    section(
      redIndex.length ? "red" : "green",
      "⑤ 오류",
      errors,
      hubHref(buildLunaAdminUrl("failures", "causes")),
      "실패"
    ),
    section(
      goodLight,
      "⑥ 잘 되고 있는 것",
      goodLine,
      hubHref("/settings?menu=dashboard"),
      "대시보드"
    ),
    section(
      questions.length ? "yellow" : "green",
      "⑦ 내가 답해야 할 것",
      askLines,
      hubHref(buildLunaAdminUrl("candidates", "mine")),
      "지식후보"
    ),
    section(
      fixLight,
      "⑧ 내가 해결해야 할 것",
      fixLine,
      hubHref(buildLunaAdminUrl("selfstudy", "tonight")),
      "자습"
    ),
    studyBlock
  ].join("");

  const html = buildHubEmailShell({
    title: quiet ? "지난 24시간, 큰 변화는 없습니다." : `LUNA 아침 리포트 — ${dateLabel}`,
    subtitle: `${dateLabel} · 전일 07:00 ~ 당일 07:00`,
    headerBg: "#534AB7",
    headerLabel: "LUNA",
    bodyHtml: body,
    cta: { href: hubHref("/settings"), label: "LUNA 관리자 열기" }
  });

  const textPreview = [
    `[LUNA] 아침 리포트 — ${dateLabel}`,
    "",
    stripHtml(body)
  ].join("\n");

  return {
    subject: `[LUNA] 아침 리포트 — ${dateLabel}`,
    html,
    quiet,
    textPreview
  };
}

export async function sendAdminMorningReport(
  admin: SupabaseClient,
  now = new Date()
): Promise<AdminReportResult> {
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const recipients = getAdminReportRecipients();
  if (!resendKey || !fromEmail) {
    return { ok: false, error: "RESEND_API_KEY or RESEND_FROM_EMAIL missing" };
  }
  if (recipients.length === 0) {
    return { ok: false, error: "LUNA_ADMIN_REPORT_TO is not configured" };
  }
  const toLabel = recipients.join(", ");

  const { data: superRow } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "슈퍼관리자")
    .limit(1)
    .maybeSingle();
  const userId = typeof superRow?.id === "string" ? superRow.id : "";

  const { subject, html, textPreview } = await buildAdminReportHtml(admin, userId, now);
  const resend = new Resend(resendKey);
  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: recipients,
    subject,
    html,
    text: textPreview
  });
  if (error) {
    return {
      ok: false,
      error: error.message,
      to: toLabel,
      subject,
      textPreview
    };
  }
  return {
    ok: true,
    to: toLabel,
    subject,
    messageId: data?.id,
    textPreview
  };
}
