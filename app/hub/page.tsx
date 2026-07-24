"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { HubBoardDetailModal } from "@/components/hub/hub-board-detail-modal";
import { HubPostWriteModal } from "@/components/hub/hub-post-write-modal";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";
import { supabase } from "@/lib/supabase/client";

// ── 타입 ──────────────────────────────────────────────
interface TodayStats {
  myLicenseCount: number;
  myLicenseCostKrw: number;
  myLicenseCostLastMonthKrw: number;
  weekAiCostKrw: number;
  weekSentReports: number;
  weekMyChat: number;
  yesterdayVisitors: number;
}

interface WeatherDay {
  date: string;
  label: string;
  temp: number;
  tempMin: number;
  tempMax: number;
  condition: string;
  compareYesterday?: number;
  amDesc?: string;
  pmDesc?: string;
  amRain?: number;
  pmRain?: number;
}

type HubPostRow = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  author_id: string;
  authorName: string;
};

// ── 날씨 fetch (Open-Meteo, 성수역 좌표) ──────────────
function formatMdFromIsoDate(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length < 3) return isoDate;
  return `${parts[1]}.${parts[2]}`;
}

async function fetchWeather(): Promise<{ today: WeatherDay; tomorrow: WeatherDay }> {
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=37.5447&longitude=127.0561" +
    "&current=temperature_2m,weathercode&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    "&timezone=Asia%2FSeoul&forecast_days=2";
  const res = await fetch(url);
  const data = await res.json();

  const wmoLabel = (code: number): string => {
    if (code === 0) return "맑음";
    if (code <= 2) return "구름많음";
    if (code === 3) return "흐림";
    if (code <= 67) return "비";
    if (code <= 77) return "눈";
    if (code <= 82) return "소나기";
    return "흐림";
  };

  const cur = data.current;
  const daily = data.daily;
  const tomorrowCode = Number(daily.weathercode?.[1] ?? 3);
  const tomorrowCond = wmoLabel(tomorrowCode);
  const rainProb = Number(daily.precipitation_probability_max?.[1] ?? 0);

  const today: WeatherDay = {
    date: formatMdFromIsoDate(String(daily.time?.[0] ?? "")),
    label: "현재",
    temp: Math.round(cur.temperature_2m * 10) / 10,
    tempMin: Math.round(daily.temperature_2m_min[0]),
    tempMax: Math.round(daily.temperature_2m_max[0]),
    condition: wmoLabel(cur.weathercode),
    compareYesterday: undefined
  };

  const tomorrow: WeatherDay = {
    date: formatMdFromIsoDate(String(daily.time?.[1] ?? "")),
    label: "내일",
    temp: Math.round((daily.temperature_2m_max[1] + daily.temperature_2m_min[1]) / 2),
    tempMin: Math.round(daily.temperature_2m_min[1]),
    tempMax: Math.round(daily.temperature_2m_max[1]),
    condition: tomorrowCond,
    amDesc: tomorrowCond,
    pmDesc: tomorrowCond,
    amRain: rainProb,
    pmRain: rainProb
  };

  return { today, tomorrow };
}

