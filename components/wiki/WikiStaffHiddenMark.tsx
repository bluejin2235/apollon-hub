import { Lock } from "lucide-react";
import { W } from "@/components/wiki/wiki-theme";

export function WikiStaffHiddenMark({ compact }: { compact?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[9px] px-1.5 py-[2px] text-[9px] font-bold"
      style={{ background: W.lockBg, color: W.lock }}
      title="직원에게 안 보임"
    >
      <Lock className="h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden />
      {compact ? null : "직원에게 안 보임"}
    </span>
  );
}
