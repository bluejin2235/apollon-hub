"use client";

import { useCallback, useEffect, useState } from "react";
import type { LunaDashboard } from "@/lib/luna/dashboard";
import { supabase } from "@/lib/supabase/client";

import type { LunaMenuSlug } from "@/lib/luna/settings-nav";

type Props = {
  onSelect: (slug: LunaMenuSlug, opts?: { filter?: string }) => void;
};

const COLORS = {
  knowledge: "#534AB7",
  talk: "#0F6E56",
  candidates: "#D85A30",
  selfstudy: "#534AB7",
  brain: "#BA7517"
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

function Metric({
  label,
  value,
  accent
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[12px]">
      <span className="text-slate-500">{label}</span>
      <span
        className={`font-medium tabular-nums ${
          accent ? "text-[#D85A30]" : "text-slate-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function DashCard({
  title,
  color,
  onClick,
  children,
  className = ""
}: {
  title: string;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:shadow-md ${className}`}
    >
      <div style={{ height: 3, background: color }} />
      <div className="p-3.5">
        <h3 className="mb-2.5 text-[13px] font-semibold text-slate-900">
          {title}
        </h3>
        <div className="space-y-1.5">{children}</div>
      </div>
    </button>
  );
}

function FlowArrow({
  label,
  className = ""
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`hidden items-center gap-1 text-[10.5px] text-slate-400 md:flex ${className}`}
      aria-hidden
    >
      <span className="max-w-[72px] leading-tight">{label}</span>
      <span className="text-slate-300">→</span>
    </div>
  );
}

function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-8 items-end gap-1">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm bg-[#D85A30]/25"
          style={{ height: `${Math.max(8, Math.round((v / max) * 100))}%` }}
          title={`${v}`}
        />
      ))}
    </div>
  );
}

