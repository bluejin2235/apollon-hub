"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export default function SuppliesError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    console.error("[app/supplies/error] supplies segment error", {
      pathname,
      message: error.message,
      name: error.name,
      digest: error.digest,
      stack: error.stack,
      cause: error.cause,
      error
    });
  }, [error, pathname]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center px-4 py-12">
      <div
        className="w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"
        role="alert"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">비품 관리</p>
        <h1 className="mt-2 text-xl font-bold text-slate-900">문제가 발생했습니다</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          비품 페이지를 불러오는 중 오류가 발생했습니다. 다시 시도하거나 비품 목록으로 돌아가 주세요.
        </p>
        {process.env.NODE_ENV === "development" ? (
          <details className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900">
            <summary className="cursor-pointer font-medium">개발용 오류 상세</summary>
            <p className="mt-2 break-words font-mono">{error.message}</p>
            {error.digest ? (
              <p className="mt-1 font-mono text-amber-800">digest: {error.digest}</p>
            ) : null}
          </details>
        ) : null}
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500"
          >
            다시 시도
          </button>
          <Link
            href="/supplies"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          >
            비품 목록으로
          </Link>
        </div>
      </div>
    </div>
  );
}
