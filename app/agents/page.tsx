"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Key, Upload } from "lucide-react";
import { AiCostOverview } from "@/components/agents/ai-cost-overview";
import { ApiUsageUploadModal } from "@/components/agents/api-usage-upload-modal";
import {
  AGENTS_NAV,
  agentsTabKeyToId,
  parseAgentsTabKey,
  type AgentsTabId,
  type AgentsTabKey
} from "@/components/agents/agents-nav";
import { ApiUsageDashboard } from "@/components/agents/api-usage-dashboard";
import { CreditRecordsTab } from "@/components/agents/credit-records-tab";
import { OpenAiKeyNameMapModal } from "@/components/agents/openai-key-name-map-modal";
import { supabase } from "@/lib/supabase/client";

type ServiceInfo = { name: string; description: string };

export default function AgentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabKey = parseAgentsTabKey(searchParams.get("tab"));
  const tab: AgentsTabId = agentsTabKeyToId(tabKey);
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [usageModal, setUsageModal] = useState<"upload" | "keys" | null>(null);
  const [usageRefreshKey, setUsageRefreshKey] = useState(0);

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
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
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
          </div>

          {tab === "usage" ? (
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setUsageModal("keys")}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <Key className="h-4 w-4" aria-hidden />
                API 키 이름 관리
              </button>
              <button
                type="button"
                onClick={() => setUsageModal("upload")}
                className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-violet-500"
              >
                <Upload className="h-4 w-4" aria-hidden />
                CSV 업로드
              </button>
            </div>
          ) : null}
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
        {tab === "usage" ? <ApiUsageDashboard refreshKey={usageRefreshKey} /> : null}
        {tab === "credits" ? <CreditRecordsTab /> : null}
      </div>

      <ApiUsageUploadModal
        open={usageModal === "upload"}
        onClose={() => setUsageModal(null)}
        onSaved={() => setUsageRefreshKey((k) => k + 1)}
      />
      <OpenAiKeyNameMapModal open={usageModal === "keys"} onClose={() => setUsageModal(null)} />
    </>
  );
}
