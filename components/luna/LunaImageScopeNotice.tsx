"use client";

import { useState } from "react";
import {
  FULL_INCLUDE_PATH_PREFIXES,
  INCLUDE_FOLDER_PATTERNS
} from "@/lib/luna/media-index-rules";

const KEYWORD_LABELS = [
  "Reference",
  "References",
  "Ref",
  "Ref image",
  "참고",
  "레퍼런스",
  "ideation",
  "아이데이션",
  "Research",
  "리서치",
  "경쟁사 분석",
  "KV",
  "source",
  "소스",
  "콘티",
  "아트웍",
  "art",
  "시뮬레이션"
];

export function LunaImageScopeNotice({
  onRequestFolder,
  onCopyToast
}: {
  onRequestFolder?: () => void;
  onCopyToast?: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3.5 border-t border-[#eef0f3] pt-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-[#9aa0a8]">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="opacity-70">🔎</span>
          <span className="min-w-0 truncate">
            이미지는{" "}
            <b className="font-semibold text-[#6b6f76]">
              레퍼런스·아이데이션·KV·소스
            </b>{" "}
            폴더에서만 찾아요
          </span>
          <span className="opacity-60">{open ? "▴" : "▾"}</span>
        </button>
        <button
          type="button"
          className="shrink-0 text-[11px] font-semibold text-[#534AB7]"
          onClick={() => {
            if (onRequestFolder) onRequestFolder();
            else onCopyToast?.("준비 중입니다");
          }}
        >
          폴더 추가 요청
        </button>
      </div>
      {open ? (
        <div className="mt-2 rounded-[9px] border border-[#eef0f3] bg-[#FAFAFB] px-3 py-2.5">
          <p className="mb-1.5 text-[10.5px] leading-relaxed text-[#9aa0a8]">
            각 사업개발·프로젝트 폴더 안에서 아래 이름이 들어간 폴더만
            색인합니다.
          </p>
          <div className="flex flex-wrap gap-1">
            {KEYWORD_LABELS.map((kw) => (
              <span
                key={kw}
                className="rounded-[13px] border border-[#e7e8ec] bg-white px-2 py-0.5 text-[10.5px] text-[#6b6f76]"
              >
                {kw}
              </span>
            ))}
          </div>
          <p className="mb-1.5 mt-2 text-[10.5px] text-[#9aa0a8]">
            그리고 아래 폴더는 전체를 색인합니다.
          </p>
          <div className="flex flex-wrap gap-1">
            {FULL_INCLUDE_PATH_PREFIXES.map((p) => (
              <span
                key={p}
                className="rounded-[13px] border border-[#DDD8F2] bg-[#EEEDFE] px-2 py-0.5 font-mono text-[10px] text-[#3C3489]"
              >
                {p}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-[#9aa0a8]">
            규칙은{" "}
            {INCLUDE_FOLDER_PATTERNS.map((p) => p.id).join(" · ")} 패턴으로
            관리됩니다.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function LunaImageIndexWarning({
  nasPath,
  onRequestIndex,
  onCopyToast
}: {
  nasPath?: string | null;
  onRequestIndex?: () => void;
  onCopyToast?: (msg: string) => void;
}) {
  return (
    <div className="mb-3 flex gap-2 rounded-[10px] border border-[#EBDCC0] bg-[#FBF3E4] px-3.5 py-2.5">
      <span className="mt-0.5 text-[12px]">⚠</span>
      <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-[#B0782B]">
        <b className="font-bold">이 프로젝트는 아직 이미지 색인이 안 됐어요.</b>
        {nasPath ? (
          <div className="mt-1 font-mono text-[10.5px] opacity-85">{nasPath}</div>
        ) : null}
      </div>
      <button
        type="button"
        className="shrink-0 text-[11px] font-bold text-[#B0782B]"
        onClick={() => {
          if (onRequestIndex) onRequestIndex();
          else onCopyToast?.("준비 중입니다");
        }}
      >
        색인 요청
      </button>
    </div>
  );
}
