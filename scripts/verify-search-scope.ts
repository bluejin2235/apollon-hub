/**
 * 검색 범위 규칙 검증.
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/verify-search-scope.ts
 */
import {
  resolveSearchScopeKind,
  resolveSearchScope,
  widenSearchScope,
  scopeHitsInsufficient,
  inferRuleClassification,
  scopeSkipsQueryEmbedding,
  TERM_DEF_RE,
  POLICY_RE,
  PERSON_SPEECH_RE,
  PROJECT_STATUS_RE,
  REFERENCE_RE
} from "../lib/luna/search-scope";

let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`ok  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const cases: Array<{
  q: string;
  types: string[];
  expect: string;
}> = [
  { q: "볼팍견적이 뭐야?", types: ["know"], expect: "term" },
  { q: "병가 며칠 쓸 수 있어?", types: ["know"], expect: "policy" },
  {
    q: "인스파이어 시즌4 어떻게 돼가?",
    types: ["find"],
    expect: "project"
  },
  {
    q: "상지원 상무가 얘기한 내용",
    types: ["find"],
    expect: "person"
  },
  {
    q: "미디어파사드 사례 보여줘",
    types: ["know"],
    expect: "reference"
  },
  { q: "안녕", types: ["smalltalk"], expect: "none" },
  { q: "견적서 어디 있어?", types: ["find"], expect: "find_wide" }
];

for (const c of cases) {
  const kind = resolveSearchScopeKind({ types: c.types, question: c.q });
  check(`${c.q} → ${c.expect}`, kind === c.expect, `got ${kind}`);
}

check("TERM_DEF_RE 볼팍", TERM_DEF_RE.test("볼팍견적이 뭐야?"));
check("POLICY_RE 병가", POLICY_RE.test("병가 며칠 쓸 수 있어?"));
check("PERSON_SPEECH_RE", PERSON_SPEECH_RE.test("상지원 상무가 얘기한 내용"));
check("PROJECT_STATUS_RE", PROJECT_STATUS_RE.test("인스파이어 시즌4 어떻게 돼가?"));
check("REFERENCE_RE", REFERENCE_RE.test("미디어파사드 사례 보여줘"));

const term = resolveSearchScope({
  types: ["know"],
  question: "볼팍견적이 뭐야?"
});
check("term tier1 no notion", term.flags.notion === false && term.flags.wiki);
check(
  "term insufficient when empty",
  scopeHitsInsufficient("term", {
    glossary: 0,
    wiki: 0,
    notion: 0,
    nas: 0,
    media: 0
  })
);
check(
  "term sufficient with 1 wiki",
  !scopeHitsInsufficient("term", {
    glossary: 0,
    wiki: 1,
    notion: 0,
    nas: 0,
    media: 0
  })
);

const widened = widenSearchScope(term);
check("term widen adds notion", Boolean(widened?.flags.notion));

const project = resolveSearchScope({
  types: ["find"],
  question: "인스파이어 시즌4 어떻게 돼가?"
});
check(
  "project has notion+nas",
  project.flags.notion && project.flags.nas
);
check("project no further widen", widenSearchScope(project) === null);

check(
  "low confidence → wide",
  resolveSearchScopeKind({
    types: ["know"],
    question: "뭔가 있어?",
    classifyConfidence: 0.3
  }) === "wide"
);
check(
  "person rule beats low confidence",
  resolveSearchScopeKind({
    types: ["know"],
    question: "상지원 상무가 얘기한 내용",
    classifyConfidence: 0.35
  }) === "person"
);
check(
  "inferRule term",
  inferRuleClassification("볼팍견적이 뭐야?")?.kind === "term"
);
check(
  "inferRule policy",
  inferRuleClassification("병가 며칠 쓸 수 있어?")?.kind === "policy"
);
check(
  "inferRule project",
  inferRuleClassification("인스파이어 시즌4 어떻게 돼가?")?.kind === "project"
);
check(
  "scopeSkipsQueryEmbedding term",
  scopeSkipsQueryEmbedding("term")
);
check(
  "scopeSkipsQueryEmbedding project false",
  !scopeSkipsQueryEmbedding("project")
);

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
