"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LunaDashboard } from "@/lib/luna/dashboard";
import { buildLunaSettingsUrl } from "@/lib/luna/settings-nav";
import { supabase } from "@/lib/supabase/client";

const COLORS = {
  knowledge: "#534AB7",
  talk: "#0F6E56",
  candidates: "#D85A30",
  selfstudy: "#534AB7",
  brain: "#BA7517"
} as const;

const CARD_DESC = {
  knowledge: "확정된 조직·개인 지식",
  talk: "팀원과의 루나 채팅",
  candidates: "검토 대기 중인 학습 후보",
  selfstudy: "루나 자율 학습",
  brain: "프롬프트·모델·자기개선"
} as const;

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

function initial(name: string): string {
  const t = name.trim();
  return t && t !== "—" ? t.slice(0, 1).toUpperCase() : "?";
}

function verifyLabel(result: string | null | undefined): string | null {
  if (result === "confirmed") return "확인됨";
  if (result === "refuted") return "효과 없음";
  if (result === "inconclusive") return "판단 불가";
  return null;
}

function emDash(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "—";
  return value;
}

function RowItem({
  label,
  value,
  coral,
  truncate
}: {
  label: string;
  value: string | number;
  coral?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-[11px]">
      <span className="shrink-0 text-[#94a3b8]">{label}</span>
      <span
        className={`font-medium text-[#0f172a] ${
          coral ? "text-[#D85A30]" : ""
        } ${truncate ? "max-w-[58%] truncate text-right" : "text-right"}`}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="my-2.5 h-px bg-[#f1f5f9]" />;
}

function CardHead({
  title,
  desc,
  extra
}: {
  title: string;
  desc: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <span className="text-[15px] font-medium text-[#0f172a]">{title}</span>
        <span className="text-[11px] text-[#94a3b8]">{desc}</span>
      </div>
      {extra}
    </div>
  );
}

function DashCard({
  title,
  desc,
  color,
  href,
  headExtra,
  children
}: {
  title: string;
  desc: string;
  color: string;
  href: string;
  headExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className="w-full overflow-hidden rounded-[12px] border-[0.5px] border-[#e2e8f0] bg-white text-left"
    >
      <div className="h-[3px]" style={{ background: color }} />
      <div className="p-4">
        <CardHead title={title} desc={desc} extra={headExtra} />
        {children}
      </div>
    </button>
  );
}

function FlowH({ lines }: { lines: [string, string] }) {
  return (
    <div
      className="hidden min-w-[52px] shrink-0 flex-col items-center justify-center gap-1 px-1 text-center text-[10.5px] leading-tight text-[#94a3b8] min-[900px]:flex"
      aria-hidden
    >
      <span>
        {lines[0]}
        <br />
        {lines[1]}
      </span>
      <span className="text-[14px] text-[#cbd5e1]">→</span>
    </div>
  );
}

function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="mt-3 flex h-9 items-end gap-1">
      {values.map((v, i) => (
        <div
          key={i}
          className={`min-h-[8px] flex-1 rounded-[2px] ${
            i === values.length - 1 ? "bg-[#D85A30]" : "bg-[#D85A30]/25"
          }`}
          style={{ height: `${Math.max(10, Math.round((v / max) * 100))}%` }}
          title={`${v}`}
        />
      ))}
    </div>
  );
}

