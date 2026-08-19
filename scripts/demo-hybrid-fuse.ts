/**
 * 임베딩 백필 전에도 융합 규칙이 세 실패 케이스를 살리는지 시뮬레이션.
 * npx tsx scripts/demo-hybrid-fuse.ts
 */
import { fuseKeywordAndEmbedding } from "../lib/luna/embedding";

const cases = [
  {
    q: "병가규정 알려줘",
    target: "leave-guide / 병가휴가 — 정의",
    keyword: 0,
    similarity: 0.62
  },
  {
    q: "미디어조형물 인허가 프로세스",
    target: "media-sculpture / 심의…",
    keyword: 0,
    similarity: 0.58
  },
  {
    q: "KCC 프로젝트 알려줘",
    target: "gwangan-kcc-switzen",
    keyword: 5,
    similarity: 0.71
  },
  {
    q: "견적서 어떻게 써",
    target: "견적 방식",
    keyword: 4,
    similarity: 0.55
  },
  {
    q: "RFP 볼 때 근거는",
    target: "RFP분석 / 근거 규칙",
    keyword: 6,
    similarity: 0.48
  },
  {
    q: "감리가 뭐야",
    target: "용어:감리",
    keyword: 3,
    similarity: 0.77
  }
];

console.log("질문\t대상\tkeyword\tembedding\tfinal\tvia");
for (const c of cases) {
  const f = fuseKeywordAndEmbedding({
    keywordScore: c.keyword,
    similarity: c.similarity
  });
  console.log(
    [
      c.q,
      c.target,
      f.keyword_score.toFixed(2),
      f.embedding_score.toFixed(2),
      f.score.toFixed(2),
      f.match_via
    ].join("\t")
  );
}
