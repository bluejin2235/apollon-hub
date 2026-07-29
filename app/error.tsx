"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-slate-900">문제가 발생했습니다</h1>
      <p className="max-w-md text-sm text-slate-600">
        요청을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
      >
        다시 시도
      </button>
    </div>
  );
}
