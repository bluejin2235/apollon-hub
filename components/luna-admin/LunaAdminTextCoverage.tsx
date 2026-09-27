"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";

type Coverage = {
  body_status: { ok: number; failed: number; empty: number; skipped: number };
  vector_ready_files: number;
  note: string;
};

export function LunaAdminTextCoverage() {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void adminFetch<Coverage>("/api/luna-admin/text-coverage")
      .then((value) => { if (!cancelled) setCoverage(value); })
      .catch(() => { if (!cancelled) setError("본문 색인 상태를 확인하지 못했습니다."); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">Work서버 문서 색인 단계</h2>
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      {!error && !coverage ? <p className="mt-2 text-xs text-slate-500">색인 상태를 확인하는 중…</p> : null}
      {coverage ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-700 sm:grid-cols-5">
            <div>본문 추출 성공 <b>{coverage.body_status.ok.toLocaleString("ko-KR")}</b></div>
            <div>본문 없음 <b>{coverage.body_status.empty.toLocaleString("ko-KR")}</b></div>
            <div>제외 <b>{coverage.body_status.skipped.toLocaleString("ko-KR")}</b></div>
            <div>추출 실패 <b>{coverage.body_status.failed.toLocaleString("ko-KR")}</b></div>
            <div>벡터 완료 파일 <b>{coverage.vector_ready_files.toLocaleString("ko-KR")}</b></div>
          </div>
          <p className="mt-2 text-xs text-slate-500">{coverage.note}</p>
        </>
      ) : null}
    </section>
  );
}
