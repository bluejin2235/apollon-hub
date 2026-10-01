"use client";

import { useMemo } from "react";
import { NasPathDualCopy } from "@/components/luna/NasPathDualCopy";
import type { LunaProgressStep } from "@/components/luna/LunaMessage";
import type { LunaClassificationMeta } from "@/lib/luna/chat-response";
import { isNotFoundAnswer } from "@/lib/luna/failures-shared";
import {
  buildProgressRows,
  type LunaSearchCounts
} from "@/lib/luna/luna-answer-ui";
import {
  nasExplorerFolderPair,
  type NasExplorerPathPair,
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

function uniqueFolderPairs(cards: LunaCard[]): NasExplorerPathPair[] {
  const seen = new Set<string>();
  const out: NasExplorerPathPair[] = [];
  for (const c of cards) {
    if (c.type !== "nas") continue;
    const raw = (c.raw_path ?? "").trim();
    if (!raw) continue;
    const last = raw.replace(/\//g, "\\").split("\\").pop() || "";
    const isFile =
      c.is_file === true ||
      (c.is_file !== false && /\.[a-z0-9]{1,8}$/i.test(last));
    const pair = nasExplorerFolderPair(c.drive, raw, isFile);
    if (!pair.office || seen.has(pair.office)) continue;
    seen.add(pair.office);
    out.push(pair);
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
  // Card counts can be zero for explanations, clarification and filtered sources.
  // Only an explicit missing-material answer warrants the failure guide.
  return isNotFoundAnswer(text);
}

export function NotFoundGuide({
  questionText,
  steps,
  classification,
  counts,
  cards,
  onCopyToast
}: {
  content: string;
  questionText?: string | null;
  steps: LunaProgressStep[];
  classification?: LunaClassificationMeta | null;
  counts: LunaSearchCounts;
  cards: LunaCard[];
  nasPathSettings?: NasPathSettings;
  onCopyToast?: (msg: string) => void;
}) {
  const hint = progressQueryHint(questionText ?? "");
  const folders = useMemo(() => uniqueFolderPairs(cards), [cards]);

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

  return (
    <div className="mt-3.5 rounded-[12px] border border-[#e7e8ec] bg-[#FCFCFD] px-3.5 py-3.5">
      {searchRows.length > 0 ? (
        <ul className="mb-3 space-y-1.5 border-b border-[#eef0f3] pb-3">
          <li className="text-[12px] text-[#6b6f76]">검색 단계에서 수집한 후보입니다. 요청에 맞는 최종 자료 수와 다를 수 있습니다.</li>
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

      <div className="mt-3.5">
        <p className="mb-2 text-[12.5px] font-bold text-[#1c1d21]">
          이렇게 해보시겠어요?
        </p>
        <ul className="space-y-2.5">
          {folders.length > 0 ? (
            folders.map((pair) => (
              <li
                key={pair.office}
                className="text-[13px] leading-[1.55] text-[#1c1d21]"
              >
                <p className="mb-1 text-[#6b6f76]">· 폴더를 직접 열어보기</p>
                <div className="rounded-md border border-[#e7e8ec] bg-white px-2.5 py-2">
                  <NasPathDualCopy pair={pair} onCopyToast={onCopyToast} />
                </div>
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