// ── Today 통계 fetch ──────────────────────────────────
async function fetchTodayStats(profileId: string): Promise<TodayStats> {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];

  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;

  const [licenseManagers, aiCost, sentReports, myChat, yesterdayVisit, thisMonthCost, lastMonthCost] =
    await Promise.all([
      supabase.from("license_managers").select("service_id").eq("profile_id", profileId),
      supabase.from("api_usage").select("cost_krw").gte("date", sevenDaysAgoStr),
      supabase
        .from("trend_editor_candidates")
        .select("id", { count: "exact", head: true })
        .eq("is_sent", true)
        .gte("sent_at", sevenDaysAgo.toISOString()),
      supabase
        .from("trend_messages")
        .select("id", { count: "exact", head: true })
        .neq("message_type", "ai")
        .eq("profile_id", profileId)
        .gte("created_at", sevenDaysAgo.toISOString()),
      supabase
        .from("access_logs")
        .select("profile_id")
        .gte("created_at", `${yesterdayStr}T00:00:00.000+09:00`)
        .lt("created_at", `${todayStr}T00:00:00.000+09:00`),
      supabase
        .from("service_cost_history")
        .select("cost_monthly_krw, service_id")
        .eq("recorded_month", thisMonth),
      supabase
        .from("service_cost_history")
        .select("cost_monthly_krw, service_id")
        .eq("recorded_month", lastMonth)
    ]);

  const myServiceIds = new Set((licenseManagers.data ?? []).map((r) => r.service_id as string));

  const calcCost = (rows: { cost_monthly_krw: number; service_id: string }[] | null) =>
    (rows ?? [])
      .filter((r) => myServiceIds.has(r.service_id))
      .reduce((s, r) => s + (Number(r.cost_monthly_krw) || 0), 0);

  const weekAiCostKrw = (aiCost.data ?? []).reduce((s, r) => s + (Number(r.cost_krw) || 0), 0);

  const uniqueYesterday = new Set((yesterdayVisit.data ?? []).map((r) => r.profile_id)).size;

  const thisMonthKrw = calcCost(
    thisMonthCost.data as { cost_monthly_krw: number; service_id: string }[] | null
  );
  const lastMonthKrw = calcCost(
    lastMonthCost.data as { cost_monthly_krw: number; service_id: string }[] | null
  );
  const displayCost = thisMonthKrw > 0 ? thisMonthKrw : lastMonthKrw;

  return {
    myLicenseCount: myServiceIds.size,
    myLicenseCostKrw: displayCost,
    myLicenseCostLastMonthKrw: lastMonthKrw,
    weekAiCostKrw: Math.round(weekAiCostKrw),
    weekSentReports: sentReports.count ?? 0,
    weekMyChat: myChat.count ?? 0,
    yesterdayVisitors: uniqueYesterday
  };
}

// ── 유틸 ──────────────────────────────────────────────
function formatKrw(n: number) {
  return n.toLocaleString("ko-KR");
}

function clockStr() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}:${String(n.getSeconds()).padStart(2, "0")}`;
}

function todayLabel() {
  const n = new Date();
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${n.getFullYear()}년 ${n.getMonth() + 1}월 ${n.getDate()}일 ${days[n.getDay()]}요일`;
}

const SERVICES = [
  { label: "라이선스", sub: "Manager", icon: "ti-key", color: "#EF9F27", href: "/licenses" },
  { label: "트렌드 레이더", sub: "Radar", icon: "ti-radar", color: "#EF9F27", href: "/research" },
  { label: "AI비용관리", sub: "Arte", icon: "ti-chart-bar", color: "#EF9F27", href: "/agents" },
  { label: "물품창고", sub: "Supplies", icon: "ti-package", color: "#1D9E75", href: "/supplies" },
  { label: "아슐랭", sub: "Restaurant", icon: "ti-tools-kitchen-2", color: "#D85A30", href: "/restaurants" }
];

function weatherIcon(condition: string) {
  if (condition.includes("맑")) return "☀️";
  if (condition.includes("구름")) return "⛅";
  if (condition.includes("비") || condition.includes("소나기")) return "🌦️";
  if (condition.includes("눈")) return "❄️";
  return "🌥️";
}

const C = {
  surface0: "#f4f3f8",
  surface2: "#ffffff",
  border: "#e2e8f0",
  textMuted: "#64748b",
  textAccent: "#534AB7",
  bgAccent: "rgba(83,74,183,0.12)",
  textDanger: "#e11d48",
  textSuccess: "#059669"
} as const;

