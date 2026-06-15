"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AiCostOverview } from "@/components/agents/ai-cost-overview";
import { ApiUsageDashboard } from "@/components/agents/api-usage-dashboard";
import { CreditRecordsTab } from "@/components/agents/credit-records-tab";
import { supabase } from "@/lib/supabase/client";

type AgentsTab = "overview" | "usage" | "credits";

type ServiceInfo = { name: string; description: string };

const TABS: { id: AgentsTab; label: string }[] = [
  { id: "overview", label: "Dashboard" },
  { id: "usage", label: "API사용량내역" },
  { id: "credits", label: "Credit결제내역" }
];

export default function AgentsPage() {
  const [tab, setTab] = useState<AgentsTab>("overview");
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

      <nav className="flex flex-wrap gap-1 border-b border-slate-200" aria-label="AI 비용 메뉴">
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

      {tab === "overview" ? (
        <AiCostOverview onTabChange={setTab} />
      ) : null}
      {tab === "usage" ? <ApiUsageDashboard /> : null}
      {tab === "credits" ? <CreditRecordsTab /> : null}
    </div>
  );
}
