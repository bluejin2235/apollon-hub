"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LunaDashboard } from "@/lib/luna/dashboard";
import { buildLunaSettingsUrl } from "@/lib/luna/settings-nav";
import { supabase } from "@/lib/supabase/client";

const C = {
  bg: "#f5f6f8",
  panel: "#ffffff",
  line: "#e7e8ec",
  line2: "#eef0f3",
  ink: "#1c1d21",
  sub: "#6b6f76",
  faint: "#9aa0a8",
  luna: "#534AB7",
  lunaSoft: "#EEEDFE",
  lunaInk: "#3C3489",
  talk: "#0F6E56",
  talkSoft: "#E1F5EE",
  cand: "#D85A30",
  candSoft: "#FAECE7",
  candInk: "#993C1D",
  brain: "#BA7517",
  ok: "#0F6E56",
  barMuted: "#F5C4B3",
  arrow: "#b9bcc2",
  returnStroke: "#c9cbd0"
} as const;

const CARD_CAP = {
  knowledge: "확정된 것만 기억",
  talk: "모르면 묻고 · 정정은 줍는다",
  candidates: "유일한 관문",
  selfstudy: "그날 막힌 것만 · 결과는 지식후보로",
  brain: "L1~L5 프롬프트 17개 · 모든 판단의 축"
} as const;

const AV_STYLES = [
  { bg: C.lunaSoft, color: C.lunaInk },
  { bg: C.talkSoft, color: C.talk },
  { bg: C.candSoft, color: C.candInk }
] as const;

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function avText(name: string): string {
  const t = name.trim();
  if (!t || t === "—") return "?";
  return t.length >= 2 ? t.slice(0, 2) : t;
}

function verifyLabel(result: string | null | undefined): string | null {
  if (result === "confirmed") return "예측 확인됨";
  if (result === "refuted") return "효과 없음";
  if (result === "inconclusive") return "판단 불가";
  return null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
  }
  if (n >= 10_000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return n.toLocaleString();
}

function shortModelLabel(label: string): string {
  return label.replace(/^Claude\s+/i, "").trim() || label;
}

function Rows({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`mt-[9px] border-t border-[#eef0f3] pt-2 text-[12px] text-[#6b6f76] ${className}`}
    >
      {children}
    </div>
  );
}

function Row({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-2.5 leading-[1.95]">
      <span>{label}</span>
      <b className="text-right font-bold text-[#1c1d21]">{children}</b>
    </div>
  );
}

function CardHead({
  title,
  cap,
  right
}: {
  title: string;
  cap: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <h3 className="text-[15px] font-bold tracking-[-0.2px] text-[#1c1d21]">
        {title}
      </h3>
      <span className="text-[11px] font-normal text-[#9aa0a8]">{cap}</span>
      {right ? (
        <span className="ml-auto text-[11px] text-[#9aa0a8]">{right}</span>
      ) : null}
    </div>
  );
}

function DashCard({
  topColor,
  href,
  children
}: {
  topColor: string;
  href: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className="flex w-full cursor-pointer flex-col rounded-[12px] border border-[#e7e8ec] bg-white px-[17px] py-[15px] text-left"
      style={{ borderTopWidth: 3, borderTopColor: topColor }}
    >
      {children}
    </button>
  );
}

function ReturnLine() {
  return (
    <div className="relative mb-0.5 hidden h-[30px] min-[901px]:block">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1180 30"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          d="M960 28 L960 10 L120 10 L120 28"
          fill="none"
          stroke={C.returnStroke}
          strokeWidth={1}
          strokeDasharray="5 4"
        />
        <path
          d="M116 22 L120 28 L124 22"
          fill="none"
          stroke={C.returnStroke}
          strokeWidth={1}
        />
      </svg>
      <span
        className="absolute left-1/2 top-px -translate-x-1/2 px-2.5 text-[11.5px] text-[#9aa0a8]"
        style={{ background: C.bg }}
      >
        확정된 지식만 기억으로
      </span>
    </div>
  );
}

function FlowArrow({ label }: { label: React.ReactNode }) {
  return (
    <div
      className="relative hidden place-items-center min-[901px]:grid"
      aria-hidden
    >
      <div
        className="absolute top-[calc(50%-34px)] w-[110px] text-center text-[11px] leading-[1.35] text-[#9aa0a8]"
      >
        {label}
      </div>
      <svg viewBox="0 0 46 18" className="h-[18px] w-full">
        <line
          x1="2"
          y1="9"
          x2="38"
          y2="9"
          stroke={C.arrow}
          strokeWidth="1.2"
        />
        <path
          d="M34 5 L40 9 L34 13"
          fill="none"
          stroke={C.arrow}
          strokeWidth="1.2"
        />
      </svg>
    </div>
  );
}

