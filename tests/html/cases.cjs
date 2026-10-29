/** 세 정리기에 같은 입력을 넣는 표본. 합치기 전의 지금 동작을 기록한다. */

const CASES = [
  { id: "plain-p", html: "<p>평범한 문단</p>" },
  { id: "inline-biu", html: "<p><b>굵게</b> <i>기울임</i> <u>밑줄</u></p>" },
  { id: "h2", html: "<h2>소제목</h2>" },
  { id: "h3", html: "<h3>작은 제목</h3>" },
  { id: "h2-is-big", html: '<h2 class="is-big">큰 제목</h2>' },
  { id: "p-sz-lg", html: '<p class="sz-lg">크게</p>' },
  { id: "p-in-2", html: '<p class="in-2">들여쓰기</p>' },
  { id: "sup-sub", html: "<p>m<sup>2</sup> 와 H<sub>2</sub>O</p>" },
  { id: "ul", html: "<ul><li>점 목록</li></ul>" },
  { id: "ol", html: "<ol><li>번호 목록</li></ol>" },
  { id: "palette-color", html: '<p><span style="color:#b0231e">팔레트 색</span></p>' },
  { id: "off-palette-color", html: '<p><span style="color:#1e40af">팔레트 밖 색</span></p>' },
  { id: "https-link", html: '<p><a href="https://apollonworks.com">링크</a></p>' },
  { id: "javascript-link", html: '<p><a href="javascript:alert(1)">나쁜 링크</a></p>' },
  { id: "img", html: '<img src="https://x/y.jpg" alt="그림">' },
  { id: "table", html: "<table><tr><td>표</td></tr></table>" },
  { id: "script", html: "<script>alert(1)</script>" },
  { id: "onclick", html: '<p onclick="x()">글</p>' },
  { id: "css-injection-span", html: '<p><span style="color:#fff; background:url(x)">글</span></p>' }
];

const EXISTING = [
  {
    id: "existing-anchor-tenant",
    html: "<p>이렇게 방문의 중심을 맡는 존재가 <b>전통적인 앵커 테넌트</b>다.</p>"
  },
  {
    id: "existing-nbsp",
    html: "<p>iF 디자인 어워드&nbsp;2023에서 두 개 부문 본상을&nbsp;수상했다.</p>"
  },
  {
    id: "existing-h2",
    html: "<h2>앵커의 변화, 테넌트 유치에서 고유한 경험의 기획으로 변화</h2>"
  },
  {
    id: "existing-ul",
    html: "<ul><li><b>장소에 맞춰 규모와 형태를 조정할 수 있다.</b></li></ul>"
  }
];

const ALL = [...CASES, ...EXISTING];

const KINDS = ["insight", "lead", "issue"];
const FN = {
  insight: "sanitizeInsightHtml",
  lead: "sanitizeLeadHtml",
  issue: "sanitizeIssueHtml"
};
const FILES = {
  insight: "lib/website/insight-html.ts",
  lead: "lib/website/lead-html.ts",
  issue: "lib/issues/html.ts"
};

module.exports = { ALL, CASES, EXISTING, FILES, FN, KINDS };
