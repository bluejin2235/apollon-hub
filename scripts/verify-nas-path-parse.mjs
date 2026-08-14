import {
  parseOfficePath,
  scanBareOfficePath,
  findAllWorkserverPathSpans,
  preprocessFolderFileLines,
  splitMarkdownByWorkserverPaths,
  formatNasFolderBreadcrumb,
  fileExtBadgeKind,
  inferFileTag,
  stripFileExtension
} from "../lib/luna/nas-path.ts";
import { parseAssumeMarkers } from "../lib/luna/chat-response.ts";
import {
  parseLunaAnswer,
  extractNotionPagesFromMarkdown,
  stripNotionLinksFromMarkdown,
  composeLunaResultLayout
} from "../lib/luna/answer-render.ts";

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

console.log("\n=== folder-only backtick ===");
const folderOnly =
  "위치:\n`T:\\01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230714 이수만 회장님 첫 미팅\\`\n끝";
const folderOnlySegs = splitMarkdownByWorkserverPaths(folderOnly).filter(
  (s) => s.type === "paths"
);
if (
  folderOnlySegs.length === 1 &&
  folderOnlySegs[0].groups[0]?.files.length === 0 &&
  folderOnlySegs[0].groups[0]?.folderRawPath.includes("첫 미팅")
) {
  console.log("PASS folder-only card");
} else {
  console.log("FAIL folder-only", folderOnlySegs);
  failed = true;
}

console.log("\n=== bold filename + folder line ===");
const boldFolder = `**아폴론_청담오피스라운지 미디어아트_230720_계약용.pptx**
\`T:\\01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230714 이수만 회장님 첫 미팅\\\``;
const boldMerged = preprocessFolderFileLines(boldFolder);
const boldSegs = splitMarkdownByWorkserverPaths(boldFolder).filter((s) => s.type === "paths");
if (
  boldMerged.includes("아폴론_청담오피스라운지 미디어아트_230720_계약용.pptx") &&
  boldSegs[0]?.groups[0]?.files[0] ===
    "아폴론_청담오피스라운지 미디어아트_230720_계약용.pptx"
) {
  console.log("PASS bold filename + folder merge");
} else {
  console.log("FAIL bold+folder", boldMerged, boldSegs);
  failed = true;
}

console.log("\n=== parseLunaAnswer (DB sample) ===");
const dbSample = `최종 제안서는 이수만 회장님 첫 미팅용으로 만든 **계약용 버전**이 가장 나중 날짜입니다.

**아폴론_청담오피스라운지 미디어아트_230720_계약용.pptx**
\`T:\\01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230714 이수만 회장님 첫 미팅\\\`

노션에도 같은 날짜 기록이 있습니다:
[230720 PROPOSAL](https://app.notion.com/p/example)

[[가정: 수정일 기준으로 가장 나중인 230720 계약용을 최종본으로 봤어요. 다른 기준이 있으면 알려주세요.]]`;

const parsed = parseLunaAnswer(dbSample);
const assumeOk =
  parsed.assumptions.length === 1 &&
  parsed.assumptions[0].includes("230720") &&
  !parsed.markdown.includes("[[");
const pathOk = parsed.segments.some(
  (s) =>
    s.type === "paths" &&
    s.groups[0]?.files[0] ===
      "아폴론_청담오피스라운지 미디어아트_230720_계약용.pptx"
);
if (assumeOk && pathOk) {
  console.log("PASS parseLunaAnswer DB sample");
} else {
  console.log("FAIL parseLunaAnswer", {
    assumptions: parsed.assumptions,
    hasMarker: parsed.markdown.includes("[["),
    segments: parsed.segments
  });
  failed = true;
}

const assumeOnly = parseAssumeMarkers("[[가정: 테스트 가정]] 본문");
if (assumeOnly.assumptions[0] === "테스트 가정" && assumeOnly.body === "본문") {
  console.log("PASS parseAssumeMarkers indexOf");
} else {
  console.log("FAIL parseAssumeMarkers", assumeOnly);
  failed = true;
}

console.log("\n=== breadcrumb / ext / tag ===");

const crumb = formatNasFolderBreadcrumb(
  "01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230714 이수만 회장님 첫 미팅"
);
if (crumb === "01 사업개발 › 2023 › 230628 청담동 오피스 라운지 › 03 Document › 230714 이수만 회장님 첫 미팅") {
  console.log("PASS breadcrumb");
} else {
  console.log("FAIL breadcrumb", crumb);
  failed = true;
}

if (
  fileExtBadgeKind("a.pptx") === "PPT" &&
  fileExtBadgeKind("a.xlsx") === "XLS" &&
  fileExtBadgeKind("a.pdf") === "PDF" &&
  fileExtBadgeKind("a.docx") === "DOC" &&
  fileExtBadgeKind("a.dwg") === "DWG" &&
  fileExtBadgeKind("a.png") === "IMG" &&
  fileExtBadgeKind("a.mp4") === "VID" &&
  fileExtBadgeKind("a.txt") === "FILE"
) {
  console.log("PASS ext badges");
} else {
  console.log("FAIL ext badges");
  failed = true;
}

if (
  stripFileExtension("foo.pptx") === "foo" &&
  inferFileTag("아폴론_청담_230720_계약용.pptx")?.kind === "final" &&
  inferFileTag("아폴론_청담_230711.pptx") === null &&
  inferFileTag("견적서_260708_FIN.xlsx")?.kind === "final"
) {
  console.log("PASS file tag");
} else {
  console.log("FAIL file tag", inferFileTag("견적서_260708_FIN.xlsx"));
  failed = true;
}

