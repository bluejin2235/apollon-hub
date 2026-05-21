"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isDev = process.env.NODE_ENV === "development";

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16">
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"
        role="alert"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Apollon Hub</p>
        <h1 className="mt-2 text-xl font-bold text-slate-900">문제가 발생했습니다</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          요청을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 Hub로 돌아가 주세요.
        </p>

        {isDev ? (
          <details className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900">
            <summary className="cursor-pointer font-medium">개발용 오류 상세</summary>
            <p className="mt-2 break-words font-mono">{error.message}</p>
            {error.digest ? (
              <p className="mt-1 font-mono text-amber-800">digest: {error.digest}</p>
            ) : null}
          </details>
        ) : null}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            다시 시도
          </button>
          <Link
            href="/hub"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          >
            Hub로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
