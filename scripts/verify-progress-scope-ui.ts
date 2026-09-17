/**
 * 질문 유형 → 진행 ui 채널 (실제로 던진 것처럼 규칙 분류)
 */
import {
  inferRuleClassification,
  resolveSearchScope
} from "../lib/luna/search-scope";
import { uiChannelsForScope } from "../lib/luna/progress-display";
import { syncUiSearchProgress } from "../lib/luna/chat-progress-ui";

const cases = [
  { q: "디지털 랜드마크가 뭐야", expect: ["ui_read", "ui_glossary"] },
  { q: "병가 며칠 쓸 수 있어?", expect: ["ui_read", "ui_wiki"] },
  {
    q: "인스파이어 시즌4 진행 현황 어떻게 돼?",
    expect: ["ui_read", "ui_notion", "ui_work"]
  },
  {
    q: "미디어 설치 사례 레퍼런스 보여줘",
    expect: ["ui_read", "ui_notion", "ui_image"]
  }
];

for (const c of cases) {
  const rule = inferRuleClassification(c.q);
  const scope = resolveSearchScope({
    types: rule?.types ?? ["find"],
    question: c.q,
    classifyConfidence: 0.95
  });
  const keys: string[] = [];
  const push = (key: string) => {
    keys.push(key);
  };
  push("ui_read");
  const ch = uiChannelsForScope(scope.kind);
  if (ch.glossary) push("ui_glossary");
  if (ch.wiki) push("ui_wiki");
  syncUiSearchProgress({
    push: (key) => push(key),
    kind: scope.kind,
    hint: "시즌4",
    counts: {
      glossary: 1,
      wiki: 1,
      notion: 2,
      linkAdded: scope.kind === "project" ? 3 : 0,
      work: 1,
      nasText: -1,
      image: 1,
      web: 0
    }
  });
  for (const k of c.expect) {
    if (!keys.includes(k)) {
      throw new Error(
        `${c.q} → kind=${scope.kind} missing ${k}; got ${keys.join(",")}`
      );
    }
  }
  // term must not invent notion/work lines
  if (scope.kind === "term" && (keys.includes("ui_notion") || keys.includes("ui_work"))) {
    throw new Error(`term leaked connector steps: ${keys.join(",")}`);
  }
  if (scope.kind === "policy" && keys.includes("ui_glossary")) {
    throw new Error(`policy leaked glossary`);
  }
  console.log("ok", scope.kind, c.q.slice(0, 24), "→", keys.join(" · "));
}
console.log("scope→ui live-shape ok");
