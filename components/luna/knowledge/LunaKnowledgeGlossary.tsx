"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GlossaryBrowser,
  type GlossaryBrowserMeta
} from "@/components/glossary/GlossaryBrowser";
import {
  KnowledgeShell,
  StatCard,
  StatGrid
} from "@/components/luna/knowledge/ui";
import type { GlossaryStats } from "@/lib/glossary/types";

export function LunaKnowledgeGlossary() {
  const router = useRouter();
  const [stats, setStats] = useState<GlossaryStats | null>(null);

  const categoryLine = useMemo(() => {
    if (!stats?.by_category) return "—";
    const { common, interior, hw } = stats.by_category;
    if (common == null && interior == null && hw == null) return "—";
    return `${common ?? "—"} / ${interior ?? "—"} / ${hw ?? "—"}`;
  }, [stats]);

  function handleMeta(meta: GlossaryBrowserMeta) {
    setStats(meta.stats);
  }

  return (
    <KnowledgeShell>
      <GlossaryBrowser
        includeStats
        onMeta={handleMeta}
        topSlot={
          <StatGrid>
            <StatCard label="전체 용어" value={stats ? stats.total : "—"} />
            <StatCard
              label="공통 / 인테리어 / HW"
              value={categoryLine}
              small
            />
            <StatCard
              label="이번 주 수정"
              value={stats ? stats.week_updated : "—"}
            />
            <StatCard
              label="확인 대기 후보"
              value={stats ? stats.pending_candidates : "—"}
              valueClassName={
                stats && stats.pending_candidates > 0
                  ? "text-[#993C1D]"
                  : undefined
              }
              onClick={() =>
                router.push(
                  "/settings?tab=luna&luna=candidates&sub=pending&filter=glossary"
                )
              }
            />
          </StatGrid>
        }
      />
    </KnowledgeShell>
  );
}
