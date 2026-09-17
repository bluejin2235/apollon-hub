import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  escapeHtml,
  KST_OFFSET_MS,
  toKstDateString
} from "@/lib/mail/hub-email";
import { countOpenFailures } from "@/lib/luna/failures";
import { buildPrimarySources } from "@/lib/luna-admin/primary";
import { buildAdminDashboard } from "@/lib/luna-admin/dashboard";
import { countLinks } from "@/lib/luna-admin/links";
import { listQuestions } from "@/lib/luna-admin/questions";
import { loadTonightState } from "@/lib/luna-admin/tonight";
import { lightEmoji, type TrafficLight } from "@/lib/luna-admin/traffic";
import {
  getAdminReportRecipients,
  HUB_PUBLIC_ORIGIN,
  ADMIN_SELFSTUDY_HOUR,
  ADMIN_SELFSTUDY_MINUTE
} from "@/lib/luna-admin/schedule";
import { buildLunaAdminUrl } from "@/lib/luna-admin/nav";
import { listCandidateRuleQuestions } from "@/lib/luna/rules";
import { listPendingAnswerFlagsForHuman } from "@/lib/luna/answer-flags";
import { ANSWER_FLAG_THRESHOLDS } from "@/lib/luna/answer-flags-shared";
import {
  evaluateLunaChecks,
  markAdminReportSent,
  type LunaCheckResult
} from "@/lib/luna/checks";
import {
  buildStudyMorningReport,
  collectStudyRuns
} from "@/lib/luna/study-report";
import {
  buildCheckPrompt,
  buildStudyBlockedPrompt,
  loadOpenDevnoteBlockers,
  PROMPT_ROOM_LABEL,
  type TodoPrompt
} from "@/lib/luna-admin/report-prompts";
import { iGa, withObjectParticle } from "@/lib/korean/particles";

export type AdminReportResult = {
  ok: boolean;
  skipped?: boolean;
  to?: string;
  subject?: string;
  messageId?: string;
  error?: string;
  textPreview?: string;
};

const C = {
  ink: "#1b1c20",
  sub: "#666a71",
  faint: "#9298a0",
  line: "#e4e6ea",
  line2: "#f0f1f4",
  luna: "#534AB7",
  lunaSoft: "#EFEEFE",
  lunaInk: "#3B3388",
  g: "#0E6B53",
  gBg: "#E5F4EE",
  gLine: "#BEE0D3",
  y: "#A8722A",
  yBg: "#FBF2E2",
  yLine: "#EFDCB8",
  r: "#B03A34",
  rBg: "#FBEAE9",
  rLine: "#F0C9C6",
  codeBg: "#F7F7F9",
  codeBar: "#EFEFF2"
};

function hubHref(path: string): string {
  return `${HUB_PUBLIC_ORIGIN}${path}`;
}

function kstWeekdayLabel(utcMs: number): string {
  const names = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  const kst = new Date(utcMs + KST_OFFSET_MS);
  return names[kst.getUTCDay()] ?? "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<\/th>/gi, " ")
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

async function countCreatedBefore(
  admin: SupabaseClient,
  table: string,
  beforeIso: string,
  column = "created_at"
): Promise<number | null> {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .lt(column, beforeIso);
  if (error) {
    console.error(`[luna-admin/report] before ${table}`, error);
    return null;
  }
  return count ?? 0;
}

async function countAll(admin: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true });
  if (error) {
    console.error(`[luna-admin/report] count ${table}`, error);
    return 0;
  }
  return count ?? 0;
}

type GrowthRow = {
  label: string;
  yesterday: number;
  today: number;
  /** 미해결 실패처럼 줄면 좋은 지표 */
  lowerIsBetter?: boolean;
};

function deltaHtml(row: GrowthRow): string {
  const d = row.today - row.yesterday;
  if (d === 0) return "—";
  const good = row.lowerIsBetter ? d < 0 : d > 0;
  const sign = d > 0 ? `+${d}` : `${d}`;
  const color = good ? C.g : C.r;
  return `<span style="color:${color};font-weight:700;">${sign}</span>`;
}

function deltaText(row: GrowthRow): string {
  const d = row.today - row.yesterday;
  if (d === 0) return "—";
  return d > 0 ? `+${d}` : `${d}`;
}