const notionMd = `노션: [230720 PROPOSAL](https://app.notion.com/p/example)\n\n[[가정: x]]`;
const notionPages = extractNotionPagesFromMarkdown(notionMd);
const stripped = stripNotionLinksFromMarkdown(notionMd);
if (
  notionPages.length === 1 &&
  notionPages[0].title === "230720 PROPOSAL" &&
  !stripped.includes("app.notion.com")
) {
  console.log("PASS notion extract/strip");
} else {
  console.log("FAIL notion", notionPages, stripped);
  failed = true;
}

console.log("\n=== composeLunaResultLayout (DB sample) ===");
const layoutRaw = `청담 오피스라운지 제안서는 두 버전이 확인됩니다.

**Work서버 (T드라이브)**

- \`아폴론_청담오피스라운지 미디어아트_230711.pptx\`
  → \`T:\\01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230711 제안서\\\`

- \`아폴론_청담오피스라운지 미디어아트_230720.pptx\`
  → \`T:\\01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230714 이수만 회장님 첫 미팅\\\`

- \`아폴론_청담오피스라운지 미디어아트_230720_계약용.pptx\`
  → 같은 폴더 안에 계약용 버전도 있어요.

**노션 (정리본)**

- [230711 청담동 오피스 라운지 MEDIA ART INSTALLATION PROPOSAL](https://app.notion.com/p/230711)
- [230720 청담동 오피스 라운지 MEDIA ART INSTALLATION PROPOSAL](https://app.notion.com/p/230720)

230711이 초안, 230720이 이수만 회장님 첫 미팅용이자 계약 직전 버전으로 보입니다.

[[가정: "제안서"를 수주 전 BD 단계 문서로 해석했어요. 계약 후 착수 보고서나 디자인 시안이 필요하신 거라면 알려주세요.]]`;

const layoutCards = [
  {
    type: "nas",
    title: "아폴론_청담오피스라운지 미디어아트_230720_계약용.pptx",
    url: null,
    thumbnail: null,
    description: "★ 01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230714 이수만 회장님 첫 미팅\\아폴론_청담오피스라운지 미디어아트_230720_계약용.pptx",
    drive: "T",
    raw_path: "01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230714 이수만 회장님 첫 미팅\\아폴론_청담오피스라운지 미디어아트_230720_계약용.pptx",
    is_file: true
  },
  {
    type: "nas",
    title: "아폴론_청담오피스라운지 미디어아트_230720.pptx",
    url: null,
    thumbnail: null,
    description: "★ 01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230714 이수만 회장님 첫 미팅\\아폴론_청담오피스라운지 미디어아트_230720.pptx",
    drive: "T",
    raw_path: "01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230714 이수만 회장님 첫 미팅\\아폴론_청담오피스라운지 미디어아트_230720.pptx",
    is_file: true
  },
  {
    type: "nas",
    title: "아폴론_청담오피스라운지 미디어아트_230711.pptx",
    url: null,
    thumbnail: null,
    description: "★ 01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230711 제안서\\아폴론_청담오피스라운지 미디어아트_230711.pptx",
    drive: "T",
    raw_path: "01 사업개발\\2023\\230628 청담동 오피스 라운지\\03 Document\\230711 제안서\\아폴론_청담오피스라운지 미디어아트_230711.pptx",
    is_file: true
  },
  {
    type: "nas",
    title: "HW 볼팍견적_230823.xlsx",
    url: null,
    thumbnail: null,
    description: "02 Project\\2023\\230724 청담오피스라운지 미디어아트설치\\00 Management\\01 견적\\HW 볼팍견적_230823.xlsx",
    drive: "T",
    raw_path: "02 Project\\2023\\230724 청담오피스라운지 미디어아트설치\\00 Management\\01 견적\\HW 볼팍견적_230823.xlsx",
    is_file: true
  },
  {
    type: "notion",
    title: "230628 청담동 오피스 라운지(EB 완료)",
    url: "https://app.notion.com/p/230628",
    thumbnail: null,
    description: ""
  }
];

const layoutNotion = [
  { id: "a", title: "230628 청담동 오피스 라운지(EB 완료)", url: "https://app.notion.com/p/230628" },
  { id: "b", title: "230711 청담동 오피스 라운지 MEDIA ART INSTALLATION PROPOSAL", url: "https://app.notion.com/p/230711" },
  { id: "c", title: "230720 청담동 오피스 라운지 MEDIA ART INSTALLATION PROPOSAL", url: "https://app.notion.com/p/230720" }
];

const layout = composeLunaResultLayout({
  raw: layoutRaw,
  cards: layoutCards,
  notionSources: layoutNotion
});

const folders = layout.nasGroups.map((g) => g.folderRawPath.split("\\").pop());
const layoutOk =
  layout.lead.startsWith("청담 오피스라운지 제안서는") &&
  layout.nasGroups.length === 2 &&
  folders.includes("230714 이수만 회장님 첫 미팅") &&
  folders.includes("230711 제안서") &&
  layout.nasGroups[0].files.includes("아폴론_청담오피스라운지 미디어아트_230720_계약용.pptx") &&
  layout.notionItems.length === 3 &&
  layout.notionItems[0].title.startsWith("230720") &&
  layout.body.includes("230711이 초안") &&
  !layout.body.includes("T:\\") &&
  !layout.body.includes("[[") &&
  layout.assume.length === 1 &&
  layout.assume[0].includes("제안서");

if (layoutOk) {
  console.log("PASS compose layout order");
} else {
  console.log("FAIL compose layout", {
    lead: layout.lead,
    folders,
    files: layout.nasGroups.map((g) => g.files),
    notion: layout.notionItems.map((n) => n.title),
    body: layout.body,
    assume: layout.assume
  });
  failed = true;
}

if (failed) process.exit(1);
console.log("\nALL PASS");
