/**
 * LUNA 채팅 SSE — ui_* 진행 줄 (실제로 한 검색만)
 */
import {
  formatCountRight,
  notionFoundLabel,
  progressQueryHint,
  uiChannelsForScope,
  workFoundLabel
} from "@/lib/luna/progress-display";
import type { SearchScopeKind } from "@/lib/luna/search-scope";

export type UiPushStep = (
  key: string,
  status: "running" | "done" | "skip",
  label: string,
  opts?: { right?: string; silent?: boolean }
) => void;

export function queryHintFromQuestion(question: string): string {
  return progressQueryHint(question);
}

export function uiChannelsForKind(kind: SearchScopeKind) {
  return uiChannelsForScope(kind);
}

export function pushUiReadStep(
  push: UiPushStep,
  scopeLabel: string
): void {
  const label = scopeLabel.trim()
    ? `질문을 읽었습니다 — ${scopeLabel.trim()}`
    : "질문을 읽었습니다";
  push("ui_read", "done", label);
}

export function pushUiGlossaryStep(push: UiPushStep, count: number): void {
  push("ui_glossary", "done", "용어사전을 찾았습니다", {
    right: formatCountRight(count)
  });
}

export function pushUiWikiStep(push: UiPushStep, count: number): void {
  push("ui_wiki", "done", "위키를 찾았습니다", {
    right: formatCountRight(count)
  });
}

export function pushUiNotionStep(
  push: UiPushStep,
  count: number,
  hint: string
): void {
  push("ui_notion", "done", notionFoundLabel(hint), {
    right: formatCountRight(count)
  });
}

export function pushUiLinkStep(push: UiPushStep, added: number): void {
  push("ui_link", "done", "연결된 회의록·아이데이션을 따라갔습니다", {
    right:
      added > 0 ? formatCountRight(added, { plus: true }) : formatCountRight(0)
  });
}

export function pushUiWorkStep(
  push: UiPushStep,
  count: number,
  hint: string
): void {
  push("ui_work", "done", workFoundLabel(hint), {
    right: formatCountRight(count)
  });
}

export function pushUiNasTextStep(push: UiPushStep, count: number): void {
  push("ui_nas_text", "done", "파일 본문을 훑었습니다", {
    right: formatCountRight(count)
  });
}

export function pushUiImageStep(push: UiPushStep, count: number): void {
  push("ui_image", "done", "관련 이미지를 찾았습니다", {
    right: formatCountRight(count)
  });
}

export function pushUiWebStep(push: UiPushStep, count: number): void {
  push("ui_web", "done", "웹에서 참고 자료를 찾았습니다", {
    right: formatCountRight(count)
  });
}

/** 범위에 허용됐는데 아직 ui_* 가 없으면 0건으로 채운다 */
export function ensureUiProgressZeros(opts: {
  push: UiPushStep;
  kind: SearchScopeKind;
  hint: string;
  existingKeys: Set<string>;
  counts: {
    glossary: number;
    wiki: number;
    notion: number;
    linkAdded: number;
    work: number;
    nasText: number;
    image: number;
    web: number;
  };
}): void {
  const ch = uiChannelsForScope(opts.kind);
  const { push, existingKeys, counts, hint } = opts;

  if (ch.glossary && !existingKeys.has("ui_glossary")) {
    pushUiGlossaryStep(push, counts.glossary);
  }
  if (ch.wiki && !existingKeys.has("ui_wiki")) {
    pushUiWikiStep(push, counts.wiki);
  }
  if (ch.notion && !existingKeys.has("ui_notion")) {
    pushUiNotionStep(push, counts.notion, hint);
  }
  if (
    ch.link &&
    !existingKeys.has("ui_link") &&
    (counts.linkAdded > 0 || counts.notion > 0)
  ) {
    pushUiLinkStep(push, counts.linkAdded);
  }
  if (ch.work && !existingKeys.has("ui_work")) {
    pushUiWorkStep(push, counts.work, hint);
  }
  if (ch.nasText && counts.nasText >= 0 && !existingKeys.has("ui_nas_text")) {
    pushUiNasTextStep(push, counts.nasText);
  }
  if (ch.image && !existingKeys.has("ui_image")) {
    pushUiImageStep(push, counts.image);
  }
  if (ch.web && !existingKeys.has("ui_web")) {
    pushUiWebStep(push, counts.web);
  }
}

export function refreshConnectorUiSteps(opts: {
  push: UiPushStep;
  kind: SearchScopeKind;
  hint: string;
  counts: {
    glossary: number;
    wiki: number;
    notion: number;
    linkAdded: number;
    work: number;
    nasText: number;
    image: number;
    web: number;
  };
}): void {
  syncUiSearchProgress(opts);
}

export function uiProgressCountsFromState(opts: {
  glossary: number;
  wiki: number;
  notionSources: { length: number };
  linkAdded: number;
  nasResults: { length: number };
  nasTextHits: number;
  cards: Array<{ type?: string }>;
}): {
  glossary: number;
  wiki: number;
  notion: number;
  linkAdded: number;
  work: number;
  nasText: number;
  image: number;
  web: number;
} {
  const cards = opts.cards;
  return {
    glossary: opts.glossary,
    wiki: opts.wiki,
    notion: opts.notionSources.length,
    linkAdded: opts.linkAdded,
    work: opts.nasResults.length,
    nasText: opts.nasTextHits,
    image: cards.filter((c) => c.type === "image").length,
    web: cards.filter((c) => c.type === "web").length
  };
}

export function syncUiSearchProgress(opts: {
  push: UiPushStep;
  kind: SearchScopeKind;
  hint: string;
  counts: {
    glossary: number;
    wiki: number;
    notion: number;
    linkAdded: number;
    work: number;
    nasText: number;
    image: number;
    web: number;
  };
}): void {
  const ch = uiChannelsForScope(opts.kind);
  const c = opts.counts;
  if (ch.notion) {
    pushUiNotionStep(opts.push, c.notion, opts.hint);
  }
  if (ch.link && (c.linkAdded > 0 || c.notion > 0)) {
    pushUiLinkStep(opts.push, c.linkAdded);
  }
  if (ch.work) {
    pushUiWorkStep(opts.push, c.work, opts.hint);
  }
  if (ch.nasText && c.nasText >= 0) {
    pushUiNasTextStep(opts.push, c.nasText);
  }
  if (ch.image) {
    pushUiImageStep(opts.push, c.image);
  }
  if (ch.web) {
    pushUiWebStep(opts.push, c.web);
  }
}