function stageBox(
  light: TrafficLight,
  label: string,
  title: string,
  detailLines: string[]
): string {
  const bg = light === "green" ? C.gBg : light === "yellow" ? C.yBg : C.rBg;
  const color = light === "green" ? C.g : light === "yellow" ? C.y : C.r;
  const emoji = lightEmoji(light);
  return `<td style="width:25%;border:1px solid ${C.line};padding:11px 12px;background:${bg};vertical-align:top;">
    <div style="font-size:9.5px;font-weight:800;letter-spacing:.4px;color:${color};margin-bottom:4px;">${emoji} ${escapeHtml(label)}</div>
    <div style="font-size:15px;font-weight:800;letter-spacing:-.4px;margin-bottom:2px;color:${C.ink};">${escapeHtml(title)}</div>
    <div style="font-size:10px;color:${C.faint};line-height:1.6;">${detailLines.map(escapeHtml).join("<br>")}</div>
  </td>`;
}

function outlineBtn(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;font-size:10.5px;padding:4px 11px;border-radius:7px;text-decoration:none;white-space:nowrap;border:1px solid ${C.line};color:#3a3d43;background:#fff;font-weight:600;">${escapeHtml(label)}</a>`;
}

function buildTldr(
  badChecks: LunaCheckResult[],
  stages: { key: string; light: TrafficLight; label: string }[]
): { ok: boolean; title: string; detail: string } {
  if (badChecks.length === 0) {
    return {
      ok: true,
      title: "약속한 작업이 정상으로 돌았습니다",
      detail: "바퀴도 돌아 가고 있습니다. 오늘은 급히 손볼 약속 어긋남이 없습니다."
    };
  }
  const top = badChecks.slice(0, 2);
  const names = top
    .map((c) => {
      if (c.id === "response_time") {
        return `${c.label}이 느림`;
      }
      if (c.id === "disk") {
        return `${c.label}이 임계치 초과`;
      }
      const days = c.days_stale != null ? `${c.days_stale}일째` : "";
      return days
        ? `${c.label}${iGa(c.label)} ${days} 멈췄`
        : `${c.label}${iGa(c.label)} 멈췄`;
    })
    .join("고, ");
  const blocked = stages.find((s) => s.light === "red");
  const wheel =
    blocked != null
      ? `바퀴는 돌았지만 「${blocked.label}」 단계가 막혀 있습니다.`
      : "바퀴는 돌았지만 약속과 다른 작업이 있습니다.";
  const detailLead = top.some(
    (c) => c.id === "response_time" || c.id === "disk"
  )
    ? `${names}.`
    : `${names}습니다.`;
  return {
    ok: false,
    title: `약속과 다르게 도는 것이 ${badChecks.length}건 있습니다`,
    detail: `${detailLead}\n${wheel}`
  };
}

/**
 * prompt 가 있으면 Claude 가 맡을 수 있는 일 — 붙여넣을 문구를 싣는다.
 * 없으면 사람이 화면에서 눌러야 하는 일 — href 링크만 남긴다.
 */