function VerticalGap({ label }: { label: string }) {
  return (
    <div
      className="hidden flex-col items-center py-3.5 min-[901px]:flex"
      aria-hidden
    >
      <svg viewBox="0 0 14 26" className="h-[26px] w-3.5">
        <line x1="7" y1="0" x2="7" y2="20" stroke={C.arrow} strokeWidth="1.2" />
        <path
          d="M3 16 L7 22 L11 16"
          fill="none"
          stroke={C.arrow}
          strokeWidth="1.2"
        />
      </svg>
      <div className="mt-1 text-[11.5px] text-[#9aa0a8]">{label}</div>
    </div>
  );
}

function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="my-1.5 flex h-[26px] items-end gap-1">
      {values.map((v, i) => (
        <span
          key={i}
          className={`block flex-1 rounded-[2px] ${
            i === values.length - 1 ? "bg-[#D85A30]" : "bg-[#F5C4B3]"
          }`}
          style={{ height: `${Math.max(8, Math.round((v / max) * 26))}px` }}
          title={`${v}`}
        />
      ))}
    </div>
  );
}

function KnowledgeCard({ k }: { k: LunaDashboard["knowledge"] }) {
  return (
    <DashCard topColor={C.luna} href={buildLunaSettingsUrl("knowledge", "confirmed")}>
      <CardHead title="지식" cap={CARD_CAP.knowledge} />
      <div className="my-[9px] text-[26px] font-bold tracking-[-0.5px] text-[#1c1d21]">
        {k.active_count}
        {k.week_new > 0 ? (
          <small className="ml-1.5 text-[12px] font-semibold text-[#0F6E56]">
            +{k.week_new} 이번 주
          </small>
        ) : null}
      </div>
      <div className="mt-px text-[11px] text-[#9aa0a8]">
        조직 {k.org_count} · 개인 {k.personal_count}
      </div>
      <Rows>
        <Row label="Work서버 인덱싱">
          {k.nas_indexed > 0
            ? k.nas_indexed.toLocaleString()
            : "—"}
        </Row>
        <Row label="노션 연결">
          {k.notion_connected ? "정상" : "미연결"}
        </Row>
        <Row label="충돌 보류">
          {k.conflict_count > 0 ? (
            <span className="text-[#993C1D]">{k.conflict_count}건</span>
          ) : (
            k.conflict_count === 0 ? "0건" : "—"
          )}
        </Row>
        <Row label="최다 사용">
          {k.top_used
            ? `${clip(k.top_used.content, 20)} · ${k.top_used.use_count}회`
            : "—"}
        </Row>
        <Row label="최근 확정">
          {k.latest_confirmed
            ? clip(k.latest_confirmed.content, 28)
            : "—"}
        </Row>
      </Rows>
    </DashCard>
  );
}

function TalkCard({ t }: { t: LunaDashboard["talk"] }) {
  const users = t.top_users_yesterday;

  return (
    <DashCard topColor={C.talk} href={buildLunaSettingsUrl("talk", "history")}>
      <CardHead title="대화" cap={CARD_CAP.talk} />
      <div className="my-[9px] mb-0.5 flex gap-5">
        <div>
          <div className="text-[26px] font-bold tracking-[-0.5px] text-[#1c1d21]">
            {t.conversations_today}
          </div>
          <div className="mt-px text-[11px] text-[#9aa0a8]">
            오늘 (어제 {t.conversations_yesterday})
          </div>
        </div>
        <div>
          <div className="text-[26px] font-bold tracking-[-0.5px] text-[#1c1d21]">
            {t.active_users_today}
          </div>
          <div className="mt-px text-[11px] text-[#9aa0a8]">
            활성 / {t.total_users}명
          </div>
        </div>
        <div>
          <div className="text-[26px] font-bold tracking-[-0.5px] text-[#0F6E56]">
            {t.thumbs_up_today}
            <span className="text-[14px] text-[#9aa0a8]">/{t.thumbs_down_today}</span>
          </div>
          <div className="mt-px text-[11px] text-[#9aa0a8]">좋아요 / 싫어요</div>
        </div>
      </div>
      <Rows className="pb-0.5">
        <div className="mb-[3px] mt-0 text-[11px] text-[#9aa0a8]">
          어제 많이 쓴 사람
        </div>
        {users.length > 0 ? (
          users.map((u) => {
            const av = AV_STYLES[(u.rank - 1) % AV_STYLES.length];
            return (
              <div
                key={u.user_id}
                className="flex items-center gap-[7px] text-[12.5px] leading-[1.95]"
              >
                <span className="w-[11px] text-[11px] text-[#9aa0a8]">
                  {u.rank}
                </span>
                <span
                  className="grid h-[19px] w-[19px] place-items-center rounded-full text-[9px] font-bold"
                  style={{ background: av.bg, color: av.color }}
                >
                  {avText(u.name)}
                </span>
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                <b className="font-bold text-[#1c1d21]">{u.count}</b>
              </div>
            );
          })
        ) : (
          <div className="text-[12px] text-[#9aa0a8]">—</div>
        )}
      </Rows>
      <Rows>
        <Row label="되물음">
          오늘 {t.clarify_today} · 어제 {t.clarify_yesterday}
        </Row>
        <Row label="정정받음">
          오늘 {t.corrections_today} · 어제 {t.corrections_yesterday}
        </Row>
        <Row label="검색 0건 · 재검색">
          {t.search_zero_today}회 · {t.requery_today}회
        </Row>
        <Row label="가정 확인 표시">오늘 {t.assume_today}회</Row>
      </Rows>
    </DashCard>
  );
}

