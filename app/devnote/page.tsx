import { Suspense } from "react";
import { DevnoteOverviewScreen } from "@/components/devnote/devnote-overview-screen";

export default function DevnoteOverviewPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[#858C9A]">불러오는 중…</p>}>
      <DevnoteOverviewScreen />
    </Suspense>
  );
}
