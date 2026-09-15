import type { DevnoteStatus } from "@/lib/devnote/types";
import { STATUS_LABEL } from "@/lib/devnote/types";

const BADGE: Record<DevnoteStatus, string> = {
  live: "bg-[#EAF5F0] text-[#1E7A55]",
  wip: "bg-[#EEF2FD] text-[#2B5BD7]",
  stuck: "bg-[#FCF1E8] text-[#B4541A]",
  doc: "bg-[#F2F0F7] text-[#5B4B8A]"
};

export function DevnoteStatusBadge({ status }: { status: DevnoteStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
