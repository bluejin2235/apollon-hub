"use client";

import { useMemo, useState } from "react";
import { Copy, Check } from "lucide-react";
import type { LunaProgressStep } from "@/components/luna/LunaMessage";
import type { LunaClassificationMeta } from "@/lib/luna/chat-response";
import { isNotFoundAnswer } from "@/lib/luna/failures-shared";
import {
  buildProgressRows,
  type LunaSearchCounts
} from "@/lib/luna/luna-answer-ui";
import {
  formatNasFolderPath,
  type NasPathSettings
} from "@/lib/luna/nas-path";
import { progressQueryHint } from "@/lib/luna/progress-display";
import type { LunaCard } from "@/lib/luna/tavily";

const SEARCH_ROW_KEYS = new Set([
  "ui_work",
  "ui_notion",
  "ui_nas_text",
  "ui_wiki",
  "ui_image",
  "ui_glossary",
  "ui_link",
  "ui_web",
  "found"
]);

function extractWhy(content: string): string {
  const lines = content
    .split(/\n+/)
    .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
    .filter(Boolean);
  const hit = lines.find((l) => isNotFoundAnswer(l));
  if (hit) return hit.length > 160 ? `${hit.slice(0, 159)}…` : hit;
  const first = lines[0] ?? "";
  return first.length > 160 ? `${first.slice(0, 159)}…` : first;
}

function extractDetail(content: string, why: string): string | null {
  const lines = content
    .split(/\n+/)
    .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
    .filter(Boolean);
  const rest = lines.find((l) => l !== why && l.length > 12);
  if (!rest) return null;
  return rest.length > 200 ? `${rest.slice(0, 199)}…` : rest;
}

function uniqueFolderPaths(
  cards: LunaCard[],
  settings: NasPathSettings
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cards) {
    if (c.type !== "nas") continue;
    const raw = (c.raw_path ?? "").trim();
    if (!raw) continue;
    const folder = formatNasFolderPath(c.drive, raw, settings, true);
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);
    out.push(folder);
    if (out.length >= 3) break;
  }
  return out;
}

export function shouldShowNotFoundGuide(opts: {
  content: string;
  isComplete: boolean;
  isThinking?: boolean;
  counts: LunaSearchCounts;
}): boolean {
  if (opts.isThinking || !opts.isComplete) return false;
  const text = opts.content.trim();
  if (!text) return false;
  if (isNotFoundAnswer(text)) return true;
  const zeros =
    (opts.counts.work ?? 1) === 0 &&
    (opts.counts.notion ?? 1) === 0 &&
    (opts.counts.wiki ?? 1) === 0 &&
    (opts.counts.image ?? 1) === 0;
  return zeros;
}

export function NotFoundGuide({
  content,
  questionText,
  steps,
  classification,
  counts,
  cards,
  nasPathSettings,
  onCopyToast
}: {
  content: string;
  questionText?: string | null;
  steps: LunaProgressStep[];
  classification?: LunaClassificationMeta | null;
  counts: LunaSearchCounts;
  cards: LunaCard[];
  nasPathSettings: NasPathSettings;
  onCopyToast?: (msg: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const hint = progressQueryHint(questionText ?? "");
  const why = extractWhy(content);
  const detail = extractDetail(content, why);
  const folders = useMemo(
    () => uniqueFolderPaths(cards, nasPathSettings),
    [cards, nasPathSettings]
  );

  const searchRows = useMemo(() => {
    const rows = buildProgressRows({
      steps,
      classification,
      counts,
      isComplete: true
    }).filter((r) => SEARCH_ROW_KEYS.has(r.key) && r.state === "done");

    if (rows.length > 0) return rows;

    const fallback: Array<{ key: string; label: string; right: string }> = [];
    if (counts.work != null) {
      fallback.push({
        key: "ui_work",
        label: hint
          ? `Work서버에서 「${hint}」를 찾았습니다`
          : "Work서버 폴더를 찾았습니다",
        right: `${counts.work}건`
      });
    }
    if (counts.notion != null) {
      fallback.push({
        key: "ui_notion",
        label: "노션에서 찾았습니다",
        right: `${counts.notion}건`
      });
    }
    if (counts.wiki != null) {
      fallback.push({
        key: "ui_wiki",
        label: "위키에서 찾았습니다",
        right: `${counts.wiki}건`
      });
    }
    fallback.push({
      key: "ui_nas_text",
      label: "파일 본문을 훑었습니다",
      right: "0건"
    });
    return fallback;
  }, [steps, classification, counts, hint]);

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(path);
      onCopyToast?.("경로를 복사했어요 — 탐색기에 붙여넣기");
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      onCopyToast?.("복사에 실패했어요");
    }
  }

  return (
    <div className="mt-3.5 rounded-[12px] border border-[#e7e8ec] bg-[#FCFCFD] px-3.5 py-3.5">
      {searchRows.length > 0 ? (
        <ul className="mb-3 space-y-1.5 border-b border-[#eef0f3] pb-3">
          {searchRows.map((r) => (
            <li
              key={r.key}
              className="flex items-center gap-2 text-[12.5px] text-[#6b6f76]"
            >
              <span className="w-3.5 shrink-0 text-center text-[11px] text-[#8B8F96]">
                ✓
              </span>
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-[#9aa0a8]">
                {r.right || "0건"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-[14px] font-bold text-[#1c1d21]">{why || "찾던 걸 못 찾았어요."}</p>
      {detail ? (
        <p className="mt-1.5 text-[13px] leading-[1.65] text-[#6b6f76]">{detail}</p>
      ) : null}

      <div className="mt-3.5">
        <p className="mb-2 text-[12.5px] font-bold text-[#1c1d21]">
          이렇게 해보시겠어요?
        </p>
        <ul className="space-y-2.5">
          {folders.length > 0 ? (
            folders.map((path) => (
              <li key={path} className="text-[13px] leading-[1.55] text-[#1c1d21]">
                <span className="text-[#6b6f76]">· 폴더를 직접 열어보기 — </span>
                <button
                  type="button"
                  onClick={() => void copyPath(path)}
                  className="inline-flex max-w-full items-start gap-1.5 rounded-md border border-[#e7e8ec] bg-white px-2 py-1 text-left font-mono text-[11px] text-[#534AB7] hover:border-[#534AB7]/40"
                  title="클릭하면 복사"
                >
                  <span className="min-w-0 break-all">{path}</span>
                  {copied === path ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                </button>
              </li>
            ))
          ) : (
            <li className="text-[13px] text-[#6b6f76]">
              · 폴더 이름을 조금 바꿔 다시 물어보기
            </li>
          )}
          <li className="text-[13px] text-[#6b6f76]">
            · {hint ? `「${hint}」` : "찾던 것"} 이름 일부를 알려주시면 그것으로 찾기
          </li>
          <li className="text-[13px] text-[#6b6f76]">
            · 제가 기억하게 알려주기 — 아래 「루나에게 알려주기」로
          </li>
        </ul>
      </div>
    </div>
  );
}
