/**
 * 검색 쓰레기 방지 — 무엇을 뽑는지, 범위, 3D 경로, 자신감.
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/verify-search-garbage.ts
 */
import assert from "node:assert/strict";
import { parseAskedWhat, hasNamedProject } from "../lib/luna/ask-what";
import {
  haystackMatchesAsked,
  filterCardsByAsked,
  formatNotFoundAnswer,
  scoreEvidenceMatch,
  isNotFoundAnswerText,
  keepSourcesUsedInAnswer
} from "../lib/luna/search-filter";
import { isGarbage3dPath } from "../lib/luna/media-index-rules";
import { buildPeekClarify } from "../lib/luna/project-peek";
import { inferRuleClassification, resolveSearchScopeKind } from "../lib/luna/search-scope";
import { pathVariantsForTerm } from "../lib/luna/named-entities";
import type { LunaCard } from "../lib/luna/tavily";

let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const q1 = parseAskedWhat("해운대스퀘어 KV 이미지 보여줘");
check("해운대 프로젝트", q1.projectPhrases.some((p) => p.includes("해운대")));
check("해운대 nature kv", q1.nature === "kv");
check("해운대 material image", q1.material === "image");
check("해운대 named", hasNamedProject("해운대스퀘어 KV 이미지 보여줘"));

const q2 = parseAskedWhat("더후 글로벌 론칭 레퍼런스 찾아줘");
check("더후 프로젝트", q2.displayProject?.includes("더후") === true);
check("더후 nature reference", q2.nature === "reference");
check(
  "더후+레퍼런스는 project 범위",
  inferRuleClassification("더후 글로벌 론칭 레퍼런스 찾아줘")?.kind === "project"
);

const q3 = parseAskedWhat("인스파이어 시즌4 어벤저스 레퍼런스 있어?");
check("인스파이어", q3.displayProject === "인스파이어");
check(
  "어벤저스 extra",
  q3.extraTokens.some((t) => t.includes("어벤저스"))
);
check(
  "시즌4 extra",
  q3.extraTokens.some((t) => /시즌\s*4/.test(t))
);

const q4 = parseAskedWhat("삼성디스플레이 시어터룸 스토리보드 보여줘");
check(
  "삼성디스플레이",
  (q4.displayProject || "").includes("삼성") ||
    q4.projectPhrases.some((p) => p.includes("삼성"))
);
check("스토리보드", q4.nature === "storyboard");
check("스토리보드 이미지", q4.material === "image");

const q5 = parseAskedWhat("아크메르동탄 모델하우스 레퍼런스");
check("아크메르동탄", (q5.displayProject || "").includes("아크메르동탄"));
check("아크메르 nature reference", q5.nature === "reference");

check(
  "미디어파사드 사례는 프로젝트 아님",
  !hasNamedProject("미디어파사드 사례 보여줘")
);
check(
  "미디어파사드 사례는 reference",
  resolveSearchScopeKind({
    types: ["know"],
    question: "미디어파사드 사례 보여줘"
  }) === "reference"
);

const hsqKv =
  "01 사업개발\\2026\\260108 해운대스퀘어 공공부지사업\\05 Design\\260224 KV, 영상시뮬레이션\\해운대_쇼_KV.png";
const ktKv =
  "01 사업개발\\2025\\250616 KT광화문 West빌딩 리모델링\\04 Design\\250618 KV\\공간렌더\\아트.png";
const skp =
  "01 사업개발\\2026\\260108 해운대스퀘어 공공부지사업\\06 Space\\SKP\\D5용 레이어분리\\asset\\ModelTextures\\d46473ad.png";
const avengers =
  "01 사업개발\\2026\\260710 인스파이어 시즌4\\03 Reference\\어벤저스\\cap.jpg";
const referecnces =
  "02 Project\\2026\\260723 아크메르동탄 모델하우스\\03 Referecnces\\ref.jpg";
