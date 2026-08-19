/**
 * 권한·비공개 인용 교차 검증 (멤버 세션 없이 판정 함수 직접 호출)
 */
import {
  canViewWikiDoc,
  filterVisibleWikiDocs
} from "@/lib/luna/wiki-permissions";
import { formatWikiSectionsBlock, type WikiSourceRef } from "@/lib/luna/wiki-match";
import {
  inferWikiMenuSlug,
  wikiCanonicalSlug,
  wikiDocPath,
  wikiSlugLookupKeys
} from "@/lib/wiki/types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("ok ", msg);
}

const privateDoc = { slug: "rfp-analysis", visible_to_staff: false };
const publicDoc = { slug: "open_doc", visible_to_staff: true };

assert(canViewWikiDoc(privateDoc, true) === true, "슈퍼관리자: 비공개 문서 열람 가능");
assert(canViewWikiDoc(privateDoc, false) === false, "멤버: 비공개 문서 열람 불가");
assert(canViewWikiDoc(publicDoc, false) === true, "멤버: 공개 문서 열람 가능");

const listed = filterVisibleWikiDocs([privateDoc, publicDoc], false);
assert(listed.length === 1 && listed[0]!.slug === "open_doc", "멤버 목록: 비공개 제외");
assert(filterVisibleWikiDocs([privateDoc, publicDoc], true).length === 2, "슈퍼관리자 목록: 전부");

const privateHit: WikiSourceRef = {
  slug: "rfp-analysis",
  title: "RFP분석",
  category: "workflow",
  section_id: "s1",
  section_title: "절차",
  score: 11,
  matched_keywords: ["절차"],
  excerpt: "RFP는 이렇게 본다",
  path: "/wiki/rfp-analysis",
  visible_to_staff: false,
  cite_publicly: false
};
const block = formatWikiSectionsBlock([privateHit]);
assert(block.includes("내부 기준"), "비공개 주입: 내부 기준");
assert(!block.includes("「RFP분석」"), "비공개 주입: 문서명 숨김");

assert(wikiCanonicalSlug("rfp_analysis") === "rfp-analysis", "slug: rfp_analysis");
assert(
  wikiCanonicalSlug("project-gwangan-kcc-switzen") === "gwangan-kcc-switzen",
  "slug: 광안리 접두어"
);
assert(
  wikiCanonicalSlug("media-architecture-business") === "media-architecture",
  "slug: 미디어 아키텍처"
);
assert(wikiCanonicalSlug("ai_masterplan") === "ai-masterplan", "slug: ai_masterplan");
assert(wikiDocPath("rfp_analysis") === "/wiki/rfp-analysis", "문서 주소에 메뉴 없음");
assert(
  wikiSlugLookupKeys("rfp-analysis").includes("rfp_analysis"),
  "옛 slug 별칭 조회"
);
assert(
  inferWikiMenuSlug("RFP분석", "standards") === "workflow",
  "분류: RFP → 일하는 방식"
);
assert(
  inferWikiMenuSlug("광안리 KCC 스위첸 — Quartz Cube", "standards") === "projects",
  "분류: 광안리 → 프로젝트"
);
assert(
  inferWikiMenuSlug("미디어 아키텍처 사업", "standards") === "business",
  "분류: 미디어 아키텍처 → 사업"
);
assert(
  inferWikiMenuSlug("아폴론 정체성", "standards") === "identity",
  "분류: 정체성"
);
assert(
  inferWikiMenuSlug("근태 가이드", "rules") === "rules",
  "분류: 근태 → 규정"
);

console.log("\n멤버 시점 요약");
console.log("- GET /api/wiki/docs : filterVisibleWikiDocs(isAdmin=false) → 비공개 제외");
console.log("- GET /api/wiki/docs/[slug] : canViewWikiDoc → 404");
console.log("- 슈퍼관리자 /wiki : 문서는 보이되 WikiStaffHiddenMark(직원에게 안 보임)");
