"use client";

import Link from "next/link";

export function HomePublishNotice({
  open,
  kind,
  onClose
}: {
  open: boolean;
  kind: "워크" | "인사이트";
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-[11px] border border-[#d2d7de] bg-white shadow-[0_4px_18px_rgba(0,0,0,.07)]">
        <div className="flex items-center gap-[9px] border-b border-[#e5e7eb] px-[17px] py-[13px]">
          <span className="text-[15px] font-semibold text-[#16181d]">{kind} 등록 완료</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="text-[15px] text-[#9ca3af]">
            ✕
          </button>
        </div>
        <div className="px-5 py-[26px] text-center">
          <div className="mb-2 text-[28px] text-[#0f7a45]">✓</div>
          <p className="m-0 mb-1.5 text-[15px] font-semibold text-[#16181d]">등록되었습니다</p>
          <p className="m-0 text-[12.5px] leading-[1.9] text-[#6b7280]">
            {kind} 목록과 검색에는 바로 나옵니다.
            <br />
            <b className="font-semibold text-[#16181d]">메인에 노출하려면 홈에서 따로 추가해 주세요.</b>
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#e5e7eb] bg-[#f8f9fb] px-[17px] py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[7px] border border-[#dde1e6] bg-white px-[13px] py-1.5 text-[12.5px] text-[#3a4049]"
          >
            닫기
          </button>
          <Link
            href="/website/home"
            className="rounded-[7px] bg-[#534AB7] px-[13px] py-1.5 text-[12.5px] font-semibold text-white"
          >
            홈에서 추가하기 →
          </Link>
        </div>
      </div>
    </div>
  );
}
