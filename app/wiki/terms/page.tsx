"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { GlossaryBrowser } from "@/components/glossary/GlossaryBrowser";
import { useWikiDrawer } from "@/components/wiki/wiki-drawer";
import { W } from "@/components/wiki/wiki-theme";

export default function WikiTermsPage() {
  const router = useRouter();
  const drawer = useWikiDrawer();
  const [pendingCandidates, setPendingCandidates] = useState(0);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-start gap-2.5 px-4 pt-[15px] md:px-4">
        <button
          type="button"
          aria-label="메뉴 열기"
          onClick={() => drawer.open()}
          className="-ml-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[16px] font-extrabold tracking-[-0.2px]">
            용어사전
          </h1>
          <div className="mt-px text-[11px]" style={{ color: W.faint }}>
            아폴론 공통 용어를 한 곳에서 · 누구나 수정, 이력 기록
          </div>
        </div>
        {pendingCandidates > 0 ? (
          <button
            type="button"
            onClick={() =>
              router.push(
                "/settings?tab=luna&luna=candidates&sub=pending&filter=glossary"
              )
            }
            className="shrink-0 rounded-[16px] px-[11px] py-[5px] text-[11px] font-bold"
            style={{ background: "#FDECEA", color: "#C0392B" }}
          >
            확인 필요 {pendingCandidates}
          </button>
        ) : null}
      </div>
      <GlossaryBrowser
        onMeta={(meta) => setPendingCandidates(meta.pendingCandidates)}
      />
    </main>
  );
}
