"use client";

/** 아르테 에이전트 목록 (추후 DB 연동) */
const PLACEHOLDER_AGENTS = [
  {
    id: "arte-main",
    name: "아르테 메인",
    description: "팀 업무 지원용 기본 에이전트",
    status: "준비 중" as const
  }
];

export function AgentListTab() {
  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-600">
        등록된 에이전트를 확인하고 관리합니다. 상세 설정은 추후 연동됩니다.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLACEHOLDER_AGENTS.map((agent) => (
          <article
            key={agent.id}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-violet-200 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-bold text-slate-900">{agent.name}</h3>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {agent.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{agent.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
