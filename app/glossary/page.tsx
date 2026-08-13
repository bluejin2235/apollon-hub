"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Menu } from "lucide-react";
import { GlossaryBrowser } from "@/components/glossary/GlossaryBrowser";
import { LunaShell } from "@/components/luna/LunaShell";
import { LunaSidebar } from "@/components/luna/LunaSidebar";

const C = {
  sub: "#6b6f76",
  luna: "#534AB7",
  cand: "#D85A30",
  candSoft: "#FAECE7",
  candInk: "#993C1D"
};

export default function GlossaryPage() {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingCandidates, setPendingCandidates] = useState(0);

  return (
    <LunaShell
      drawerOpen={drawerOpen}
      onCloseDrawer={() => setDrawerOpen(false)}
      sidebar={<LunaSidebar />}
    >
      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">
        <div className="mb-3.5 flex items-center gap-2.5">
          <button
            type="button"
            aria-label="메뉴 열기"
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
          >
            <Menu className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <BookOpen
            className="hidden h-[18px] w-[18px] shrink-0 md:block"
            style={{ color: C.luna }}
            strokeWidth={1.9}
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-[16px] font-extrabold tracking-[-0.2px]">용어사전</h1>
            <div className="mt-px text-[11.5px]" style={{ color: C.sub }}>
              아폴론 공통 용어를 한 곳에서 · 누구나 수정, 이력 기록
            </div>
          </div>
          {pendingCandidates > 0 ? (
            <button
              type="button"
              onClick={() =>
                router.push("/settings?tab=luna&luna=candidates&sub=pending&filter=glossary")
              }
              className="shrink-0 rounded-[20px] border px-[13px] py-1.5 text-[12px] font-bold"
              style={{
                background: C.candSoft,
                color: C.candInk,
                borderColor: "#f3d9cf"
              }}
            >
              확인 필요 {pendingCandidates}
            </button>
          ) : null}
        </div>

        <GlossaryBrowser
          onMeta={(meta) => setPendingCandidates(meta.pendingCandidates)}
        />
      </main>
    </LunaShell>
  );
}