function KnowledgeCard({ k }: { k: LunaDashboard["knowledge"] }) {
  const nasValue =
    k.nas_last_total != null
      ? `${k.nas_indexed.toLocaleString()} (스캔 ${k.nas_last_total.toLocaleString()})`
      : k.nas_indexed.toLocaleString();

  return (
    <DashCard
      title="지식"
      desc={CARD_DESC.knowledge}
      color={COLORS.knowledge}
      href={buildLunaSettingsUrl("knowledge", "confirmed")}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[26px] font-medium leading-tight tabular-nums text-[#0f172a]">
          {k.active_count}
        </span>
        {k.week_new > 0 ? (
          <span className="text-[13px] font-medium text-[#059669]">
            +{k.week_new} 이번 주
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] text-[#94a3b8]">
        조직 {k.org_count} · 개인 {k.personal_count}
      </p>
      <Divider />
      <RowItem label="Work서버 인덱싱" value={nasValue} />
      <RowItem
        label="노션"
        value={k.notion_connected ? "연결됨" : "미연결"}
      />
      <RowItem
        label="충돌 보류"
        value={k.conflict_count}
        coral={k.conflict_count > 0}
      />
      <RowItem
        label="최다 사용 지식"
        value={
          k.top_used
            ? `${clip(k.top_used.content, 28)} (${k.top_used.use_count}회)`
            : "—"
        }
        truncate
      />
      <RowItem
        label="최근 확정"
        value={
          k.latest_confirmed
            ? clip(k.latest_confirmed.content, 32)
            : "—"
        }
        truncate
      />
    </DashCard>
  );
}

function TalkCard({ t }: { t: LunaDashboard["talk"] }) {
  const users = t.top_users_yesterday;

  return (
    <DashCard
      title="대화"
      desc={CARD_DESC.talk}
      color={COLORS.talk}
      href={buildLunaSettingsUrl("talk", "history")}
    >
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-[11px] text-[#94a3b8]">오늘 대화</p>
          <p className="text-[26px] font-medium leading-tight tabular-nums text-[#0f172a]">
            {t.conversations_today}
          </p>
          <p className="text-[10px] text-[#94a3b8]">
            어제 {t.conversations_yesterday}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#94a3b8]">활성 사용자</p>
          <p className="text-[26px] font-medium leading-tight tabular-nums text-[#0f172a]">
            {t.active_users_today}
            <span className="text-[14px] font-normal text-[#94a3b8]">
              /{t.total_users}
            </span>
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#94a3b8]">피드백</p>
          <p className="text-[22px] font-medium leading-tight tabular-nums text-[#0f172a]">
            👍{t.thumbs_up_today}
          </p>
          <p className="text-[14px] font-medium tabular-nums text-[#0f172a]">
            👎{t.thumbs_down_today}
          </p>
        </div>
      </div>
      <Divider />
      <p className="mb-1.5 text-[11px] text-[#94a3b8]">어제 많이 쓴 사람</p>
      {users.length > 0 ? (
        <ul className="space-y-0.5">
          {users.map((u) => (
            <li
              key={u.user_id}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-[#94a3b8]">{u.rank}</span>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0F6E56]/10 text-[10px] font-medium text-[#0F6E56]">
                  {initial(u.name)}
                </span>
                <span className="truncate text-[#0f172a]">{u.name}</span>
              </div>
              <span className="shrink-0 font-medium tabular-nums text-[#0f172a]">
                {u.count}건
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-[#94a3b8]">—</p>
      )}
      <Divider />
      <RowItem
        label="되물음"
        value={`오늘 ${t.clarify_today} · 어제 ${t.clarify_yesterday}`}
      />
      <RowItem
        label="정정받음"
        value={`오늘 ${t.corrections_today} · 어제 ${t.corrections_yesterday}`}
      />
      <RowItem
        label="검색 0건 · 재검색"
        value={`${t.search_zero_today} · ${t.requery_today}`}
      />
      <RowItem label="가정 확인 표시" value={t.assume_today} />
    </DashCard>
  );
}

function CandidatesCard({ c }: { c: LunaDashboard["candidates"] }) {
  return (
    <DashCard
      title="지식후보"
      desc={CARD_DESC.candidates}
      color={COLORS.candidates}
      href={buildLunaSettingsUrl("candidates", "pending")}
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] text-[#94a3b8]">대기</p>
          <p className="text-[26px] font-medium leading-tight tabular-nums text-[#D85A30]">
            {c.pending}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-[#94a3b8]">오늘 확정</p>
          <p className="text-[20px] font-medium tabular-nums text-[#059669]">
            {c.confirmed_today}
          </p>
        </div>
      </div>
      {c.weekly_inflow.length > 0 ? (
        <>
          <MiniBars values={c.weekly_inflow} />
          {c.trend_label ? (
            <p className="mt-1.5 text-[11px] text-[#94a3b8]">{c.trend_label}</p>
          ) : null}
        </>
      ) : null}
      <Divider />
      <RowItem
        label="출처 구성"
        value={`대화${c.by_source.chat} · 자습${c.by_source.selfstudy} · 질문${c.by_source.question} · 직접${c.by_source.direct}`}
      />
      <RowItem
        label="평균 확정 소요"
        value={c.avg_confirm_days != null ? `${c.avg_confirm_days}일` : "—"}
      />
      <RowItem
        label="내가 답할 차례"
        value={c.my_turn}
        coral={c.my_turn > 0}
      />
    </DashCard>
  );
}

function SelfstudyCard({ s }: { s: LunaDashboard["selfstudy"] }) {
  return (
    <DashCard
      title="자습"
      desc={CARD_DESC.selfstudy}
      color={COLORS.selfstudy}
      href={buildLunaSettingsUrl("selfstudy", "history")}
      headExtra={
        <span className="shrink-0 whitespace-nowrap text-[10.5px] text-[#94a3b8]">
          다음 실행 {s.next_run_label}
        </span>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-[11px] text-[#94a3b8]">어제 제출 문답</p>
          <p className="text-[26px] font-medium leading-tight tabular-nums text-[#0f172a]">
            {s.yesterday_submitted}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#94a3b8]">자습 정확도</p>
          <p className="text-[26px] font-medium leading-tight tabular-nums text-[#0f172a]">
            {s.accuracy_pct != null ? `${s.accuracy_pct}%` : "—"}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#94a3b8]">오늘 막힌 순간</p>
          <p className="text-[26px] font-medium leading-tight tabular-nums text-[#0f172a]">
            {s.stuck_today}
          </p>
        </div>
      </div>
      <Divider />
      <RowItem
        label="최근 자습 주제"
        value={emDash(s.recent_topic ? clip(s.recent_topic, 36) : null)}
        truncate
      />
      <RowItem label='"안 배워도 됨" 판정 주간' value={s.not_needed_week} />
    </DashCard>
  );
}

function BrainCard({ b }: { b: LunaDashboard["brain"] }) {
  const tokenSuffix =
    b.tokens_delta_pct != null
      ? ` (${b.tokens_delta_pct >= 0 ? "+" : ""}${b.tokens_delta_pct}%)`
      : "";

  return (
    <DashCard
      title="두뇌"
      desc={CARD_DESC.brain}
      color={COLORS.brain}
      href={buildLunaSettingsUrl("brain", "prompts")}
    >
      <RowItem
        label="이번 주 변경"
        value={`루나 ${b.week_changes_luna} · 사람 ${b.week_changes_human}`}
      />
      <RowItem
        label="루나의 개선 제안 대기"
        value={b.revert_pending}
        coral={b.revert_pending > 0}
      />
      <RowItem
        label="최근 자기개선"
        value={
          b.latest_upgrade
            ? `${clip(b.latest_upgrade.title, 24)}${
                verifyLabel(b.latest_upgrade.verify_result)
                  ? ` · ${verifyLabel(b.latest_upgrade.verify_result)}`
                  : ""
              }`
            : "—"
        }
        truncate
      />
      <RowItem
        label="모델"
        value={
          b.models.length > 0
            ? b.models.map((m) => m.tier).join(" · ")
            : "—"
        }
      />
      <RowItem
        label="주간 토큰"
        value={
          b.tokens_week > 0
            ? `${b.tokens_week.toLocaleString()}${tokenSuffix}`
            : "—"
        }
      />
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
    <div>
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#534AB7] text-sm font-semibold text-white"
          aria-hidden
        >
          L
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-[#0f172a]">LUNA 대시보드</p>
          <p className="text-[12.5px] text-[#94a3b8]">
            {data?.date_label ?? "불러오는 중…"}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            router.push(buildLunaSettingsUrl("candidates", "mine"))
          }
          className="whitespace-nowrap rounded-full border border-[#D85A30]/35 bg-[#FAECE7]/60 px-3 py-1.5 text-[12px] font-medium text-[#993C1D]"
        >
          내가 답할 차례 {data?.my_turn_count ?? 0}건
        </button>
      </header>

      {loading ? (
        <p className="py-10 text-center text-[13px] text-[#94a3b8]">
          지표를 모으는 중…
        </p>
      ) : error ? (
        <p className="rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
        </p>
      ) : data && k && t && c && s && b ? (
        <>
          <div className="mb-3 hidden items-center gap-2 text-[11px] text-[#94a3b8] min-[900px]:flex">
            <div className="h-px flex-1 border-t border-dashed border-[#cbd5e1]" />
            <span className="shrink-0">확정된 지식만 기억으로</span>
            <span className="shrink-0 text-[#cbd5e1]" aria-hidden>
              ↩
            </span>
          </div>

          <div className="flex flex-col gap-3 min-[900px]:grid min-[900px]:grid-cols-[1fr_auto_1.15fr_auto_1fr] min-[900px]:items-stretch min-[900px]:gap-x-2 min-[900px]:gap-y-0">
            <KnowledgeCard k={k} />
            <FlowH lines={["지식으로", "답변"]} />
            <TalkCard t={t} />
            <FlowH lines={["대화로 얻은", "지식후보"]} />
            <CandidatesCard c={c} />
          </div>

          <div className="my-4 hidden flex-col items-center gap-1 text-[11px] text-[#94a3b8] min-[900px]:flex">
            <span aria-hidden>↓</span>
            <span>대화로 궁금한 점 · 막힌 순간 {s.stuck_today}개</span>
          </div>

          <div className="mt-0 flex flex-col gap-3 min-[900px]:mt-0 min-[900px]:grid min-[900px]:grid-cols-[1.2fr_1fr] min-[900px]:gap-3">
            <SelfstudyCard s={s} />
            <BrainCard b={b} />
          </div>
        </>
      ) : null}
    </div>
  );
}
