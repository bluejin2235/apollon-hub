"use client";
import { useState } from "react";
import { AgentListTab } from "@/components/agents/agent-list-tab";
import { AiCostOverview } from "@/components/agents/ai-cost-overview";
import { ApiUsageDashboard } from "@/components/agents/api-usage-dashboard";
import { CreditRecordsTab } from "@/components/agents/credit-records-tab";

type AgentsTab = "overview" | "usage" | "credits" | "list";

const TABS: { id: AgentsTab; label: string }[] = [
  { id: "overview", label: "AI 비용 현황" },
  { id: "usage", label: "API 사용량" },
  { id: "credits", label: "크레딧 · 추가 결제" },
  { id: "list", label: "에이전트 목록" }
];

export default function AgentsPage() {
  const [tab, setTab] = useState<AgentsTab>("overview");
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">아르테</h1>
        <p className="mt-1 text-sm text-slate-600">
          팀 AI 에이전트와 API 사용량(CSV 업로드)을 관리합니다.
        </p>
      </header>
      <nav className="flex flex-wrap gap-1 border-b border-slate-200" aria-label="아르테 메뉴">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === item.id
                ? "border-violet-600 text-violet-700"
                : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {tab === "overview" && (
        <AiCostOverview onTabChange={(t) => setTab(t)} />
      )}
      {tab === "usage" && <ApiUsageDashboard />}
      {tab === "credits" && <CreditRecordsTab />}
      {tab === "list" && <AgentListTab />}
    </div>
  );
}
