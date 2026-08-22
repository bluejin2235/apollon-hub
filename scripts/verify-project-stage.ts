/**
 * 제안/수행 단계 판정·질문 가중치 스모크 검증
 * npx tsx scripts/verify-project-stage.ts
 */
import {
  annotateNotionSourcesWithWorkStage,
  type NotionSource
} from "../lib/luna/notion";
import {
  detectStageQueryBias,
  detectWorkStage,
  workStageBadgeText
} from "../lib/luna/project-stage";
import {
  buildSourcePacks,
  tierSourcePacks
} from "../lib/luna/source-pack";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const cases: Array<{
  q: string;
  bias: ReturnType<typeof detectStageQueryBias>;
}> = [
  { q: "아폴론의 미디어 설치 사례를 알려줘", bias: "prefer_executed" },
  { q: "우리가 제안한 공공 프로젝트 뭐가 있어", bias: "prefer_proposal" },
  { q: "인스파이어 시즌3 수행계획서 어디 있어", bias: "neutral" },
  { q: "공개공지 프로젝트들 공통점이 뭐야", bias: "neutral" }
];

for (const c of cases) {
  const got = detectStageQueryBias(c.q);
  assert(got === c.bias, `bias「${c.q}」 expected ${c.bias} got ${got}`);
  console.log(`ok bias: ${c.q.slice(0, 28)} → ${got}`);
}

assert(
  detectWorkStage({
    pathTitles: ["[완료] 프로젝트", "인스파이어"]
  }) === "executed",
  "notion project path"
);
assert(
  detectWorkStage({
    pathTitles: ["[진행 중] 사업개발", "롯데월드타워"]
  }) === "proposal",
  "notion bizdev path"
);
assert(
  detectWorkStage({ nasPath: "T:\\02 Project\\Inspire" }) === "executed",
  "T Project"
);
assert(
  detectWorkStage({ nasPath: "T:\\01 사업개발\\제안" }) === "proposal",
  "T bizdev"
);
assert(
  detectWorkStage({ nasPath: "P:\\06 롯데면세점\\미디어" }) === "executed",
  "P project folder"
);
assert(
  detectWorkStage({ nasPath: "P:\\01 사업개발\\공공" }) === "proposal",
  "P bizdev"
);
console.log("ok detectWorkStage paths");

const mock: NotionSource[] = [
  {
    id: "prop",
    title: "롯데월드타워 포디움 제안",
    url: "https://notion.so/prop",
    path_titles: ["[진행 중] 사업개발", "롯데"],
    nas_path: "T:\\01 사업개발\\롯데월드타워",
    similarity: 0.5,
    match_score: 5
  },
  {
    id: "exec",
    title: "인스파이어 오로라 구축",
    url: "https://notion.so/exec",
    path_titles: ["[완료] 프로젝트", "인스파이어"],
    nas_path: "T:\\02 Project\\Inspire",
    similarity: 0.48,
    match_score: 4.8
  }
];

const installQ = "아폴론의 미디어 설치 사례를 알려줘";
const ranked = annotateNotionSourcesWithWorkStage(mock, installQ);
assert(ranked[0]!.id === "exec", "install case should rank executed first");
assert(ranked[0]!.work_stage === "executed", "top stage executed");
assert(ranked[1]!.work_stage === "proposal", "second proposal");

const packs = buildSourcePacks(ranked, [], installQ);
const tiers = tierSourcePacks(packs);
assert(
  tiers.recommended?.workStage === "executed" ||
    tiers.mid.some((m) => m.workStage === "executed"),
  "card has executed"
);
const badges = [tiers.recommended, ...tiers.mid, ...tiers.weak]
  .filter(Boolean)
  .map((i) => ({
    title: i!.title,
    stage: workStageBadgeText(i!.workStage ?? "unknown")
  }));
console.log("cards:", badges);

const proposeQ = "우리가 제안한 공공 프로젝트 뭐가 있어";
const rankedProp = annotateNotionSourcesWithWorkStage(mock, proposeQ);
assert(rankedProp[0]!.id === "prop", "proposal query ranks proposal first");
console.log("ok ranking by query bias");
console.log("ALL PASS");
