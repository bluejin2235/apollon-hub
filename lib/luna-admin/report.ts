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
import { lightEmoji } from "@/lib/luna-admin/traffic";
import {
  ADMIN_REPORT_TO,
  HUB_PUBLIC_ORIGIN
} from "@/lib/luna-admin/schedule";
import { buildLunaAdminUrl } from "@/lib/luna-admin/nav";

export type AdminReportResult = {
  ok: boolean;
  skipped?: boolean;
  to?: string;
  subject?: string;
  messageId?: string;
  error?: string;
};

function hubHref(path: string): string {
  return `${HUB_PUBLIC_ORIGIN}${path}`;
}

function btn(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin-left:8px;padding:4px 10px;border:1px solid #d7d4ef;border-radius:8px;font-size:11px;color:#3C3489;text-decoration:none;font-weight:600;">${escapeHtml(label)}</a>`;
}

function section(light: string, title: string, body: string, href: string, label: string): string {
  return `<div style="padding:12px 0;border-bottom:1px solid #f1ebe8;">
    <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1c1d21;">${light} ${escapeHtml(title)} ${btn(href, label)}</p>
    <p style="margin:0;font-size:13px;color:#5A5353;line-height:1.7;">${body}</p>
  </div>`;
}

export async function buildAdminReportHtml(
  admin: SupabaseClient,
  userId: string,
  now = new Date()
): Promise<{ subject: string; html: string; quiet: boolean }> {
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
    openFailures
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
    countOpenFailures(admin)
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

  const uids = [...new Set((talkUsers.data ?? []).map((r) => r.user_id).filter(Boolean))] as string[];
  let userLine = `${uids.length}명`;
  if (uids.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, name").in("id", uids);
    const names = (profiles ?? [])
      .map((p) => (typeof p.name === "string" ? p.name : ""))
      .filter(Boolean);
    if (names.length) userLine = `${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""} · ${uids.length}명`;
  }

  const linkSamples = await listLinks(admin);
  const newLinkLines = linkSamples
    .filter((l) => l.created_at >= startIso)
    .slice(0, 5)
    .map((l) => escapeHtml(`${l.kind} · ${l.from_id} → ${l.to_id}`));

  const errors = redIndex.length
    ? redIndex.map((x) => escapeHtml(String(x))).join("<br>")
    : "표시할 오류가 없습니다.";

  const goods: string[] = [];
  if (collectStage?.light === "green") goods.push("1차 색인이 정상입니다.");
  if ((selfstudy.last_run?.submitted ?? 0) > 0) {
    goods.push(`자습 ${selfstudy.last_run?.submitted}건 제출`);
  }
  if (newLinks > 0) goods.push(`2차 데이터 ${newLinks}건 증가`);
  const goodLine = goods.length ? goods.map(escapeHtml).join("<br>") : "큰 변화는 없습니다.";

  const askLines =
    questions.length > 0
      ? questions
          .slice(0, 5)
          .map((q) => escapeHtml(q.question.length > 90 ? `${q.question.slice(0, 90)}…` : q.question))
          .join("<br>")
      : "지금 답할 질문은 없습니다.";

  const fixItems = tonight.items.filter((i) => !i.excluded);
  const fixLine =
    fixItems.length > 0
      ? fixItems.map((i) => escapeHtml(`${i.title} — ${i.why}`)).join("<br>")
      : openFailures > 0
        ? `열린 실패 ${openFailures}건`
        : "지금 손볼 일은 없습니다.";

  const quiet =
    userMsgs.length === 0 &&
    newLinks === 0 &&
    questions.length === 0 &&
    redIndex.length === 0 &&
    fixItems.length === 0;

  const body = [
    section(
      lightEmoji(collectStage?.light ?? "yellow"),
      "① 1차 데이터 색인 현황",
      `Work ${escapeHtml(primary.work.last_label)} · 노션 ${escapeHtml(primary.notion.last_label)} · 이미지 ${escapeHtml(primary.image.last_label)}`,
      hubHref(buildLunaAdminUrl("knowledge", "primary")),
      "지식"
    ),
    section(
      "💬",
      "② 대화",
      talkSummary,
      hubHref(buildLunaAdminUrl("talk", "history")),
      "대화"
    ),
    section(
      "👤",
      "③ 사용자",
      escapeHtml(userLine),
      hubHref(buildLunaAdminUrl("talk", "history")),
      "대화"
    ),
    section(
      newLinks > 0 ? "🟢" : "🟡",
      "④ 2차 데이터",
      newLinkLines.length ? newLinkLines.join("<br>") : `새 연결 ${newLinks}건${latestLink ? ` · 마지막 ${escapeHtml(latestLink)}` : ""}`,
      hubHref(buildLunaAdminUrl("knowledge", "secondary")),
      "2차"
    ),
    section(
      redIndex.length ? "🔴" : "🟢",
      "⑤ 오류",
      errors,
      hubHref(buildLunaAdminUrl("dashboard")),
      "대시보드"
    ),
    section("🟢", "⑥ 잘 되고 있는 것", goodLine, hubHref(buildLunaAdminUrl("dashboard")), "대시보드"),
    section(
      questions.length ? "🟡" : "🟢",
      "⑦ 내가 답해야 할 것",
      askLines,
      hubHref(buildLunaAdminUrl("candidates", "mine")),
      "지식후보"
    ),
    section(
      fixItems.length ? "🟡" : "🟢",
      "⑧ 내가 해결해야 할 것",
      fixLine,
      hubHref(buildLunaAdminUrl("selfstudy", "tonight")),
      "자습"
    )
  ].join("");

  const html = buildHubEmailShell({
    title: quiet ? "지난 24시간, 큰 변화는 없습니다." : `LUNA 아침 리포트 — ${dateLabel}`,
    subtitle: `${dateLabel} · 전일 07:00 ~ 당일 07:00`,
    headerBg: "#534AB7",
    headerLabel: "LUNA",
    bodyHtml: body,
    cta: { href: hubHref("/settings"), label: "LUNA 관리자 열기" }
  });

  return {
    subject: `[LUNA] 아침 리포트 — ${dateLabel}`,
    html,
    quiet
  };
}

export async function sendAdminMorningReport(
  admin: SupabaseClient,
  now = new Date()
): Promise<AdminReportResult> {
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!resendKey || !fromEmail) {
    return { ok: false, error: "RESEND_API_KEY or RESEND_FROM_EMAIL missing" };
  }

  const { data: superRow } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "슈퍼관리자")
    .limit(1)
    .maybeSingle();
  const userId = typeof superRow?.id === "string" ? superRow.id : "";

  const { subject, html } = await buildAdminReportHtml(admin, userId, now);
  const resend = new Resend(resendKey);
  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: [ADMIN_REPORT_TO],
    subject,
    html
  });
  if (error) {
    return { ok: false, error: error.message, to: ADMIN_REPORT_TO, subject };
  }
  return {
    ok: true,
    to: ADMIN_REPORT_TO,
    subject,
    messageId: data?.id
  };
}
