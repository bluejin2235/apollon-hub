import { isPlaceholderAlt, hasHangulInText } from "@/lib/website/placeholder-alt";
import type { AltSuggestResult } from "@/lib/website/alt-suggest-types";

const BANNED_SUBSTRING = [/스튜디오/u, /—/u, /최고/u, /유일/u, /최초/u];
const BANNED_START_KO = /^(이미지|사진)/u;
const BANNED_START_EN = /^(image|photo|picture)\b/i;
const ENDS_WITH_PERIOD = /[。.]\s*$/u;
const LOOKS_LIKE_MOSEUP = /의\s*모습/u;

function charLen(text: string): number {
  return [...text].length;
}

function stripWrappingQuotes(text: string): string {
  return text
    .trim()
    .replace(/^["'“”‘’]+/, "")
    .replace(/["'“”‘’]+$/, "")
    .trim();
}

/** 길이·금지어·영문 한글·마침표·임시값 검사. 통과하면 정리된 문장, 아니면 null. */
export function validateAltSuggestion(
  koRaw: string | null | undefined,
  enRaw: string | null | undefined
): AltSuggestResult | null {
  const ko = stripWrappingQuotes(koRaw ?? "");
  const en = stripWrappingQuotes(enRaw ?? "");
  if (!ko || !en) return null;
  if (isPlaceholderAlt(ko) || isPlaceholderAlt(en)) return null;

  const koLen = charLen(ko);
  const enLen = charLen(en);
  if (koLen < 20 || koLen > 80) return null;
  if (enLen < 40 || enLen > 125) return null;

  if (ENDS_WITH_PERIOD.test(ko) || ENDS_WITH_PERIOD.test(en)) return null;
  if (BANNED_START_KO.test(ko) || LOOKS_LIKE_MOSEUP.test(ko)) return null;
  if (BANNED_START_EN.test(en)) return null;
  if (hasHangulInText(en)) return null;

  for (const re of BANNED_SUBSTRING) {
    if (re.test(ko) || re.test(en)) return null;
  }

  return { ko, en };
}
