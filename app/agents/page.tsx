"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AgentListTab } from "@/components/agents/agent-list-tab";
import { AiCostOverview } from "@/components/agents/ai-cost-overview";
import { ApiUsageDashboard } from "@/components/agents/api-usage-dashboard";
import { CreditRecordsTab } from "@/components/agents/credit-records-tab";
import { supabase } from "@/lib/supabase/client";

type MainTab = "ai_cost" | "list";
type SubTab = "overview" | "usage" | "credits";

type ServiceInfo = { name: string; description: string };

const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: "ai_cost", label: "AI 비용 현황" },
  { id: "list", label: "에이전트 목록" }
];

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "overview", label: "Dashboard" },
  { id: "usage", label: "API 사용량" },
  { id: "credits", label: "Credit 추가결제" }
];

export default function AgentsPage() {
  const [mainTab, setMainTab] = useState<MainTab>("ai_cost");
  const [subTab, setSubTab] = useState<SubTab>("overview");
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("services")
        .select("name, description")
        .eq("url", "/agents")
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error("[agents] service info fetch failed", error);
        return;
      }
      if (data?.name) {
        setServiceInfo({
          name: data.name,
          description: data.description?.trim() ?? ""
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/agents"
          className="text-2xl font-bold text-slate-900 transition hover:text-violet-700"
        >
          {serviceInfo?.name ?? "AI 비용 관리"}
        </Link>
        <p className="mt-1 text-sm text-slate-600">
          {serviceInfo?.description ??
            "Anthropic · OpenAI 등 AI 서비스의 API 사용량과 크레딧 충전 비용을 통합 관리합니다."}
        </p>
      </header>

      <div>
        <nav className="flex flex-wrap gap-1 border-b border-slate-200" aria-label="아르테 메인 메뉴">
          {MAIN_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMainTab(item.id)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                mainTab === item.id
                  ? "border-violet-600 text-violet-700"
                  : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {mainTab === "ai_cost" ? (
          <nav className="mb-0 mt-0.5 flex flex-wrap gap-1" aria-label="AI 비용 서브 메뉴">
            {SUB_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSubTab(item.id)}
                className={`px-4 py-2 text-[12.1px] transition ${
                  subTab === item.id
                    ? "border-b-2 border-violet-700 font-medium text-violet-700"
                    : "border-none text-slate-500 hover:text-slate-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        ) : null}
      </div>

      {mainTab === "ai_cost" && subTab === "overview" ? (
        <AiCostOverview
          onTabChange={(t) => {
            setMainTab("ai_cost");
            setSubTab(t);
          }}
        />
      ) : null}
      {mainTab === "ai_cost" && subTab === "usage" ? <ApiUsageDashboard /> : null}
      {mainTab === "ai_cost" && subTab === "credits" ? <CreditRecordsTab /> : null}
      {mainTab === "list" ? <AgentListTab /> : null}
    </div>
  );
}
