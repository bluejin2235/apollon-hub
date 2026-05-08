type ServiceCardProps = {
  title: string;
  description: string;
  icon: string;
  href?: string;
  comingSoon?: boolean;
};

export default function ServiceCard({
  title,
  description,
  icon,
  href,
  comingSoon = false
}: ServiceCardProps) {
  const disabled = comingSoon || !href;

  if (disabled) {
    return (
      <div className="apollon-card p-6 transition duration-200 hover:border-slate-700 hover:bg-slate-800/80">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-2xl" aria-hidden>
            {icon}
          </span>
          <p className="text-sm font-semibold text-apollon-300">준비 중</p>
        </div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm text-slate-300">{description}</p>
      </div>
    );
  }

  return (
    <a
      href={href}
      className="apollon-card block p-6 transition duration-200 hover:-translate-y-0.5 hover:border-apollon-300/80 hover:bg-slate-800/85 hover:brightness-110 hover:shadow-glow"
    >
      <div className="mb-3 flex items-center gap-3">
        <span className="text-2xl" aria-hidden>
          {icon}
        </span>
        <p className="text-sm font-semibold text-apollon-300">서비스</p>
      </div>
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-slate-300">{description}</p>
    </a>
  );
}
