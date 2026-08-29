import Link from "next/link";
import { Clock } from "lucide-react";

type ComingSoonProps = {
  title: string;
  hint: string;
};

export function ComingSoon({ title, hint }: ComingSoonProps) {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-6 text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400"
        aria-hidden
      >
        <Clock className="h-5 w-5" strokeWidth={1.6} />
      </div>
      <h1 className="mt-5 text-lg font-semibold text-slate-500">{title}</h1>
      <p className="mt-1 text-sm text-slate-400">준비 중입니다</p>
      <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-400">{hint}</p>
      <Link
        href="/website"
        className="mt-8 text-sm font-medium text-apollon-700 transition hover:text-apollon-800 hover:underline"
      >
        대시보드로 돌아가기
      </Link>
    </div>
  );
}
