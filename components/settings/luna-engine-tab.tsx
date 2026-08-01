"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type TierRow = {
  tier: "A" | "B" | "C";
  provider: string;
  model_id: string;
  model_label: string;
  use_caching: boolean;
  use_batch: boolean;
  note: string | null;
};

type UsageByTier = {
  tier: string;
  model_id: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
};

type UsageSummary = {
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  cache_read_tokens: number;
  cache_read_pct: number;
  by_tier: UsageByTier[];
};

type Connections = {
  anthropic: boolean;
  openai: boolean;
  gemini: boolean;
  tavily: boolean;
  notion: boolean;
};

const CONNECTION_LABELS: { key: keyof Connections; label: string }[] = [
  { key: "anthropic", label: "Anthropic" },
  { key: "openai", label: "OpenAI" },
  { key: "gemini", label: "Gemini" },
  { key: "tavily", label: "Tavily" },
  { key: "notion", label: "Notion" }
];

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function formatNum(n: number): string {
  return n.toLocaleString("ko-KR");
}

export function LunaEngineTab() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [connections, setConnections] = useState<Connections | null>(null);
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, TierRow>>({});
  const [savingTier, setSavingTier] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    const res = await fetch("/api/luna/engine", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setMessage(`불러오기 실패: ${await res.text()}`);
      setLoading(false);
      return;
    }
    const json = (await res.json()) as {
      connections?: Connections;
      tiers?: TierRow[];
      usage?: UsageSummary;
    };
    setConnections(json.connections ?? null);
    const list = (json.tiers ?? []) as TierRow[];
    setTiers(list);
    const nextDrafts: Record<string, TierRow> = {};
    for (const t of list) nextDrafts[t.tier] = { ...t };
    setDrafts(nextDrafts);
    setUsage(json.usage ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveTier(tier: string) {
    const draft = drafts[tier];
    if (!draft) return;
    setSavingTier(tier);
    setMessage("");
    const token = await getAccessToken();
    if (!token) {
      setSavingTier(null);
      return;
    }
    const res = await fetch("/api/luna/engine", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tier: draft.tier,
        provider: draft.provider,
        model_id: draft.model_id,
        model_label: draft.model_label,
        use_caching: draft.use_caching,
        use_batch: draft.use_batch
      })
    });
    setSavingTier(null);
    if (!res.ok) {
      setMessage(`저장 실패: ${await res.text()}`);
      return;
    }
    setMessage(`${tier}등급을 저장했습니다.`);
    await load();
  }

  if (loading) {
    return <div className="text-sm text-slate-400">불러오는 중…</div>;
  }

  return (
    <div className="space-y-6">
      {message ? <p className="text-[12px] text-slate-600">{message}</p> : null}

      {/* 섹션 1 */}
      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-slate-900">연결 상태</h3>
        <div className="space-y-1.5">
          {CONNECTION_LABELS.map(({ key, label }) => {
            const ok = connections?.[key] === true;
            return (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-2.5 py-2"
              >
                <span className="text-[13px] text-slate-800">{label}</span>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] ${
                    ok
                      ? "bg-[#E1F5EE] text-[#04342C]"
                      : "bg-[#F1EFE8] text-[#5F5E5A]"
                  }`}
                >
                  {ok ? "연결됨" : "미연결"}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          API 키는 Vercel 환경변수에서 관리합니다
        </p>
      </section>

      {/* 섹션 2 */}
      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-slate-900">등급별 모델</h3>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-2 font-medium">등급</th>
                <th className="px-2 py-2 font-medium">쓰는 곳</th>
                <th className="px-2 py-2 font-medium">provider</th>
                <th className="px-2 py-2 font-medium">model_id</th>
                <th className="px-2 py-2 font-medium">model_label</th>
                <th className="px-2 py-2 font-medium">캐싱</th>
                <th className="px-2 py-2 font-medium">배치</th>
                <th className="px-2 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => {
                const d = drafts[t.tier] ?? t;
                return (
                  <tr key={t.tier} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-mono font-medium text-slate-800">
                      {t.tier}
                    </td>
                    <td className="max-w-[140px] px-2 py-2 text-[11px] text-slate-500">
                      {t.note || "-"}
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={d.provider}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [t.tier]: { ...d, provider: e.target.value }
                          }))
                        }
                        className="rounded border border-slate-200 px-1.5 py-1 text-[12px]"
                      >
                        <option value="anthropic">anthropic</option>
                        <option value="openai">openai</option>
                        <option value="google">google</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={d.model_id}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [t.tier]: { ...d, model_id: e.target.value }
                          }))
                        }
                        className="w-[160px] rounded border border-slate-200 px-1.5 py-1 font-mono text-[11px]"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={d.model_label}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [t.tier]: { ...d, model_label: e.target.value }
                          }))
                        }
                        className="w-[140px] rounded border border-slate-200 px-1.5 py-1 text-[12px]"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDrafts((prev) => ({
                            ...prev,
                            [t.tier]: { ...d, use_caching: !d.use_caching }
                          }))
                        }
                        className={`rounded-full border border-solid px-2 py-px text-[9px] ${
                          d.use_caching
                            ? "border-[#0F6E56] bg-[#E1F5EE] text-[#04342C]"
                            : "border-[#D3D1C7] bg-transparent text-gray-500"
                        }`}
                      >
                        {d.use_caching ? "ON" : "OFF"}
                      </button>
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDrafts((prev) => ({
                            ...prev,
                            [t.tier]: { ...d, use_batch: !d.use_batch }
                          }))
                        }
                        className={`rounded-full border border-solid px-2 py-px text-[9px] ${
                          d.use_batch
                            ? "border-[#0F6E56] bg-[#E1F5EE] text-[#04342C]"
                            : "border-[#D3D1C7] bg-transparent text-gray-500"
                        }`}
                      >
                        {d.use_batch ? "ON" : "OFF"}
                      </button>
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        disabled={savingTier === t.tier}
                        onClick={() => void saveTier(t.tier)}
                        className="rounded bg-[#534AB7] px-2.5 py-1 text-[11px] text-white disabled:opacity-40"
                      >
                        저장
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 섹션 3 */}
      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-slate-900">이번 달 사용량</h3>
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-slate-50 px-2.5 py-[9px]">
            <div className="text-[11px] text-slate-500">총 호출 수</div>
            <div className="mt-0.5 text-[15px] font-medium text-slate-900">
              {formatNum(usage?.total_calls ?? 0)}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2.5 py-[9px]">
            <div className="text-[11px] text-slate-500">총 입력 토큰</div>
            <div className="mt-0.5 text-[15px] font-medium text-slate-900">
              {formatNum(usage?.total_input_tokens ?? 0)}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2.5 py-[9px]">
            <div className="text-[11px] text-slate-500">총 출력 토큰</div>
            <div className="mt-0.5 text-[15px] font-medium text-slate-900">
              {formatNum(usage?.total_output_tokens ?? 0)}
            </div>
          </div>
        </div>
        <p className="mb-3 text-[12px] text-slate-600">
          캐시 절감: 캐시 읽기 {formatNum(usage?.cache_read_tokens ?? 0)} 토큰
          {usage && usage.total_input_tokens > 0
            ? ` · 전체 입력 대비 ${usage.cache_read_pct}%`
            : ""}
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2.5 py-2 font-medium">등급</th>
                <th className="px-2.5 py-2 font-medium">모델</th>
                <th className="px-2.5 py-2 font-medium">호출 수</th>
                <th className="px-2.5 py-2 font-medium">입력</th>
                <th className="px-2.5 py-2 font-medium">출력</th>
                <th className="px-2.5 py-2 font-medium">캐시 읽기</th>
              </tr>
            </thead>
            <tbody>
              {(usage?.by_tier ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2.5 py-4 text-center text-slate-400">
                    이번 달 사용 기록이 없습니다.
                  </td>
                </tr>
              ) : (
                (usage?.by_tier ?? []).map((row) => (
                  <tr
                    key={`${row.tier}-${row.model_id}`}
                    className="border-t border-slate-100"
                  >
                    <td className="px-2.5 py-2 font-mono text-slate-800">{row.tier}</td>
                    <td className="px-2.5 py-2 font-mono text-[11px] text-slate-600">
                      {row.model_id}
                    </td>
                    <td className="px-2.5 py-2">{formatNum(row.calls)}</td>
                    <td className="px-2.5 py-2">{formatNum(row.input_tokens)}</td>
                    <td className="px-2.5 py-2">{formatNum(row.output_tokens)}</td>
                    <td className="px-2.5 py-2">{formatNum(row.cache_read_tokens)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