function CandidatesCard({ c }: { c: LunaDashboard["candidates"] }) {
  const sources = [
    c.by_source.chat > 0 ? `대화${c.by_source.chat}` : null,
    c.by_source.selfstudy > 0 ? `자습${c.by_source.selfstudy}` : null,
    c.by_source.question > 0 ? `질문${c.by_source.question}` : null,
    c.by_source.direct > 0 ? `직접${c.by_source.direct}` : null
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <DashCard topColor={C.cand} href={buildLunaSettingsUrl("candidates", "pending")}>
      <CardHead title="지식후보" cap={CARD_CAP.candidates} />
      <div className="mb-0 mt-[9px] flex items-baseline gap-2">
        <span className="text-[26px] font-bold tracking-[-0.5px] text-[#993C1D]">
          {c.pending}
        </span>
        <span className="text-[11px] text-[#9aa0a8]">대기 중</span>
        <span className="ml-auto text-[12px] font-bold text-[#0F6E56]">
          오늘 확정 {c.confirmed_today}
        </span>
      </div>
      {c.weekly_inflow.length > 0 ? (
        <>
          <MiniBars values={c.weekly_inflow} />
          {c.trend_label ? (
            <div className="text-[11px] text-[#0F6E56]">{c.trend_label}</div>
          ) : null}
        </>
      ) : null}
      <Rows>
        <Row label="출처 구성">{sources || "—"}</Row>
        <Row label="평균 확정 소요">
          {c.avg_confirm_days != null ? `${c.avg_confirm_days}일` : "—"}
        </Row>
        <Row label="내가 답할 차례">
          {c.my_turn > 0 ? (
            <span className="text-[#993C1D]">{c.my_turn}건</span>
          ) : (
            c.my_turn === 0 ? "0건" : "—"
          )}
        </Row>
      </Rows>
    </DashCard>
  );
}

function SelfstudyCard({ s }: { s: LunaDashboard["selfstudy"] }) {
  return (
    <DashCard topColor={C.luna} href={buildLunaSettingsUrl("selfstudy", "history")}>
      <CardHead
        title="자습"
        cap={CARD_CAP.selfstudy}
        right={`다음 실행 ${s.next_run_label}`}
      />
      <div className="my-[9px] mb-0.5 flex gap-5">
        <div>
          <div className="text-[26px] font-bold tracking-[-0.5px] text-[#1c1d21]">
            {s.yesterday_submitted}
          </div>
          <div className="mt-px text-[11px] text-[#9aa0a8]">어제 제출 문답</div>
        </div>
        <div>
          <div className="text-[26px] font-bold tracking-[-0.5px] text-[#1c1d21]">
            {s.accuracy_pct != null ? (
              <>
                {s.accuracy_pct}
                <span className="text-[14px]">%</span>
              </>
            ) : (
              "—"
            )}
          </div>
          <div className="mt-px text-[11px] text-[#9aa0a8]">
            자습 정확도 (확정률)
          </div>
        </div>
        <div>
          <div className="text-[26px] font-bold tracking-[-0.5px] text-[#1c1d21]">
            {s.stuck_today}
          </div>
          <div className="mt-px text-[11px] text-[#9aa0a8]">오늘 쌓인 막힌 순간</div>
        </div>
      </div>
      <Rows>
        <Row label="최근 자습 주제">
          {s.recent_topic ? clip(s.recent_topic, 36) : "—"}
        </Row>
        <Row label="안 배워도 됨 판정">이번 주 {s.not_needed_week}건</Row>
      </Rows>
    </DashCard>
  );
}

