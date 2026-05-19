"use client";

import { useState } from "react";
import { ApiUsageDashboard } from "@/components/agents/api-usage-dashboard";
import { ApiUsageUpload } from "@/components/agents/api-usage-upload";

type UsageSubTab = "dashboard" | "upload";

const SUB_TABS: { id: UsageSubTab; label: string }[] = [
  { id: "dashboard", label: "사용량 대시보드" },
  { id: "upload", label: "데이터 업로드" }
];

/** API 사용량 탭 (CSV 업로드 + 대시보드) */
export function OpenAiUsageTab() {
  const [subTab, setSubTab] = useState<UsageSubTab>("dashboard");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" aria-label="API 사용량 서브탭">
        {SUB_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSubTab(item.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              subTab === item.id
                ? "bg-white text-violet-700 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {subTab === "dashboard" ? (
        <ApiUsageDashboard key={refreshKey} />
      ) : (
        <ApiUsageUpload
          onSaved={() => {
            setRefreshKey((k) => k + 1);
            setSubTab("dashboard");
          }}
        />
      )}
    </div>
  );
}