export default function LunaSettingsHome({ onSelect }: Props) {
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
    <div className="rounded-xl bg-slate-50 p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-[#E4E2DA] bg-white"
          aria-hidden
        >
          <img
            src="/luna/luna-blink.webp"
            alt=""
            width={40}
            height={40}
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-slate-900">LUNA 대시보드</p>
          <p className="text-[12.5px] text-slate-500">
            {data?.date_label ?? "불러오는 중…"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onSelect("candidates", { filter: "mine" })}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#D85A30]/40 bg-white px-3 py-1.5 text-[12px] font-medium text-[#993C1D] transition hover:bg-[#FAECE7]"
        >
          내가 답할 차례
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#D85A30] px-1.5 text-[11px] font-semibold text-white">
            {data?.my_turn_count ?? 0}
          </span>
        </button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-[13px] text-slate-500">
          지표를 모으는 중…
        </p>
      ) : error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
        </p>
      ) : data && k && t && c && s && b ? (
        <>
          {/* desktop flow */}
          <div className="mb-2 hidden justify-end md:flex">
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className="border-t border-dashed border-slate-300 px-2 pt-0.5">
                확정된 지식만 기억으로
              </span>
              <span aria-hidden>↩</span>
            </div>
          </div>

          <div className="hidden md:block">
            <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-2">
              <DashCard
                title="지식"
                color={COLORS.knowledge}
                onClick={() => onSelect("knowledge")}
              >
                <Metric
                  label="확정"
                  value={`${k.active_count}(+${k.week_new})`}
                />
                <Metric
                  label="조직·개인"
                  value={`${k.org_count} : ${k.personal_count}`}
                />
                <Metric
                  label="Work서버"
                  value={
                    k.nas_last_total != null
                      ? `${k.nas_indexed.toLocaleString()} (스캔 ${k.nas_last_total.toLocaleString()})`
                      : k.nas_indexed.toLocaleString()
                  }
                />
                <Metric
                  label="노션"
                  value={k.notion_connected ? "연결" : "미연결"}
                />
                <Metric label="충돌 보류" value={k.conflict_count} accent={k.conflict_count > 0} />
                {k.top_used ? (
                  <p className="pt-1 text-[11px] text-slate-500">
                    최다 사용 · {clip(k.top_used.content, 36)} ({k.top_used.use_count})
                  </p>
                ) : null}
                {k.latest_confirmed ? (
                  <p className="text-[11px] text-slate-500">
                    최근 확정 · {clip(k.latest_confirmed.content, 36)}
                  </p>
                ) : null}
              </DashCard>

              <FlowArrow label="지식으로 답변" />

              <DashCard
                title="대화"
                color={COLORS.talk}
                onClick={() => onSelect("talk")}
              >
                <Metric
                  label="오늘·어제"
                  value={`${t.conversations_today} · ${t.conversations_yesterday}`}
                />
                <Metric
                  label="활성 사용자"
                  value={`${t.active_users_today}/${t.total_users}`}
                />
                <Metric
                  label="👍 · 👎"
                  value={`${t.thumbs_up_today} · ${t.thumbs_down_today}`}
                />
                <Metric
                  label="되물음"
                  value={`${t.clarify_today} · ${t.clarify_yesterday}`}
                />
                <Metric
                  label="정정"
                  value={`${t.corrections_today} · ${t.corrections_yesterday}`}
                />
                <Metric
                  label="검색0·재검색"
                  value={`${t.search_zero_today} · ${t.requery_today}`}
                />
                <Metric label="가정 확인" value={t.assume_today} />
              </DashCard>

              <FlowArrow label="대화로 얻은 지식후보" />

              <DashCard
                title="지식후보"
                color={COLORS.candidates}
                onClick={() => onSelect("candidates")}
              >
                <Metric label="대기" value={c.pending} accent />
                <Metric label="오늘 확정" value={c.confirmed_today} />
                <div className="pt-1">
                  <p className="mb-1 text-[11px] text-slate-500">주간 유입 4주</p>
                  <MiniBars values={c.weekly_inflow} />
                  {c.trend_label ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      {c.trend_label}
                    </p>
                  ) : null}
                </div>
                <Metric
                  label="출처"
                  value={`대화${c.by_source.chat}·자습${c.by_source.selfstudy}·질문${c.by_source.question}·직접${c.by_source.direct}`}
                />
                {c.avg_confirm_days != null ? (
                  <Metric label="평균 확정" value={`${c.avg_confirm_days}일`} />
                ) : null}
                <Metric label="내 차례" value={c.my_turn} accent={c.my_turn > 0} />
              </DashCard>
            </div>

            <div className="my-3 flex justify-center">
              <div className="flex flex-col items-center text-[11px] text-slate-400">
                <span>↓</span>
                <span>
                  대화로 궁금한 점 · 막힌 순간 {s.stuck_today}개
                </span>
              </div>
            </div>

            <div className="grid grid-cols-[1.4fr_1fr] gap-3">
              <DashCard
                title="자습"
                color={COLORS.selfstudy}
                onClick={() => onSelect("selfstudy")}
              >
                <Metric label="어제 제출" value={`${s.yesterday_submitted}건`} />
                {s.accuracy_pct != null ? (
                  <Metric label="자습 정확도" value={`${s.accuracy_pct}%`} />
                ) : null}
                <Metric label="오늘 막힌 순간" value={s.stuck_today} />
                <Metric label="다음 실행" value={s.next_run_label} />
                {s.recent_topic ? (
                  <p className="pt-1 text-[11px] text-slate-500">
                    최근 · {clip(s.recent_topic, 48)}
                  </p>
                ) : null}
                <Metric
                  label="안 배워도 됨(주간)"
                  value={s.not_needed_week}
                />
              </DashCard>

              <DashCard
                title="두뇌"
                color={COLORS.brain}
                onClick={() => onSelect("brain")}
              >
                <Metric label="프롬프트 활성" value={`${b.active_prompts}개`} />
                <Metric
                  label="이번 주 변경"
                  value={`루나 ${b.week_changes_luna} · 사람 ${b.week_changes_human}`}
                />
                <Metric
                  label="되돌림 제안"
                  value={b.revert_pending}
                  accent={b.revert_pending > 0}
                />
                {b.latest_upgrade ? (
                  <p className="pt-1 text-[11px] text-slate-500">
                    최근 개선 · {b.latest_upgrade.title}
                    {b.latest_upgrade.verify_result
                      ? ` (${b.latest_upgrade.verify_result})`
                      : ""}
                  </p>
                ) : null}
                <Metric
                  label="모델"
                  value={b.models.map((m) => `${m.tier}:${m.label.replace("Claude ", "")}`).join(" · ")}
                />
                <Metric
                  label="주간 토큰"
                  value={`${b.tokens_week.toLocaleString()}${
                    b.tokens_delta != null
                      ? ` (${b.tokens_delta >= 0 ? "+" : ""}${b.tokens_delta.toLocaleString()})`
                      : ""
                  }`}
                />
              </DashCard>
            </div>
          </div>

          {/* mobile stack */}
          <div className="flex flex-col gap-3 md:hidden">
            <DashCard
              title="지식"
              color={COLORS.knowledge}
              onClick={() => onSelect("knowledge")}
            >
              <Metric label="확정" value={`${k.active_count}(+${k.week_new})`} />
              <Metric
                label="조직·개인"
                value={`${k.org_count} : ${k.personal_count}`}
              />
              <Metric label="Work서버" value={k.nas_indexed.toLocaleString()} />
              <Metric
                label="노션"
                value={k.notion_connected ? "연결" : "미연결"}
              />
              <Metric label="충돌 보류" value={k.conflict_count} />
            </DashCard>
            <DashCard
              title="대화"
              color={COLORS.talk}
              onClick={() => onSelect("talk")}
            >
              <Metric
                label="오늘·어제"
                value={`${t.conversations_today} · ${t.conversations_yesterday}`}
              />
              <Metric
                label="활성"
                value={`${t.active_users_today}/${t.total_users}`}
              />
              <Metric
                label="👍·👎"
                value={`${t.thumbs_up_today} · ${t.thumbs_down_today}`}
              />
              <Metric
                label="되물음·정정"
                value={`${t.clarify_today} · ${t.corrections_today}`}
              />
              <Metric
                label="검색0·재검색"
                value={`${t.search_zero_today} · ${t.requery_today}`}
              />
              <Metric label="가정 확인" value={t.assume_today} />
            </DashCard>
            <DashCard
              title="지식후보"
              color={COLORS.candidates}
              onClick={() => onSelect("candidates")}
            >
              <Metric label="대기" value={c.pending} accent />
              <Metric label="오늘 확정" value={c.confirmed_today} />
              <MiniBars values={c.weekly_inflow} />
              {c.trend_label ? (
                <p className="text-[11px] text-slate-500">{c.trend_label}</p>
              ) : null}
              <Metric label="내 차례" value={c.my_turn} accent={c.my_turn > 0} />
            </DashCard>
            <DashCard
              title="자습"
              color={COLORS.selfstudy}
              onClick={() => onSelect("selfstudy")}
            >
              <Metric label="어제 제출" value={`${s.yesterday_submitted}건`} />
              {s.accuracy_pct != null ? (
                <Metric label="정확도" value={`${s.accuracy_pct}%`} />
              ) : null}
              <Metric label="막힌 순간" value={s.stuck_today} />
              <Metric label="다음 실행" value={s.next_run_label} />
            </DashCard>
            <DashCard
              title="두뇌"
              color={COLORS.brain}
              onClick={() => onSelect("brain")}
            >
              <Metric label="프롬프트" value={`${b.active_prompts}개`} />
              <Metric
                label="이번 주 변경"
                value={`루나 ${b.week_changes_luna} · 사람 ${b.week_changes_human}`}
              />
              <Metric label="되돌림 제안" value={b.revert_pending} />
              <Metric
                label="주간 토큰"
                value={b.tokens_week.toLocaleString()}
              />
            </DashCard>
          </div>
        </>
      ) : null}
    </div>
  );
}
