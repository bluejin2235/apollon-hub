import type { HubServiceStatus } from "@/lib/services/hub-types";

type ServiceCardProps = {
  title: string;
  description: string;
  icon: string;
  href?: string;
  /** 서비스 상태(허브 카드용) */
  status?: HubServiceStatus;
  /** 접근 권한이 없을 때(읽기 전용으로만 노출) */
  accessRestricted?: boolean;
};

type Badge = { label: string; cls: string } | null;

const cardBaseClass =
  "apollon-card flex h-full flex-col p-4 transition duration-200 hover:border-slate-300 hover:bg-slate-50";

const textKeepAllClass = "break-keep [word-break:keep-all]";

function getBadge(status: HubServiceStatus | undefined, accessRestricted: boolean): Badge {
  if (accessRestricted) {
    return {
      label: "권한 필요",
      cls: "bg-amber-100 text-amber-800 ring-1 ring-amber-200"
    };
  }
  if (!status || status === "활성") return null;
  if (status === "준비중") {
    return {
      label: "준비중",
      cls: "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
    };
  }
  return {
    label: "비활성",
    cls: "bg-rose-100 text-rose-700 ring-1 ring-rose-200"
  };
}

export default function ServiceCard({
  title,
  description,
  icon,
  href,
  status = "활성",
  accessRestricted = false
}: ServiceCardProps) {
  const disabled = status !== "활성" || accessRestricted || !href;
  const badge = getBadge(status, accessRestricted);

  const titleRow = (
    <div className="mb-3 flex items-start gap-3">
      <span className="shrink-0 text-2xl" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={`text-base font-semibold text-slate-900 ${textKeepAllClass}`}>{title}</h3>
          {badge ? (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
              {badge.label}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );

  const body = (
    <>
      {titleRow}
      <p className={`text-sm leading-relaxed text-slate-600 ${textKeepAllClass}`}>{description}</p>
    </>
  );

  if (disabled) {
    return <div className={`${cardBaseClass} opacity-90`}>{body}</div>;
  }

  return (
    <a
      href={href}
      className={`${cardBaseClass} hover:border-apollon-300/80 hover:shadow-md`}
    >
      {body}
    </a>
  );
}
