"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AiCostOverview } from "@/components/agents/ai-cost-overview";
import {
  AGENTS_NAV,
  AgentsMobileBottomNav,
  agentsTabKeyToId,
  parseAgentsTabKey,
  type AgentsTabId,
  type AgentsTabKey
} from "@/components/agents/agents-nav";
import { ApiUsageDashboard } from "@/components/agents/api-usage-dashboard";
import { CreditRecordsTab } from "@/components/agents/credit-records-tab";
import { supabase } from "@/lib/supabase/client";

type ServiceInfo = { name: string; description: string };

export default function AgentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabKey = parseAgentsTabKey(searchParams.get("tab"));
  const tab: AgentsTabId = agentsTabKeyToId(tabKey);
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);

  const navigateTab = (nextTabKey: AgentsTabKey) => {
    router.push(`/agents?tab=${nextTabKey}`);
  };

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
    <>
      <div className="space-y-6">
        <header>
          <Link
            href="/agents?tab=dashboard"
            className="text-2xl font-bold text-slate-900 transition hover:text-violet-700"
          >
            {serviceInfo?.name ?? "AI 비용 관리"}
          </Link>
          <p className="mt-1 text-sm text-slate-600">
            {serviceInfo?.description ??
              "Anthropic · OpenAI 등 AI 서비스의 API 사용량과 크레딧 충전 비용을 통합 관리합니다."}
          </p>
        </header>

        <nav
          className="hidden flex-wrap gap-1 border-b border-slate-200 md:flex"
          aria-label="AI 비용 메뉴"
        >
          {AGENTS_NAV.map((item) => (
            <button
              key={item.tabKey}
              type="button"
              onClick={() => navigateTab(item.tabKey)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                tabKey === item.tabKey
                  ? "border-violet-600 text-violet-700"
                  : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {tab === "overview" ? (
          <AiCostOverview onTabChange={(nextTab) => navigateTab(nextTab === "usage" ? "api" : "credit")} />
        ) : null}
        {tab === "usage" ? <ApiUsageDashboard /> : null}
        {tab === "credits" ? <CreditRecordsTab /> : null}
      </div>

      <AgentsMobileBottomNav activeTabKey={tabKey} />
    </>
  );
}