function BrainCard({ b }: { b: LunaDashboard["brain"] }) {
  const modelText =
    b.models.length > 0
      ? b.models.map((m) => shortModelLabel(m.label)).join(" · ")
      : "—";

  return (
    <DashCard topColor={C.brain} href={buildLunaSettingsUrl("brain", "prompts")}>
      <CardHead title="두뇌" cap={CARD_CAP.brain} />
      <Rows className="mt-1.5 border-t-0 pt-1">
        <Row label="이번 주 변경">
          루나 {b.week_changes_luna} · 사람 {b.week_changes_human}
        </Row>
        <Row label="루나의 개선 제안">
          {b.revert_pending > 0 ? (
            <span className="text-[#993C1D]">대기 {b.revert_pending}건</span>
          ) : (
            "대기 0건"
          )}
        </Row>
        <Row label="최근 자기개선">
          {b.latest_upgrade
            ? `${clip(b.latest_upgrade.title, 20)}${
                verifyLabel(b.latest_upgrade.verify_result)
                  ? ` · ${verifyLabel(b.latest_upgrade.verify_result)}`
                  : ""
              }`
            : "—"}
        </Row>
        <Row label="모델 A / B / C">{modelText}</Row>
        <Row label="주간 토큰">
          {b.tokens_week > 0 ? (
            <>
              {formatTokens(b.tokens_week)}
              {b.tokens_delta_pct != null ? (
                <span className="text-[#993C1D]">
                  {" "}
                  {b.tokens_delta_pct >= 0 ? "+" : ""}
                  {b.tokens_delta_pct}%
                </span>
              ) : null}
            </>
          ) : (
            "—"
          )}
        </Row>
      </Rows>
    </DashCard>
  );
}

export default function LunaSettingsHome() {
  const router = useRouter();
  const [data, setData] = useState<LunaDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/luna/dashboard", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      const json = (await res.json()) as LunaDashboard;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const k = data?.knowledge;
  const t = data?.talk;
  const c = data?.candidates;
  const s = data?.selfstudy;
  const b = data?.brain;

  return (
    <div className="mx-auto max-w-[1180px] rounded-[12px] p-7" style={{ background: C.bg, color: C.ink }}>
      <header className="mb-[18px] flex items-center gap-3">
        <div
          className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full text-[15px] font-bold text-[#EEEDFE]"
          style={{ background: C.luna }}
          aria-hidden
        >
          L
        </div>
        <div className="min-w-0">
          <h1 className="text-[17px] font-bold tracking-[-0.3px] text-[#1c1d21]">
            LUNA 대시보드
          </h1>
          <div className="mt-0.5 text-[12px] text-[#6b6f76]">
            {data?.date_label ?? "불러오는 중…"}
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            router.push(buildLunaSettingsUrl("candidates", "mine"))
          }
          className="ml-auto cursor-pointer whitespace-nowrap rounded-[20px] border border-[#f3d9cf] bg-[#FAECE7] px-3.5 py-1.5 text-[12.5px] font-bold text-[#993C1D]"
        >
          내가 답할 차례 {data?.my_turn_count ?? 0}건
        </button>
      </header>

      {loading ? (
        <p className="py-10 text-center text-[13px] text-[#9aa0a8]">
          지표를 모으는 중…
        </p>
      ) : error ? (
        <p className="rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
        </p>
      ) : data && k && t && c && s && b ? (
        <>
          <ReturnLine />

          <div className="flex flex-col gap-3 min-[901px]:grid min-[901px]:grid-cols-[1fr_46px_1.15fr_46px_1fr] min-[901px]:items-stretch min-[901px]:gap-0">
            <KnowledgeCard k={k} />
            <FlowArrow label="지식으로 답변" />
            <TalkCard t={t} />
            <FlowArrow
              label={
                <>
                  대화로 얻은
                  <br />
                  지식후보
                </>
              }
            />
            <CandidatesCard c={c} />
          </div>

          <VerticalGap
            label={`대화로 궁금한 점 · 막힌 순간 ${s.stuck_today}개`}
          />

          <div className="flex flex-col gap-3 min-[901px]:grid min-[901px]:grid-cols-[1.2fr_1fr] min-[901px]:gap-4">
            <SelfstudyCard s={s} />
            <BrainCard b={b} />
          </div>
        </>
      ) : null}
    </div>
  );
}
