import type { DevnoteStatus } from "@/lib/devnote/types";

const DOT: Record<DevnoteStatus, string> = {
  live: "bg-[#1E7A55]",
  wip: "bg-[#2B5BD7]",
  stuck: "bg-[#B4541A]",
  doc: "bg-[#E2E5EA]"
};

export function DevnoteStatusDot({
  status
}: {
  status?: DevnoteStatus | "plain";
}) {
  const color = status && status !== "plain" ? DOT[status] : "bg-[#E2E5EA]";
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${color}`}
      aria-hidden
    />
  );
}