const storyboard =
  "01 사업개발\\2025\\250912 삼성디스플레이 시어터룸\\02 Planning\\251211 시어터룸 우주인 디벨롭 아이데이션_스토리보드 이미지\\01.png";
const jeonju =
  "01 사업개발\\2025\\전주관광타워\\03 Reference\\a.png";

check("해운대 KV 경로 통과", haystackMatchesAsked(hsqKv, q1));
check("KT 광화문은 해운대 질문에서 탈락", !haystackMatchesAsked(ktKv, q1));
check("SKP 경로 쓰레기", isGarbage3dPath(skp));
check("SKP 는 해운대 질문에서 탈락", !haystackMatchesAsked(skp, q1));
check("어벤저스 폴더 통과", haystackMatchesAsked(avengers, q3));
check("Referecnces 오타 폴더 통과", haystackMatchesAsked(referecnces, q5));
check("스토리보드 경로 통과", haystackMatchesAsked(storyboard, q4));
check("전주관광타워는 아크메르에서 탈락", !haystackMatchesAsked(jeonju, q5));

check(
  "레퍼런스 변형에 Referecnces",
  pathVariantsForTerm("레퍼런스").some((v) => v.toLowerCase() === "referecnces")
);

const cards: LunaCard[] = [
  {
    type: "image",
    title: "kt",
    url: null,
    thumbnail: null,
    description: ktKv,
    raw_path: ktKv
  },
  {
    type: "image",
    title: "hsq",
    url: null,
    thumbnail: null,
    description: hsqKv,
    raw_path: hsqKv
  },
  {
    type: "notion",
    title: "KT 광화문",
    url: "https://notion.so/x",
    thumbnail: null,
    description: ""
  }
];
const filtered = filterCardsByAsked(cards, q1);
check("이미지 질문에 이미지만", filtered.every((c) => c.type === "image"));
check("이미지 질문에 해운대만", filtered.every((c) => (c.raw_path || "").includes("해운대스퀘어")));
check("KT 카드 제거", !filtered.some((c) => c.title === "kt"));

const clarify = buildPeekClarify({
  displayProject: "해운대스퀘어",
  natureLabel: "KV",
  natureFolders: [
    { drive: "T", path: "a\\260224 KV, 영상시뮬레이션", name: "260224 KV, 영상시뮬레이션" },
    { drive: "T", path: "a\\260706 KV", name: "260706 KV" }
  ],
  childSplits: []
});
check("KV 둘이면 되묻기", Boolean(clarify && clarify.options.length === 2));
check(
  "되묻기에 실제 폴더명",
  Boolean(
    clarify?.question.includes("260224 KV") &&
      clarify.question.includes("260706 KV")
  )
);

const none = formatNotFoundAnswer(q5, ["03 Referecnces"]);
check("못 찾음 문구에 본 폴더", none.includes("03 Referecnces"));
check("못 찾음 문구에 알려달라", none.includes("알려주시면 기억해둘게요"));
check("못 찾음 판정", isNotFoundAnswerText(none));

const hidden = keepSourcesUsedInAnswer({
  cards: filtered,
  notion: [
    {
      title: "롯데면세점",
      url: "https://notion.so/lotte",
      id: "1"
    }
  ],
  wiki: [],
  answer: none,
  notFound: true
});
check("못 찾으면 카드 0", hidden.cards.length === 0 && hidden.notion.length === 0);

const low = scoreEvidenceMatch({
  retrieved: 20,
  matching: 3,
  askedClear: true,
  notFound: false
});
check("자신감은 맞춘 비율", low.confidence_score === 2);
const high = scoreEvidenceMatch({
  retrieved: 3,
  matching: 3,
  askedClear: true,
  notFound: false
});
check("전부 맞으면 자신감 10", high.confidence_score === 10);
const miss = scoreEvidenceMatch({
  retrieved: 20,
  matching: 0,
  askedClear: true,
  notFound: true
});
check("못 찾으면 자신감 2", miss.confidence_score === 2);

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
