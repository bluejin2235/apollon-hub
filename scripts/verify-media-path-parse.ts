/**
 * 경로 해석 단위 확인
 *   npx tsx scripts/verify-media-path-parse.ts
 */
import {
  classifyFolderCategory,
  isMeaninglessFileName,
  parseMediaPath,
  shouldExcludePath
} from "../lib/luna/media-path-parse";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const sample =
  "T:\\02 Project\\2025\\250324 삼성디스플레이 신사옥 로비 미디어콘텐츠\\04 Design\\아폴론\\250327 A안 아트웍 레퍼런스, 구도 테스트\\공간\\파티클 컬러\\IMG_2847.jpg";

const p = parseMediaPath(sample);
assert(p.rootClass?.includes("02") === true, "root");
assert(p.year === "2025", "year");
assert(p.project?.includes("삼성디스플레이") === true, "project");
assert(p.stageName === "Design" || p.stageCode === "04", `stage ${p.stageName}`);
assert(p.actor === "아폴론", `actor ${p.actor}`);
assert(p.variant?.includes("A") === true || Boolean(p.dateToken), "variant/date");
assert(isMeaninglessFileName("IMG_2847.jpg"), "meaningless");
assert(!isMeaninglessFileName("재규어-천장-미디어월.png"), "meaningful");
assert(classifyFolderCategory(sample) === "our_design", "folder cat design");
assert(
  shouldExcludePath(
    "T:\\02 Project\\2025\\x\\00 Management\\계약서.pdf"
  ),
  "exclude management"
);

const promo =
  "T:\\02 Project\\2025\\250324 x\\88 홍보마케팅\\01 레퍼런스 영상\\03 Thumnail\\still cut\\a.jpg";
assert(classifyFolderCategory(promo) === "field_photo", "promo still");

console.log("path summary:", p.summary);
console.log("OK media-path-parse");
