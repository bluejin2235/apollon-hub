import {
  parseOfficePath,
  scanBareOfficePath,
  findAllWorkserverPathSpans,
  preprocessFolderFileLines,
  splitMarkdownByWorkserverPaths
} from "../lib/luna/nas-path.ts";

const CASES = [
  {
    path: "T:\\01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230714 이수만 회장님 첫 미팅\\아폴론_청담오피스라운지 미디어아rt_230720_계약용.pptx".replace(
      "미디어아rt",
      "미디어아트"
    ),
    file: "아폴론_청담오피스라운지 미디어아트_230720_계약용.pptx"
  },
  {
    path: "T:\\02 Project\\2026\\260713 더후 글로벌 론칭\\00 Management\\01 견적\\260708 견적서\\K2_Apollon_더후이벤트영상제작_견적서_260708_FIN.xlsx",
    file: "K2_Apollon_더후이벤트영상제작_견적서_260708_FIN.xlsx"
  },
  {
    path: "P:\\두엠\\2026 공동작업\\",
    file: null
  },
  {
    path: "T:\\02 Project\\2024\\240910 인스파이어 시즌3 쇼콘텐츠제작\\01 Planning\\01 Document\\01 착수보고\\[아폴론] 인스파이어 시즌3 콘텐츠제작_수행계획서_240906.pptx",
    file: "[아폴론] 인스파이어 시즌3 콘텐츠제작_수행계획서_240906.pptx"
  }
];

let failed = false;

console.log("=== parseOfficePath ===");
for (const c of CASES) {
  const parsed = parseOfficePath(c.path);
  const ok =
    parsed &&
    (c.file
      ? parsed.isFile && parsed.fileName === c.file
      : !parsed.isFile && parsed.fileName === null);
  console.log(ok ? "PASS" : "FAIL", c.path.slice(0, 60) + "...");
  if (!ok) {
    console.log("  parsed:", parsed);
    failed = true;
  }
}

console.log("\n=== scanBareOfficePath (inline prose) ===");
const inline =
  "파일: T:\\01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230714 이수만 회장님 첫 미팅\\아폴론_청담오피스라운지 미디어아트_230720_계약용.pptx 에 있습니다.";
const scanned = scanBareOfficePath(inline, 0);
const expect =
  "T:\\01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230714 이수만 회장님 첫 미팅\\아폴론_청담오피스라운지 미디어아트_230720_계약용.pptx";
if (scanned?.raw === expect) {
  console.log("PASS inline scan");
} else {
  console.log("FAIL inline scan");
  console.log("  got:", scanned?.raw);
  failed = true;
}

console.log("\n=== backtick path ===");
const md = "경로는 `T:\\02 Project\\2026\\260713 더후 글로벌 론칭\\00 Management\\01 견적\\260708 견적서\\K2_Apollon_더후이벤트영상제작_견적서_260708_FIN.xlsx` 입니다.";
const spans = findAllWorkserverPathSpans(md);
if (
  spans.length === 1 &&
  !spans[0].original.includes("`") &&
  spans[0].path.endsWith(".xlsx")
) {
  console.log("PASS backtick stripped, full path");
} else {
  console.log("FAIL backtick", spans);
  failed = true;
}

console.log("\n=== preprocessFolderFileLines ===");
const folderFileRaw =
  "파일 위치:\n\n`T:\\02 Project\\2026\\260713 더후 글로벌 론칭\\00 Management\\01 견적\\260708 견적서\\`\n→ K2_Apollon_더후이벤트영상제작_견적서_260708_FIN.xlsx";
const folderFileMerged = preprocessFolderFileLines(folderFileRaw);
const folderFileExpected =
  "파일 위치:\n\n`T:\\02 Project\\2026\\260713 더후 글로벌 론칭\\00 Management\\01 견적\\260708 견적서\\K2_Apollon_더후이벤트영상제작_견적서_260708_FIN.xlsx`";
if (folderFileMerged === folderFileExpected) {
  console.log("PASS folder line + file line merge");
} else {
  console.log("FAIL preprocessFolderFileLines");
  console.log("  got:", folderFileMerged);
  failed = true;
}

const folderFileSegs = splitMarkdownByWorkserverPaths(folderFileRaw);
const folderFilePathSegs = folderFileSegs.filter((s) => s.type === "paths");
if (
  folderFilePathSegs.length === 1 &&
  folderFilePathSegs[0].groups[0]?.files[0] ===
    "K2_Apollon_더후이벤트영상제작_견적서_260708_FIN.xlsx"
) {
  console.log("PASS split after folder/file preprocess");
} else {
  console.log("FAIL split after preprocess", folderFilePathSegs);
  failed = true;
}

console.log("\n=== split preserves non-path text ===");
const mixed = `설명입니다.

- \`T:\\01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230714 이수만 회장님 첫 미팅\\아폴론_청담오피스라운지 미디어아트_230720_계약용.pptx\`

노션: [230711 PROPOSAL](https://notion.so/example)

[[가정: 테스트 가정]]`;

const segs = splitMarkdownByWorkserverPaths(mixed);
const textJoined = segs
  .filter((s) => s.type === "text")
  .map((s) => s.value)
  .join("");
if (
  textJoined.includes("노션") &&
  textJoined.includes("notion.so") &&
  textJoined.includes("가정") &&
  !textJoined.includes("아폴론_청담")
) {
  console.log("PASS notion/assume preserved in text segments");
} else {
  console.log("FAIL mixed split");
  console.log(textJoined);
  failed = true;
}

const pathSegs = segs.filter((s) => s.type === "paths");
if (pathSegs.length === 1 && pathSegs[0].groups[0]?.files[0]?.includes("계약용")) {
  console.log("PASS path card group");
} else {
  console.log("FAIL path groups", pathSegs);
  failed = true;
}

if (failed) process.exit(1);
console.log("\nALL PASS");
