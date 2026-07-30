"use client";

export type LunaConversation = {
  id: string;
  title: string;
  engine: string;
  created_at: string;
  updated_at: string;
};

type LunaSidebarProps = {
  conversations: LunaConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  className?: string;
};

type DateGroup = "오늘" | "어제" | "이번 주" | "이전";

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function groupLabel(iso: string, now = new Date()): DateGroup {
  const updated = startOfDay(new Date(iso));
  const today = startOfDay(now);
  const diffDays = Math.round((today.getTime() - updated.getTime()) / 86_400_000);

  if (diffDays <= 0) return "오늘";
  if (diffDays === 1) return "어제";

  const day = now.getDay(); // 0 Sun
  const mondayOffset = day === 0 ? 6 : day - 1;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - mondayOffset);
  if (updated >= weekStart) return "이번 주";
  return "이전";
}

const GROUP_ORDER: DateGroup[] = ["오늘", "어제", "이번 주", "이전"];

function groupConversations(conversations: LunaConversation[]) {
  const map = new Map<DateGroup, LunaConversation[]>();
  for (const g of GROUP_ORDER) map.set(g, []);
  for (const c of conversations) {
    const label = groupLabel(c.updated_at);
    map.get(label)!.push(c);
  }
  return GROUP_ORDER.map((label) => ({ label, items: map.get(label)! })).filter(
    (g) => g.items.length > 0
  );
}

export function LunaSidebar({
  conversations,
  selectedId,
  onSelect,
  onNewChat,
  className = ""
}: LunaSidebarProps) {
  const groups = groupConversations(conversations);

  return (
    <aside
      className={`flex h-full w-full flex-col border-r border-slate-200 bg-white md:w-[240px] md:shrink-0 ${className}`}
    >
      <div className="flex items-center gap-3 px-4 pb-3 pt-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#534AB7] text-sm font-semibold text-white">
          L
        </div>
        <div className="min-w-0 text-base font-semibold text-slate-900">LUNA</div>
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <span className="text-base leading-none">+</span>
          새 대화
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-slate-400">대화가 없습니다</p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="px-2 py-1.5 text-[11px] font-medium tracking-wide text-slate-400">
                {group.label}
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((c) => {
                  const selected = c.id === selectedId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        className={`w-full truncate rounded-lg px-2.5 py-2 text-left text-sm transition ${
                          selected
                            ? "bg-[#EEEDFE] font-medium text-[#3C3489]"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                        title={c.title}
                      >
                        {c.title || "새 대화"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
