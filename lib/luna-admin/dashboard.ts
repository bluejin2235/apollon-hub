import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDayBounds, getSelfstudyStatus } from "@/lib/luna/selfstudy";
import { countOpenFailures } from "@/lib/luna/failures";
import { buildPrimarySources } from "@/lib/luna-admin/primary";
import {
  latestLinkAt,
  linkKindCounts
} from "@/lib/luna-admin/links";
import { countQuestions } from "@/lib/luna-admin/questions";
import { loadTonightState } from "@/lib/luna-admin/tonight";
import {
  formatIdleLabel,
  kstCalendarDaysAgo,
  lightFromIdleDays,
  worstLight,
  type TrafficLight
} from "@/lib/luna-admin/traffic";
import { ADMIN_SELFSTUDY_HOUR, ADMIN_SELFSTUDY_MINUTE } from "@/lib/luna-admin/schedule";
import type {
  AdminAlert,
  AdminDashboard,
  StageView
} from "@/lib/luna-admin/types";

export type { AdminDashboard, StageView, AdminAlert } from "@/lib/luna-admin/types";

function titleFor(key: StageView["key"], light: TrafficLight, days: number | null): string {
  if (light === "green") return "정상";
  if (key === "learn" && days != null && days >= 3) return `${days}일째 멈춤`;
  if (light === "yellow") return days != null ? `${days}일째 지연` : "지연";
  if (days == null) return "기록 없음";
  return `${days}일째 멈춤`;
}