type TodoItem = {
  title: string;
  detail: string;
  href: string;
  btn: string;
  tone: "r" | "y" | "p";
  prompt?: TodoPrompt;
};

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
  const weekday = kstWeekdayLabel(now.getTime());

  const [
    checks,
    primary,
    dash,
    studyRuns,
    questions,
    tonight,
    openFailures,
    ruleQuestions,
    answerFlags,
    linksToday,
    linksYesterday,
    learningsTodayRes,
    learningsYesterdayRes,
    glossaryToday,
    glossaryYesterday,
    lensToday,
    lensYesterday,
    failuresOpenedRes,
    failuresOpenYesterdayRes,
    notionBeforeRes,
    imageBeforeRes,
    devnoteBlockers
  ] = await Promise.all([
    evaluateLunaChecks(admin, now),
    buildPrimarySources(admin),
    buildAdminDashboard(admin, userId),
    collectStudyRuns(admin, startIso, endIso),
    listQuestions(admin, { status: "pending" }),
    loadTonightState(admin),
    countOpenFailures(admin),
    listCandidateRuleQuestions(admin),
    listPendingAnswerFlagsForHuman(admin, {
      sinceIso: startIso,
      limit: Math.min(12, ANSWER_FLAG_THRESHOLDS.max_human_per_day)
    }),
    countLinks(admin),
    countCreatedBefore(admin, "luna_links", startIso),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .lt("created_at", startIso),
    countAll(admin, "glossary_terms"),
    countCreatedBefore(admin, "glossary_terms", startIso),
    countAll(admin, "luna_perspectives"),
    countCreatedBefore(admin, "luna_perspectives", startIso),
    admin
      .from("luna_failures")
      .select("id", { count: "exact", head: true })
      .is("verdict", null)
      .gte("created_at", startIso),
    admin
      .from("luna_failures")
      .select("id", { count: "exact", head: true })
      .is("verdict", null)
      .lt("created_at", startIso),
    admin
      .from("luna_notion_pages")
      .select("page_id", { count: "exact", head: true })
      .lt("indexed_at", startIso),
    admin
      .from("luna_media_index")
      .select("path", { count: "exact", head: true })
      .lt("indexed_at", startIso),
    loadOpenDevnoteBlockers(admin)
  ]);

  const learningsToday = learningsTodayRes.count ?? 0;
  const learningsYesterday = learningsYesterdayRes.count ?? 0;
  void failuresOpenedRes;
  const failuresYesterday = failuresOpenYesterdayRes.count ?? openFailures;
  const notionBefore = notionBeforeRes.count ?? primary.notion.count;
  const imageBefore = imageBeforeRes.count ?? primary.image.count;
  // 1차 = 노션·이미지·위키·용어 (Work 경로 10만 건은 증감표를 삼킴 — 제외)
  const primaryToday =
    primary.notion.count +
    primary.image.count +
    primary.wiki.count +
    primary.glossary.count;
  // 어제 카운트 조회 실패(타임아웃)면 오늘 값으로 맞춰 가짜 +N만 원을 만들지 않는다
  const glossY = glossaryYesterday ?? glossaryToday;
  const linksY = linksYesterday ?? linksToday;
  const lensY = lensYesterday ?? lensToday;
  const primaryYesterday =
    notionBefore + imageBefore + primary.wiki.count + glossY;

  const growth: GrowthRow[] = [
    { label: "1차 데이터", yesterday: primaryYesterday, today: primaryToday },
    { label: "2차 데이터", yesterday: linksY, today: linksToday },
    {
      label: "아폴론 지식",
      yesterday: learningsYesterday,
      today: learningsToday
    },
    { label: "용어사전", yesterday: glossY, today: glossaryToday },
    { label: "관점", yesterday: lensY, today: lensToday },
    {
      label: "미해결 실패",
      yesterday: failuresYesterday,
      today: openFailures,
      lowerIsBetter: true
    }
  ];

  const badChecks = checks.filter((c) => c.status === "bad" || c.status === "warn");
  const okChecks = checks.filter((c) => c.status === "ok");
  const tldr = buildTldr(
    badChecks,
    dash.stages.map((s) => ({ key: s.key, light: s.light, label: s.label }))
  );

  const study = buildStudyMorningReport(studyRuns);

  const todos: TodoItem[] = [];
  for (const c of badChecks) {
    const staleLine =
      c.id === "response_time" || c.id === "disk"
        ? c.detail ?? c.meaning_when_stale
        : c.days_stale != null
          ? `${c.days_stale}일째 멈춰 있습니다. ${c.meaning_when_stale}`
          : c.meaning_when_stale;
    todos.push({
      title: withObjectParticle(c.label, " 고쳐 주세요"),
      detail: staleLine,
      href: hubHref(c.href),
      btn: c.btn_label,
      tone: c.status === "bad" ? "r" : "y",
      prompt: buildCheckPrompt(c, devnoteBlockers)
    });
  }
  for (const card of study.cards) {
    if (card.blocked) {
      todos.push({
        title: "자습에서 사람이 확인할 일이 있습니다",
        detail: card.blocked,
        href: hubHref(buildLunaAdminUrl("selfstudy", "history")),
        btn: "자세히",
        tone: "p",
        prompt: buildStudyBlockedPrompt(card, devnoteBlockers)
      });
    }
  }
  if (ruleQuestions.length > 0) {
    const n = ruleQuestions.length;
    todos.push({
      title: `규칙 ${n}건을 확인해 주세요`,
      detail: ruleQuestions[0]
        ? `${ruleQuestions[0].title} — 정하시면 관련 신호가 정리됩니다.`
        : "규칙 후보가 대기 중입니다.",
      href: hubHref(buildLunaAdminUrl("dashboard")),
      btn: "확인 →",
      tone: "y"
    });
  }
  if (answerFlags.length > 0) {
    const n = answerFlags.length;
    const first = answerFlags[0]!;
    const flagLabels = first.flags.map((f) => f.label).join(" · ");
    const m = first.metrics;
    todos.push({
      title: `🌙 답을 봐주세요 · ${n}건`,
      detail:
        `어젯밤 지표가 어긋난 답입니다. 옳고 그름은 제가 판단할 수 없어 여쭙습니다. ` +
        `예: “${first.question.slice(0, 40)}” · 문서 ${m.total_docs ?? "—"} · 자신감 ${m.confidence_score ?? "—"} · ` +
        `${flagLabels || "모순"}`,
      href: hubHref(buildLunaAdminUrl("selfstudy", "review")),
      btn: "답 점검 →",
      tone: "p"
    });
  }
  for (const q of questions.slice(0, 3)) {
    todos.push({
      title: "루나 질문에 답해 주세요",
      detail: q.question.length > 90 ? `${q.question.slice(0, 90)}…` : q.question,
      href: hubHref(buildLunaAdminUrl("candidates", "mine")),
      btn: "답하기 →",
      tone: "y"
    });
  }

  const tonightItems = tonight.items.filter((i) => !i.excluded && i.when === "tonight");
  const tonightMinutes = tonightItems.reduce((s, i) => s + (i.minutes || 0), 0);
  const hh = String(ADMIN_SELFSTUDY_HOUR).padStart(2, "0");
  const mm = String(ADMIN_SELFSTUDY_MINUTE).padStart(2, "0");

  const collectStage = dash.stages.find((s) => s.key === "collect");
  const learnStage = dash.stages.find((s) => s.key === "learn");
  const confirmStage = dash.stages.find((s) => s.key === "confirm");
  const applyStage = dash.stages.find((s) => s.key === "apply");

  const notionDelta = primary.notion.count - notionBefore;
  const imageDelta = primary.image.count - imageBefore;

  // —— HTML ——
  const checkRowsHtml = badChecks
    .map((c) => {
      const nmColor = c.status === "bad" ? C.r : C.y;
      const lamp = c.status === "bad" ? "🔴" : "🟡";
      const meaning = escapeHtml(c.meaning_when_stale);
      const ds = escapeHtml(c.detail ?? "");
      return `<tr>
        <td style="padding:9px 0;border-bottom:1px solid ${C.line2};vertical-align:top;width:22px;font-size:11px;">${lamp}</td>
        <td style="padding:9px 8px;border-bottom:1px solid ${C.line2};vertical-align:top;">
          <div style="font-weight:700;color:${nmColor};margin-bottom:2px;font-size:12.5px;">${escapeHtml(c.label)}</div>
          <div style="font-size:11.5px;color:${C.sub};line-height:1.7;">${ds}<br>${meaning}</div>
        </td>
        <td style="padding:9px 0;border-bottom:1px solid ${C.line2};vertical-align:top;text-align:right;white-space:nowrap;">${outlineBtn(hubHref(c.href), c.btn_label)}</td>
      </tr>`;
    })
    .join("");

  const okLine =
    okChecks.length > 0
      ? `<div style="font-size:12px;color:${C.g};background:${C.gBg};border-radius:9px;padding:10px 14px;margin-top:9px;border:1px solid ${C.gLine};">✅ 나머지 ${okChecks.length}개는 약속대로 돌았습니다 — ${escapeHtml(okChecks.map((c) => c.label).join(" · "))}</div>`
      : "";

  const growthRows = growth
    .map(
      (r) => `<tr>
      <td style="padding:8px 9px;border-bottom:1px solid ${C.line2};">${escapeHtml(r.label)}</td>
      <td style="padding:8px 9px;border-bottom:1px solid ${C.line2};text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;">${r.yesterday.toLocaleString("ko-KR")}</td>
      <td style="padding:8px 9px;border-bottom:1px solid ${C.line2};text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;">${r.today.toLocaleString("ko-KR")}</td>
      <td style="padding:8px 9px;border-bottom:1px solid ${C.line2};text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;">${deltaHtml(r)}</td>
    </tr>`
    )
    .join("");

  const studyCardsHtml =
    study.cards.length === 0
      ? `<div style="font-size:12.5px;color:${C.sub};">어젯밤 자율 자습 실행이 없습니다.</div>`
      : study.cards
          .map((card, idx) => {
            const badgeBg =
              card.outcome === "improved"
                ? C.gBg
                : card.outcome === "failed"
                  ? C.rBg
                  : "#f0f1f4";
            const badgeColor =
              card.outcome === "improved"
                ? C.g
                : card.outcome === "failed"
                  ? C.r
                  : C.faint;
            const kvs = [
              ["왜", card.why],
              ["한 것", card.did],
              ["결과", card.result],
              ...(card.learned ? [["알아낸 것", card.learned] as const] : []),
              ...(card.next ? [["다음", card.next] as const] : []),
              ...(card.blocked ? [["막힌 것", card.blocked] as const] : [])
            ];
            return `<div style="border:1px solid ${C.line};border-radius:11px;padding:14px 16px;margin-bottom:9px;">
              <table style="width:100%;border-collapse:collapse;margin-bottom:9px;"><tr>
                <td style="width:19px;vertical-align:top;">
                  <div style="width:19px;height:19px;border-radius:50%;background:${C.luna};color:#fff;font-size:10.5px;font-weight:800;line-height:19px;text-align:center;">${idx + 1}</div>
                </td>
                <td style="padding-left:8px;font-size:13px;font-weight:800;vertical-align:middle;">${escapeHtml(card.agenda)}</td>
                <td style="text-align:right;vertical-align:middle;"><span style="font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:6px;background:${badgeBg};color:${badgeColor};">${escapeHtml(card.outcomeLabel)}</span></td>
              </tr></table>
              ${kvs
                .map(
                  ([k, v]) => `<table style="width:100%;border-collapse:collapse;margin-bottom:3px;"><tr>
                  <td style="width:52px;font-size:11.5px;color:${C.faint};font-weight:700;vertical-align:top;line-height:1.85;">${escapeHtml(k)}</td>
                  <td style="font-size:11.5px;color:#2b2d32;line-height:1.85;">${escapeHtml(v)}</td>
                </tr></table>`
                )
                .join("")}
            </div>`;
          })
          .join("");

  const studyMeta =
    study.cards.length > 0
      ? `<div style="font-size:11px;color:${C.faint};margin-top:9px;">LLM ${study.totalCalls}회 · $${study.totalCost.toFixed(3)}${study.durationLabel ? ` · ${study.durationLabel}` : ""}</div>`
      : "";

  const indexCardsHtml =
    study.indexCards.length === 0
      ? ""
      : `<div style="margin-top:14px;padding-top:12px;border-top:1px solid ${C.line2};">
        <div style="font-size:12px;font-weight:800;color:${C.sub};margin-bottom:8px;">색인</div>
        ${study.indexCards
          .map(
            (card) => `<div style="font-size:11.5px;color:#2b2d32;line-height:1.85;margin-bottom:6px;">
            · ${escapeHtml(card.did)} — ${escapeHtml(card.result)}
          </div>`
          )
          .join("")}
      </div>`;

  const todoHtml =
    todos.length === 0
      ? `<div style="font-size:12.5px;color:${C.sub};">지금 사람이 손댈 일은 없습니다.</div>`
      : todos
          .map((t, i) => {
            const icBg =
              t.tone === "r" ? C.rBg : t.tone === "y" ? C.yBg : C.lunaSoft;
            const icColor =
              t.tone === "r" ? C.r : t.tone === "y" ? C.y : C.luna;
            const head = `<table style="width:100%;border-collapse:collapse;"><tr>
              <td style="vertical-align:top;width:33px;">
                <div style="width:22px;height:22px;border-radius:7px;background:${icBg};color:${icColor};font-size:11px;line-height:22px;text-align:center;font-weight:800;">${i + 1}</div>
              </td>
              <td style="vertical-align:top;">
                <div style="font-size:12.5px;font-weight:700;margin-bottom:3px;">${escapeHtml(t.title)}</div>
                <div style="font-size:11.5px;color:${C.sub};line-height:1.75;">${escapeHtml(t.detail)}</div>
              </td>
            </tr></table>`;
            // 메일에서는 JavaScript 가 돌지 않는다 — 복사 버튼 대신 한 번에 집히는 pre 블록
            const action = t.prompt
              ? `<table style="width:100%;border-collapse:collapse;margin-top:10px;"><tr>
              <td style="width:33px;"></td>
              <td>
                <div style="background:${C.codeBg};border:1px solid ${C.line};border-radius:9px;">
                  <div style="padding:7px 11px;background:${C.codeBar};border-bottom:1px solid ${C.line};font-size:10.5px;font-weight:700;color:${C.sub};">Claude 에 붙여넣기 · 길게 눌러 전체 선택</div>
                  <pre style="margin:0;padding:11px 13px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.8;color:#2b2d32;white-space:pre-wrap;word-break:break-word;-webkit-user-select:all;user-select:all;">${escapeHtml(t.prompt.text)}</pre>
                </div>
                <div style="margin-top:7px;font-size:11px;color:${C.faint};"><b style="color:${C.sub};font-weight:700;">${escapeHtml(PROMPT_ROOM_LABEL[t.prompt.room])}</b> 방에 붙여넣으세요</div>
              </td>
            </tr></table>`
              : `<table style="width:100%;border-collapse:collapse;margin-top:7px;"><tr>
              <td style="width:33px;"></td>
              <td style="font-size:11px;color:${C.faint};">화면에서 버튼을 눌러야 합니다 — <a href="${escapeHtml(t.href)}" style="color:${C.luna};font-weight:700;text-decoration:none;">${escapeHtml(t.btn)}</a></td>
            </tr></table>`;
            return `<div style="padding:14px 0;border-bottom:1px solid ${C.line2};">${head}${action}</div>`;
          })
          .join("");

  const tonightHtml =
    tonightItems.length === 0
      ? `<div style="font-size:12px;color:${C.lunaInk};">아직 오늘 밤 아젠다를 고르지 않았습니다.</div>`
      : `<div style="font-size:12.5px;font-weight:800;color:${C.lunaInk};margin-bottom:8px;">${hh}:${mm} · 예상 ${tonightMinutes || "—"}분</div>
        ${tonightItems
          .map(
            (it) =>
              `<div style="font-size:11.5px;color:${C.lunaInk};line-height:1.9;padding-left:14px;">· ${escapeHtml(it.title)}${it.why ? ` — ${escapeHtml(it.why)}` : ""}</div>`
          )
          .join("")}`;

  const tldrBg = tldr.ok ? C.gBg : C.rBg;
  const tldrLine = tldr.ok ? C.gLine : C.rLine;
  const tldrColor = tldr.ok ? C.g : C.r;

  const body = `
  <div style="padding:22px 26px 18px;border-bottom:1px solid ${C.line};">
    <table style="border-collapse:collapse;margin-bottom:13px;"><tr>
      <td style="width:24px;height:24px;border-radius:50%;background:${C.luna};color:#fff;font-size:12px;font-weight:800;text-align:center;line-height:24px;">L</td>
      <td style="padding-left:9px;font-size:12px;font-weight:800;letter-spacing:.3px;">LUNA</td>
    </tr></table>
    <div style="font-size:19px;font-weight:800;letter-spacing:-.4px;margin-bottom:4px;">아침 리포트</div>
    <div style="font-size:11.5px;color:${C.faint};">${escapeHtml(dateLabel)} ${escapeHtml(weekday)} · 어제 07:00 ~ 오늘 07:00</div>
  </div>

  <div style="padding:15px 26px;background:${tldrBg};border-bottom:1px solid ${tldrLine};">
    <div style="font-size:13px;font-weight:800;color:${tldrColor};margin-bottom:5px;">${escapeHtml(tldr.title)}</div>
    <div style="font-size:12px;color:${tldrColor};line-height:1.8;white-space:pre-wrap;">${escapeHtml(tldr.detail)}</div>
  </div>

  <div style="padding:20px 26px;border-bottom:1px solid ${C.line2};">
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;"><tr>
      <td style="font-size:14px;font-weight:800;">약속 점검</td>
      <td style="font-size:11px;color:${C.faint};padding-left:8px;">${checks.length}개 중 ${badChecks.length}개 이상</td>
      <td style="text-align:right;"><a href="${escapeHtml(hubHref("/settings?menu=dashboard"))}" style="font-size:11px;color:${C.luna};font-weight:700;text-decoration:none;">전체 보기 →</a></td>
    </tr></table>
    ${badChecks.length ? `<table style="width:100%;border-collapse:collapse;">${checkRowsHtml}</table>` : `<div style="font-size:12.5px;color:${C.g};">어긋난 약속이 없습니다.</div>`}
    ${okLine}
  </div>

  <div style="padding:20px 26px;border-bottom:1px solid ${C.line2};">
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;"><tr>
      <td style="font-size:14px;font-weight:800;">바퀴가 돌았나</td>
      <td style="text-align:right;"><a href="${escapeHtml(hubHref("/settings?menu=dashboard"))}" style="font-size:11px;color:${C.luna};font-weight:700;text-decoration:none;">대시보드 →</a></td>
    </tr></table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;"><tr>
      ${stageBox(
        collectStage?.light ?? "yellow",
        "수집",
        collectStage?.title ?? "—",
        [
          `노션 ${notionDelta >= 0 ? `+${notionDelta}` : notionDelta}p`,
          `이미지 ${imageDelta >= 0 ? `+${imageDelta}` : imageDelta}`
        ]
      )}
      ${stageBox(
        learnStage?.light ?? "yellow",
        "학습",
        learnStage?.title ?? "—",
        [
          `자습 ${study.cards.length}건`,
          study.cards.length ? study.cards[0]!.result.slice(0, 24) : "실행 없음"
        ]
      )}
      ${stageBox(
        confirmStage?.light ?? "yellow",
        "확정",
        confirmStage?.title ?? "—",
        (confirmStage?.detail ?? "").split("\n").slice(0, 2)
      )}
      ${stageBox(
        applyStage?.light ?? "yellow",
        "적용",
        applyStage?.title ?? "—",
        (applyStage?.detail ?? "").split("\n").slice(0, 2)
      )}
    </tr></table>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <tr>
        <th style="text-align:left;padding:7px 9px;background:#FAFAFB;color:${C.faint};font-weight:700;font-size:10.5px;border-bottom:1px solid ${C.line};">무엇</th>
        <th style="text-align:right;padding:7px 9px;background:#FAFAFB;color:${C.faint};font-weight:700;font-size:10.5px;border-bottom:1px solid ${C.line};">어제</th>
        <th style="text-align:right;padding:7px 9px;background:#FAFAFB;color:${C.faint};font-weight:700;font-size:10.5px;border-bottom:1px solid ${C.line};">오늘</th>
        <th style="text-align:right;padding:7px 9px;background:#FAFAFB;color:${C.faint};font-weight:700;font-size:10.5px;border-bottom:1px solid ${C.line};">변화</th>
      </tr>
      ${growthRows}
    </table>
  </div>

  <div style="padding:20px 26px;border-bottom:1px solid ${C.line2};">
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;"><tr>
      <td style="font-size:14px;font-weight:800;">🌙 어젯밤 루나가 한 일</td>
      <td style="font-size:11px;color:${C.faint};padding-left:8px;">${study.rangeLabel ? escapeHtml(study.rangeLabel) : ""}</td>
      <td style="text-align:right;"><a href="${escapeHtml(hubHref(buildLunaAdminUrl("selfstudy", "history")))}" style="font-size:11px;color:${C.luna};font-weight:700;text-decoration:none;">자습 이력 →</a></td>
    </tr></table>
    ${studyCardsHtml}
    ${indexCardsHtml}
    ${studyMeta}
  </div>

  <div style="padding:20px 26px;border-bottom:1px solid ${C.line2};">
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;"><tr>
      <td style="font-size:14px;font-weight:800;">내가 해야 할 것</td>
      <td style="font-size:11px;color:${C.faint};padding-left:8px;">${todos.length}건</td>
    </tr></table>
    ${todoHtml}
  </div>

  <div style="padding:20px 26px;border-bottom:1px solid ${C.line2};">
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;"><tr>
      <td style="font-size:14px;font-weight:800;">오늘 밤 하려는 것</td>
      <td style="text-align:right;"><a href="${escapeHtml(hubHref(buildLunaAdminUrl("selfstudy", "tonight")))}" style="font-size:11px;color:${C.luna};font-weight:700;text-decoration:none;">바꾸기 →</a></td>
    </tr></table>
    <div style="background:${C.lunaSoft};border-radius:11px;padding:14px 16px;">${tonightHtml}</div>
  </div>

  <div style="padding:16px 26px;background:#FAFAFB;border-top:1px solid ${C.line};font-size:10.5px;color:${C.faint};line-height:1.8;">
    이 메일은 매일 아침 7시에 갑니다. 아무 일이 없어도 한 줄로 보냅니다.<br>
    받는 사람을 바꾸려면 환경변수 LUNA_ADMIN_REPORT_TO 를 조정하세요.
  </div>`;

  const html = `<div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;max-width:660px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${C.line};color:${C.ink};font-size:13.5px;line-height:1.6;-webkit-font-smoothing:antialiased;">
  ${body}
</div>`;

  // text
  const textParts: string[] = [
    `[LUNA] 아침 리포트 — ${dateLabel}`,
    "",
    tldr.title,
    tldr.detail,
    "",
    `■ 약속 점검 (${checks.length}개 중 ${badChecks.length}개 이상)`
  ];
  for (const c of badChecks) {
    textParts.push(
      `${c.status === "bad" ? "🔴" : "🟡"} ${c.label}`,
      `  ${c.detail ?? ""}`,
      `  ${c.meaning_when_stale}`,
      `  ${c.btn_label} ${hubHref(c.href)}`
    );
  }
  if (okChecks.length) {
    textParts.push(
      `✅ 나머지 ${okChecks.length}개는 약속대로 돌았습니다 — ${okChecks.map((c) => c.label).join(" · ")}`
    );
  }
  textParts.push("", "■ 바퀴가 돌았나");
  for (const s of dash.stages) {
    textParts.push(`${lightEmoji(s.light)} ${s.label} — ${s.title}`);
  }
  textParts.push("무엇 / 어제 / 오늘 / 변화");
  for (const r of growth) {
    textParts.push(
      `${r.label}  ${r.yesterday}  ${r.today}  ${deltaText(r)}`
    );
  }
  textParts.push("", "■ 어젯밤 루나가 한 일");
  if (study.cards.length === 0) {
    textParts.push("어젯밤 자율 자습 실행이 없습니다.");
  } else {
    study.cards.forEach((card, i) => {
      textParts.push(
        `${i + 1}. ${card.agenda} [${card.outcomeLabel}]`,
        `  왜 — ${card.why}`,
        `  한 것 — ${card.did}`,
        `  결과 — ${card.result}`
      );
      if (card.learned) textParts.push(`  알아낸 것 — ${card.learned}`);
      if (card.next) textParts.push(`  다음 — ${card.next}`);
      if (card.blocked) textParts.push(`  막힌 것 — ${card.blocked}`);
    });
    textParts.push(
      `LLM ${study.totalCalls}회 · $${study.totalCost.toFixed(3)}${study.durationLabel ? ` · ${study.durationLabel}` : ""}`
    );
  }
  textParts.push("", `■ 내가 해야 할 것 (${todos.length}건)`);
  if (todos.length === 0) {
    textParts.push("지금 사람이 손댈 일은 없습니다.");
  } else {
    todos.forEach((t, i) => {
      textParts.push(`${i + 1}. ${t.title}`, `   ${t.detail}`);
      if (t.prompt) {
        // 프롬프트는 들여쓰지 않는다 — 그대로 긁어서 붙일 수 있어야 한다
        textParts.push(
          `   ↓ ${PROMPT_ROOM_LABEL[t.prompt.room]} 방에 붙여넣기`,
          "",
          t.prompt.text,
          ""
        );
      } else {
        textParts.push(`   화면에서 버튼을 눌러야 합니다 — ${t.btn} ${t.href}`);
      }
    });
  }
  textParts.push("", "■ 오늘 밤 하려는 것", `${hh}:${mm} · 예상 ${tonightMinutes || "—"}분`);
  for (const it of tonightItems) {
    textParts.push(`· ${it.title}${it.why ? ` — ${it.why}` : ""}`);
  }

  const quiet = badChecks.length === 0 && study.cards.length === 0 && todos.length === 0;
  void endIso;

  return {
    subject: `[LUNA] 아침 리포트 — ${dateLabel}`,
    html,
    quiet,
    textPreview: textParts.join("\n")
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
  await markAdminReportSent(admin, now);
  return {
    ok: true,
    to: toLabel,
    subject,
    messageId: data?.id,
    textPreview
  };
}
