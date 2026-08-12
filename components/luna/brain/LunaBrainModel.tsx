"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Btn,
  ErrorLine,
  FieldInput,
  FieldSelect,
  KnowledgeShell,
  ListCard,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import {
  BarChart,
  BrainCard,
  brainFetch,
  BtnRow,
  formatTokens,
  SectionTitle
} from "@/components/luna/brain/shared";
import {
  LUNA_MODEL_OPTIONS,
  LUNA_TIER_META,
  LUNA_USAGE_ALERTS_DEFAULT,
  type LunaUsageAlerts
} from "@/lib/luna/brain-models";
import { K } from "@/lib/luna/knowledge-format";

type TierRow = {
  tier: string;
  provider: string;
  model_id: string;
  model_label: string;
  use_caching: boolean;
  use_batch: boolean;
};

type UsageResponse = {
  tiers: TierRow[];
  daily: Array<{ date: string; tokens: number }>;
  stats: {
    week_tokens: number;
    week_change_pct: number | null;
    today_tokens: number;
    talk_ratio: number | null;
    month_tokens: number;
  };
  alerts: LunaUsageAlerts;
};

const TAG_STYLE: Record<string, { bg: string; color: string }> = {
  A: { bg: K.lunaSoft, color: K.lunaInk },
  B: { bg: K.talkSoft, color: K.talk },
  C: { bg: K.brainSoft, color: K.brainInk }
};