export default function ServiceHubPage() {
  const { status, profile } = useRequirePortalSession();

  const [clock, setClock] = useState(clockStr());
  const [weather, setWeather] = useState<{ today: WeatherDay; tomorrow: WeatherDay } | null>(null);
  const [stats, setStats] = useState<TodayStats | null>(null);
  const [posts, setPosts] = useState<HubPostRow[]>([]);
  const [postCount, setPostCount] = useState(0);
  const [writeOpen, setWriteOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<HubPostRow | null>(null);
  const [detailPost, setDetailPost] = useState<HubPostRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HubPostRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (document.getElementById("tabler-icons-css")) return;
    const link = document.createElement("link");
    link.id = "tabler-icons-css";
    link.rel = "stylesheet";
    link.href =
      "https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.34.1/dist/tabler-icons.min.css";
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setClock(clockStr()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetchWeather()
      .then(setWeather)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    fetchTodayStats(profile.id)
      .then(setStats)
      .catch(() => {});
  }, [profile?.id]);

  const loadPosts = useCallback(async () => {
    const { data, count, error } = await supabase
      .from("hub_posts")
      .select("id, title, content, created_at, author_id", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      console.error("[hub] hub_posts", error);
      setPosts([]);
      setPostCount(0);
      return;
    }

    const raw = (data ?? []) as Omit<HubPostRow, "authorName">[];
    const authorIds = [...new Set(raw.map((r) => r.author_id))];
    const nameById = new Map<string, string>();
    if (authorIds.length > 0) {
      const { data: profs } = await supabase.from("profiles").select("id, name").in("id", authorIds);
      for (const p of profs ?? []) {
        nameById.set(p.id as string, ((p.name as string) ?? "").trim() || "—");
      }
    }

    setPosts(
      raw.map((r) => ({
        ...r,
        authorName: nameById.get(r.author_id) ?? "—"
      }))
    );
    setPostCount(count ?? 0);
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    void loadPosts();
  }, [status, loadPosts]);

  const onDeletePost = useCallback(async () => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    const { error } = await supabase.from("hub_posts").delete().eq("id", deleteTarget.id);
    setDeleteBusy(false);
    if (error) {
      window.alert(`삭제 실패: ${error.message}`);
      return;
    }
    setDeleteTarget(null);
    setDetailPost((prev) => (prev?.id === deleteTarget.id ? null : prev));
    await loadPosts();
  }, [deleteBusy, deleteTarget, loadPosts]);

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const diffSign = stats ? stats.myLicenseCostKrw - stats.myLicenseCostLastMonthKrw : null;
  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";

  return (
    <main className="min-h-screen">
      <PortalHeader
        userInfoLine={userInfoLine}
        onLogout={() => void signOutAndRedirectToLogin()}
        hubTitleVariant="text"
      />

      <div className="pb-10 pt-14">
        {/* 히어로+본문: 상단 라운드 없이 뷰포트 좌우 풀블리드 */}
        <div className="relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 bg-[#0f0e18]">
          {/* ── 히어로 다크 영역 ── */}
          <div
            className="px-6 pb-0 pt-6"
            style={{ background: "linear-gradient(135deg,#1e1c2e 0%,#16151f 100%)" }}
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div
                  className="font-medium tracking-tight text-white"
                  style={{ fontSize: 36, lineHeight: 1 }}
                >
                  {clock}
                </div>
                <div className="mt-1 text-sm" style={{ color: "#8f8fa6" }}>
                  {todayLabel()}
                </div>
                <div className="mt-3 text-sm font-medium" style={{ color: "#AFA9EC" }}>
                  안녕하세요, {profile?.name ?? ""}님 👋
                </div>
              </div>

              <div
                className="flex-shrink-0 rounded-xl"
                style={{ background: "rgba(255,255,255,0.06)", padding: "14px 18px", minWidth: 280 }}
              >
                <div className="mb-3 text-xs" style={{ color: "#6b6b82" }}>
                  <i
                    className="ti ti-map-pin"
                    style={{ fontSize: 11, verticalAlign: -1, marginRight: 4 }}
                  />
                  성동구 성수2가3동
                </div>
                <div className="flex items-stretch gap-0">
                  <div className="flex-1 pr-4">
                    <div className="mb-2 text-xs" style={{ color: "#8f8fa6" }}>
                      현재 {weather?.today.date || "—"}
                    </div>
                    <div className="mb-1 flex items-center gap-2">
                      <span style={{ fontSize: 20 }}>
                        {weather ? weatherIcon(weather.today.condition) : "⛅"}
                      </span>
                      <span
                        className="font-medium text-white"
                        style={{ fontSize: 28, lineHeight: 1 }}
                      >
                        {weather?.today.temp ?? "—"}°
                      </span>
                    </div>
                    <div className="mb-1 text-xs" style={{ color: "#cfcfe0" }}>
                      {weather?.today.condition ?? "날씨 불러오는 중"}
                    </div>
                    {weather?.today.compareYesterday != null ? (
                      <div className="text-xs" style={{ color: "#8f8fa6" }}>
                        어제보다 {weather.today.compareYesterday}° ↑
                      </div>
                    ) : null}
                    <div className="mt-1 text-xs" style={{ color: "#8f8fa6" }}>
                      최저 {weather?.today.tempMin ?? "—"}° · 최고 {weather?.today.tempMax ?? "—"}°
                    </div>
                  </div>

                  <div style={{ width: 1, background: "rgba(255,255,255,0.1)" }} />

                  <div className="flex-1 pl-4">
                    <div className="mb-2 text-xs" style={{ color: "#8f8fa6" }}>
                      내일 {weather?.tomorrow.date || "—"}
                    </div>
                    <div className="mb-2 flex items-end gap-3">
                      <div>
                        <div className="text-xs" style={{ color: "#8f8fa6" }}>
                          최저
                        </div>
                        <div
                          className="font-medium text-white"
                          style={{ fontSize: 22, lineHeight: 1.1 }}
                        >
                          {weather?.tomorrow.tempMin ?? "—"}°
                        </div>
                      </div>
                      <div style={{ color: "#555570", fontSize: 16, paddingBottom: 2 }}>/</div>
                      <div>
                        <div className="text-xs" style={{ color: "#8f8fa6" }}>
                          최고
                        </div>
                        <div
                          className="font-medium text-white"
                          style={{ fontSize: 22, lineHeight: 1.1 }}
                        >
                          {weather?.tomorrow.tempMax ?? "—"}°
                        </div>
                      </div>
                    </div>
                    <div className="mb-1 text-xs" style={{ color: "#7baff0" }}>
                      🌦 오전 {weather?.tomorrow.amDesc ?? "—"}{" "}
                      {weather?.tomorrow.amRain != null ? `☂ ${weather.tomorrow.amRain}%` : ""}
                    </div>
                    <div className="text-xs" style={{ color: "#7baff0" }}>
                      🌦 오후 {weather?.tomorrow.pmDesc ?? "—"}{" "}
                      {weather?.tomorrow.pmRain != null ? `☂ ${weather.tomorrow.pmRain}%` : ""}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-5">
              <Link
                href="/research"
                className="flex flex-shrink-0 flex-col rounded-xl"
                style={{
                  background: "rgba(83,74,183,0.28)",
                  border: "0.5px solid rgba(83,74,183,0.5)",
                  padding: "12px 14px",
                  minWidth: 110,
                  textDecoration: "none"
                }}
              >
                <i className="ti ti-sparkles" style={{ color: "#AFA9EC", fontSize: 20 }} />
                <div className="mt-2 text-xs font-medium" style={{ color: "#AFA9EC" }}>
                  나와 루나
                </div>
                <div className="mt-1 text-xs" style={{ color: "#7F77DD" }}>
                  채팅방 바로가기 →
                </div>
              </Link>

              {SERVICES.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="flex flex-shrink-0 flex-col rounded-xl"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "0.5px solid rgba(255,255,255,0.09)",
                    padding: "12px 14px",
                    minWidth: 100,
                    textDecoration: "none"
                  }}
                >
                  <i className={`ti ${s.icon}`} style={{ color: s.color, fontSize: 20 }} />
                  <div className="mt-2 text-xs font-medium" style={{ color: "#e0e0e8" }}>
                    {s.label}
                  </div>
                  <div className="mt-1 text-xs" style={{ color: "#555570" }}>
                    {s.sub}
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* ── 라이트 영역 ── */}
          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2" style={{ background: C.surface0 }}>
            <div>
              <div
                className="mb-2 text-xs font-medium tracking-wider"
                style={{ color: C.textMuted, letterSpacing: "0.05em" }}
              >
                HUB 게시판
              </div>
              <div
                className="overflow-hidden rounded-xl"
                style={{ background: C.surface2, border: `0.5px solid ${C.border}` }}
              >
                <div
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: `0.5px solid ${C.border}` }}
                >
                  <span className="text-xs" style={{ color: C.textMuted }}>
                    총 {postCount}건
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingPost(null);
                      setWriteOpen(true);
                    }}
                    className="rounded-md px-3 py-1 text-xs"
                    style={{ background: C.bgAccent, color: C.textAccent }}
                    disabled={!profile?.id}
                  >
                    <i
                      className="ti ti-edit"
                      style={{ fontSize: 12, verticalAlign: -1, marginRight: 3 }}
                    />
                    글쓰기
                  </button>
                </div>
                {posts.length === 0 ? (
                  <div className="px-4 py-4 text-center text-sm" style={{ color: C.textMuted }}>
                    아직 게시글이 없습니다
                  </div>
                ) : (
                  posts.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setDetailPost(p)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                      style={{
                        borderTop: i === 0 ? undefined : `0.5px solid ${C.border}`,
                        color: "inherit"
                      }}
                    >
                      <span className="flex-1 truncate text-sm font-medium text-slate-900">
                        {p.title}
                      </span>
                      <span className="ml-3 flex-shrink-0 text-xs" style={{ color: C.textMuted }}>
                        {new Date(p.created_at).toLocaleDateString("ko-KR", {
                          month: "numeric",
                          day: "numeric"
                        })}
                      </span>
                    </button>
                  ))
                )}
                <div
                  className="px-4 py-3 text-center text-xs"
                  style={{ borderTop: `0.5px solid ${C.border}`, color: C.textMuted }}
                >
                  최근 5건 표시
                </div>
              </div>
            </div>

            <div>
              <div
                className="mb-2 text-xs font-medium tracking-wider"
                style={{ color: C.textMuted, letterSpacing: "0.05em" }}
              >
                MY TODAY
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div
                  className="col-span-2 rounded-xl p-3"
                  style={{ background: C.surface2, border: `0.5px solid ${C.border}` }}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="mb-1 text-xs" style={{ color: C.textMuted }}>
                        <i
                          className="ti ti-key"
                          style={{ fontSize: 11, verticalAlign: -1, marginRight: 4 }}
                        />
                        내 담당 라이선스
                      </div>
                      <div className="text-lg font-medium text-slate-900">
                        {stats?.myLicenseCount ?? "-"}개 ·{" "}
                        <span style={{ color: C.textAccent }}>
                          ₩{stats ? formatKrw(stats.myLicenseCostKrw) : "---"}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="mb-1 text-xs" style={{ color: C.textMuted }}>
                        지난달 대비
                      </div>
                      {stats && diffSign != null ? (
                        <div
                          className="text-sm font-medium"
                          style={{
                            color:
                              diffSign > 0
                                ? C.textDanger
                                : diffSign < 0
                                  ? C.textSuccess
                                  : C.textMuted
                          }}
                        >
                          {diffSign > 0
                            ? `+₩${formatKrw(diffSign)}`
                            : diffSign < 0
                              ? `-₩${formatKrw(Math.abs(diffSign))}`
                              : "변동 없음"}
                        </div>
                      ) : (
                        <div className="text-sm" style={{ color: C.textMuted }}>
                          집계 중
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div
                  className="rounded-xl p-3"
                  style={{ background: C.surface2, border: `0.5px solid ${C.border}` }}
                >
                  <div className="mb-2 text-xs" style={{ color: C.textMuted }}>
                    <i
                      className="ti ti-cpu"
                      style={{ fontSize: 11, verticalAlign: -1, marginRight: 3 }}
                    />
                    7일 AI 비용
                  </div>
                  <div className="text-lg font-medium" style={{ color: C.textAccent }}>
                    ₩{stats ? formatKrw(stats.weekAiCostKrw) : "---"}
                  </div>
                  <div className="mt-1 text-xs" style={{ color: C.textMuted }}>
                    Anthropic + OpenAI
                  </div>
                </div>

                <div
                  className="rounded-xl p-3"
                  style={{ background: C.surface2, border: `0.5px solid ${C.border}` }}
                >
                  <div className="mb-2 text-xs" style={{ color: C.textMuted }}>
                    <i
                      className="ti ti-send"
                      style={{ fontSize: 11, verticalAlign: -1, marginRight: 3 }}
                    />
                    7일 리포트 발송
                  </div>
                  <div className="text-lg font-medium text-slate-900">
                    {stats?.weekSentReports ?? "-"}
                    <span className="ml-1 text-xs font-normal" style={{ color: C.textMuted }}>
                      건
                    </span>
                  </div>
                  <div className="mt-1 text-xs" style={{ color: C.textMuted }}>
                    트렌드 레이더
                  </div>
                </div>

                <div
                  className="rounded-xl p-3"
                  style={{ background: C.surface2, border: `0.5px solid ${C.border}` }}
                >
                  <div className="mb-2 text-xs" style={{ color: C.textMuted }}>
                    <i
                      className="ti ti-sparkles"
                      style={{
                        fontSize: 11,
                        verticalAlign: -1,
                        marginRight: 3,
                        color: "#AFA9EC"
                      }}
                    />
                    내 루나 활용
                  </div>
                  <div className="text-lg font-medium" style={{ color: "#7F77DD" }}>
                    {stats?.weekMyChat ?? "-"}
                    <span className="ml-1 text-xs font-normal" style={{ color: C.textMuted }}>
                      건
                    </span>
                  </div>
                  <div className="mt-1 text-xs" style={{ color: C.textMuted }}>
                    지난 7일 메시지
                  </div>
                </div>

                <div
                  className="rounded-xl p-3"
                  style={{ background: C.surface2, border: `0.5px solid ${C.border}` }}
                >
                  <div className="mb-2 text-xs" style={{ color: C.textMuted }}>
                    <i
                      className="ti ti-users"
                      style={{ fontSize: 11, verticalAlign: -1, marginRight: 3 }}
                    />
                    어제 접속자
                  </div>
                  <div className="text-lg font-medium text-slate-900">
                    {stats?.yesterdayVisitors ?? "-"}
                    <span className="ml-1 text-xs font-normal" style={{ color: C.textMuted }}>
                      명
                    </span>
                  </div>
                  <div className="mt-1 text-xs" style={{ color: C.textMuted }}>
                    Hub 전체
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {profile?.id ? (
        <HubPostWriteModal
          open={writeOpen}
          authorId={profile.id}
          editingPost={editingPost}
          onClose={() => {
            setWriteOpen(false);
            setEditingPost(null);
          }}
          onSaved={() => void loadPosts()}
        />
      ) : null}

      {detailPost ? (
        <HubBoardDetailModal
          open={Boolean(detailPost)}
          post={detailPost}
          authUserId={profile?.id ?? null}
          onClose={() => setDetailPost(null)}
          onRefresh={() => void loadPosts()}
          onRequestEdit={() => {
            setEditingPost(detailPost);
            setDetailPost(null);
            setWriteOpen(true);
          }}
          onRequestDelete={() => {
            setDeleteTarget(detailPost);
            setDetailPost(null);
          }}
        />
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-lg">
            <p className="text-base font-semibold text-slate-900">게시글을 삭제할까요?</p>
            <p className="mt-2 truncate text-sm text-slate-600">{deleteTarget.title}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteBusy}
              >
                취소
              </button>
              <button
                type="button"
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white"
                onClick={() => void onDeletePost()}
                disabled={deleteBusy}
              >
                {deleteBusy ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