export async function buildAdminDashboard(
  admin: SupabaseClient,
  userId: string
): Promise<AdminDashboard> {
  const weekStart = kstDayBounds(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)).startIso;

  const [
    primary,
    selfstudy,
    linkCounts,
    latestLink,
    pendingCandidates,
    conflictCount,
    pendingQuestions,
    myAssigned,
    openFailures,
    promptActive,
    weekTalk,
    weekUsers,
    tonight
  ] = await Promise.all([
    buildPrimarySources(admin),
    getSelfstudyStatus(admin),
    linkKindCounts(admin),
    latestLinkAt(admin),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "candidate")
      .neq("category", "identity"),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "conflict"),
    countQuestions(admin, "pending"),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "candidate")
      .eq("assigned_to", userId)
      .neq("category", "identity"),
    countOpenFailures(admin),
    admin.from("luna_prompts").select("id", { count: "exact", head: true }).eq("is_active", true),
    admin
      .from("luna_conversations")
      .select("id", { count: "exact", head: true })
      .gte("updated_at", weekStart),
    admin
      .from("luna_conversations")
      .select("user_id")
      .gte("updated_at", weekStart)
      .limit(2000),
    loadTonightState(admin)
  ]);

  const collectLight = worstLight(primary.work.status, primary.notion.status, primary.image.status);
  const selfDays = kstCalendarDaysAgo(selfstudy.last_run?.finished_at ?? null);
  const linkDays = kstCalendarDaysAgo(latestLink);
  const selfLight = lightFromIdleDays(selfDays);
  const linkLight: TrafficLight = latestLink
    ? lightFromIdleDays(linkDays)
    : "yellow";
  const learnLight = worstLight(selfLight, linkLight);
  const pending = (pendingCandidates.count ?? 0) + pendingQuestions;
  const confirmLight: TrafficLight =
    pending > 0 ? "green" : learnLight === "red" ? "yellow" : "yellow";
  const applyLight: TrafficLight =
    (promptActive.count ?? 0) > 0 ? "green" : "red";

  const collectDetail = [
    `노션 ${primary.notion.last_label}`,
    `Work ${primary.work.last_label}`,
    `이미지 ${primary.image.last_label}`
  ].join("\n");

  const learnDetail =
    `자습 ${formatIdleLabel(selfDays)} · 2차 데이터 ${linkCounts.all}건`;

  const confirmDetail =
    pending > 0
      ? `대기 ${pending}건 · 충돌 ${conflictCount.count ?? 0}`
      : "대기 0건\n학습이 멈춰 올라오는 게 없음";

  const applyDetail = `프롬프트 ${promptActive.count ?? 0}개`;

  const learnTitle =
    selfLight === "red"
      ? titleFor("learn", "red", selfDays)
      : linkLight === "red"
        ? `${linkDays}일째 연결 없음`
        : learnLight === "yellow"
          ? linkCounts.all === 0
            ? "2차 대기"
            : "지연"
          : "정상";

  const stages: StageView[] = [
    {
      key: "collect",
      label: "수집",
      light: collectLight,
      title: titleFor("collect", collectLight, Math.max(
        primary.work.status === "red" ? (kstCalendarDaysAgo(primary.work.last_iso) ?? 99) : 0,
        primary.notion.status === "red" ? (kstCalendarDaysAgo(primary.notion.last_iso) ?? 99) : 0,
        primary.image.status === "red" ? (kstCalendarDaysAgo(primary.image.last_iso) ?? 99) : 0
      ) || kstCalendarDaysAgo(primary.work.last_iso)),
      detail: collectDetail
    },
    {
      key: "learn",
      label: "학습",
      light: learnLight,
      title: learnTitle,
      detail: learnDetail
    },
    {
      key: "confirm",
      label: "확정",
      light: confirmLight,
      title: pending > 0 ? "재료 있음" : "재료 없음",
      detail: confirmDetail
    },
    {
      key: "apply",
      label: "적용",
      light: applyLight,
      title: applyLight === "green" ? "정상" : "프롬프트 없음",
      detail: applyDetail
    }
  ];

  const alerts: AdminAlert[] = [];
  for (const stage of stages) {
    if (stage.light !== "red") continue;
    if (stage.key === "collect") {
      const worst = [
        { label: "Work서버", days: kstCalendarDaysAgo(primary.work.last_iso), href: "/settings?menu=knowledge&sub=primary" },
        { label: "노션", days: kstCalendarDaysAgo(primary.notion.last_iso), href: "/settings?menu=knowledge&sub=primary" },
        { label: "이미지", days: kstCalendarDaysAgo(primary.image.last_iso), href: "/settings?menu=knowledge&sub=primary" }
      ].sort((a, b) => (b.days ?? 99) - (a.days ?? 99))[0];
      alerts.push({
        title: `⚠ ${worst.label} 색인이 ${worst.days ?? "?"}일째 돌지 않고 있습니다`,
        detail: stage.detail.replace(/\n/g, " · "),
        href: worst.href
      });
    } else if (stage.key === "learn" && selfLight === "red") {
      alerts.push({
        title: `⚠ 자습이 ${selfDays ?? "?"}일째 돌지 않고 있습니다`,
        detail: `마지막 실행 ${formatIdleLabel(selfDays)} · 그동안 2차 데이터가 ${linkCounts.all}건`,
        href: "/settings?menu=selfstudy&sub=tonight"
      });
    } else if (stage.key === "apply") {
      alerts.push({
        title: "⚠ 활성 프롬프트가 없습니다",
        detail: "두뇌 › 프롬프트를 확인하세요",
        href: "/settings?menu=brain&sub=prompts"
      });
    }
  }

  const userIds = new Set(
    (weekUsers.data ?? []).map((r) => r.user_id).filter((id): id is string => typeof id === "string")
  );

  const hh = String(ADMIN_SELFSTUDY_HOUR).padStart(2, "0");
  const mm = String(ADMIN_SELFSTUDY_MINUTE).padStart(2, "0");

  return {
    stages,
    alerts,
    cards: {
      primary: primary.work.count + primary.notion.count + primary.image.count + primary.wiki.count + primary.glossary.count,
      primary_delta_label: `Work ${primary.work.count.toLocaleString("ko-KR")} · 노션 ${primary.notion.count.toLocaleString("ko-KR")}`,
      secondary: linkCounts.all,
      secondary_note:
        latestLink && (linkDays ?? 0) >= 3
          ? `${linkDays}일째 변화 없음`
          : linkCounts.all === 0
            ? "아직 생성 전"
            : "활성 연결",
      talk_week: weekTalk.count ?? 0,
      talk_users: userIds.size,
      my_turn: (myAssigned.count ?? 0) + pendingQuestions,
      my_turn_note: `충돌 ${conflictCount.count ?? 0} · 후보 ${pendingCandidates.count ?? 0}`
    },
    tonight: tonight.items.filter((i) => !i.excluded && i.when === "tonight"),
    tonight_label: `오늘 밤 ${hh}:${mm} 예정`,
    badges: {
      failures: openFailures,
      candidates: pending,
      selfstudy_dot: (selfDays ?? 99) >= 2 || tonight.items.some((i) => !i.excluded)
    }
  };
}