function Stat({
  label,
  value,
  sub,
  subColor
}: {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
}) {
  return (
    <div className="rounded-[9px] px-3 py-2.5" style={{ background: K.panel }}>
      <div className="text-[11.5px]" style={{ color: K.sub }}>
        {label}
      </div>
      <div className="mt-0.5 text-[19px] font-bold">{value}</div>
      {sub ? (
        <div className="text-[11.5px]" style={{ color: subColor ?? K.faint }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

/** "2026-08-06" → "8/6" */
function barLabel(date: string): string {
  const [, m, d] = date.split("-");
  if (!m || !d) return date;
  return `${Number(m)}/${Number(d)}`;
}

export function LunaBrainModel() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [alerts, setAlerts] = useState<LunaUsageAlerts>({
    ...LUNA_USAGE_ALERTS_DEFAULT
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const json = await brainFetch<UsageResponse>("/api/luna/brain/usage");
      setData(json);
      setAlerts(json.alerts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeModel(tier: string, modelId: string) {
    const option = LUNA_MODEL_OPTIONS.find((m) => m.model_id === modelId);
    if (!option) return;
    const current = data?.tiers.find((t) => t.tier === tier);
    setBusy(true);
    setNotice("");
    try {
      await brainFetch("/api/luna/engine", {
        method: "PATCH",
        body: JSON.stringify({
          tier,
          provider: option.provider,
          model_id: option.model_id,
          model_label: option.model_label,
          use_caching: current?.use_caching ?? false,
          use_batch: current?.use_batch ?? false
        })
      });
      setNotice(`${tier}등급을 ${option.model_label}로 바꿨습니다.`);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "모델을 바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAlerts() {
    setBusy(true);
    setNotice("");
    try {
      const res = await brainFetch<{ alerts: LunaUsageAlerts }>(
        "/api/luna/brain/usage",
        { method: "PATCH", body: JSON.stringify(alerts) }
      );
      setAlerts(res.alerts);
      setNotice("사용량 알림 설정을 저장했습니다.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const stats = data?.stats;
  const talkRatio = stats?.talk_ratio ?? null;

  return (
    <KnowledgeShell>
      {notice ? (
        <p className="mb-2.5 text-[12px]" style={{ color: K.luna }}>
          {notice}
        </p>
      ) : null}
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <LoadingLine /> : null}

      {!loading && !error && data ? (
        <>
          <SectionTitle>모델 지정</SectionTitle>
          <ListCard>
            {LUNA_TIER_META.map((meta) => {
              const row = data.tiers.find((t) => t.tier === meta.tier);
              const tag = TAG_STYLE[meta.tier] ?? TAG_STYLE.A!;
              const known = LUNA_MODEL_OPTIONS.some(
                (m) => m.model_id === row?.model_id
              );
              return (
                <div
                  key={meta.tier}
                  className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0"
                  style={{ borderColor: K.line2 }}
                >
                  <span
                    className="w-[26px] rounded-[20px] px-2 py-0.5 text-center text-[10.5px] font-extrabold"
                    style={{ background: tag.bg, color: tag.color }}
                  >
                    {meta.tier}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px]">{meta.name}</div>
                    <div className="text-[11.5px]" style={{ color: K.sub }}>
                      {meta.desc}
                    </div>
                  </div>
                  <FieldSelect
                    className="w-[190px]"
                    disabled={busy}
                    value={known ? row!.model_id : ""}
                    onChange={(e) => void changeModel(meta.tier, e.target.value)}
                  >
                    {!known ? (
                      <option value="">{row?.model_label ?? "지정 안 됨"}</option>
                    ) : null}
                    {LUNA_MODEL_OPTIONS.map((m) => (
                      <option key={m.model_id} value={m.model_id}>
                        {m.model_label}
                      </option>
                    ))}
                  </FieldSelect>
                </div>
              );
            })}
          </ListCard>

          <div className="mt-3.5 grid grid-cols-2 gap-2.5 min-[901px]:grid-cols-4">
            <Stat
              label="주간 토큰"
              value={formatTokens(stats?.week_tokens)}
              sub={
                stats?.week_change_pct != null
                  ? `${stats.week_change_pct >= 0 ? "+" : ""}${stats.week_change_pct}%`
                  : undefined
              }
              subColor={
                stats?.week_change_pct != null && stats.week_change_pct > 0
                  ? K.candInk
                  : K.talk
              }
            />
            <Stat label="오늘" value={formatTokens(stats?.today_tokens)} />
            <Stat
              label="대화 : 배치"
              value={talkRatio == null ? "—" : `${talkRatio}:${100 - talkRatio}`}
            />
            <Stat label="월 누적" value={formatTokens(stats?.month_tokens)} />
          </div>

          <div className="mt-3">
            <BrainCard>
              <div className="text-[13.5px] font-bold">
                일별 토큰 사용 (최근 7일)
              </div>
              <BarChart
                bars={data.daily.map((d) => ({
                  label: barLabel(d.date),
                  value: d.tokens
                }))}
              />
            </BrainCard>

            <BrainCard>
              <div className="text-[13.5px] font-bold">사용량 알림</div>
              <div
                className="mb-3 mt-1 text-[11.5px]"
                style={{ color: K.faint }}
              >
                한도를 넘으면 알림만 보냅니다. 서비스는 중단되지 않아요.
              </div>
              <div className="grid grid-cols-1 gap-3 min-[901px]:grid-cols-3">
                <label className="block">
                  <span
                    className="mb-1 block text-[12px]"
                    style={{ color: K.sub }}
                  >
                    일 한도 (토큰)
                  </span>
                  <FieldInput
                    className="w-full"
                    type="number"
                    min={0}
                    value={alerts.daily_limit}
                    onChange={(e) =>
                      setAlerts({
                        ...alerts,
                        daily_limit: Number(e.target.value) || 0
                      })
                    }
                  />
                </label>
                <label className="block">
                  <span
                    className="mb-1 block text-[12px]"
                    style={{ color: K.sub }}
                  >
                    월 한도 (토큰)
                  </span>
                  <FieldInput
                    className="w-full"
                    type="number"
                    min={0}
                    value={alerts.monthly_limit}
                    onChange={(e) =>
                      setAlerts({
                        ...alerts,
                        monthly_limit: Number(e.target.value) || 0
                      })
                    }
                  />
                </label>
                <label className="block">
                  <span
                    className="mb-1 block text-[12px]"
                    style={{ color: K.sub }}
                  >
                    급증 기준 (전일 대비 %)
                  </span>
                  <FieldInput
                    className="w-full"
                    type="number"
                    min={0}
                    value={alerts.spike_percent}
                    onChange={(e) =>
                      setAlerts({
                        ...alerts,
                        spike_percent: Number(e.target.value) || 0
                      })
                    }
                  />
                </label>
              </div>
              <BtnRow>
                <Btn primary disabled={busy} onClick={() => void saveAlerts()}>
                  저장
                </Btn>
              </BtnRow>
            </BrainCard>
          </div>
        </>
      ) : null}
    </KnowledgeShell>
  );
}
