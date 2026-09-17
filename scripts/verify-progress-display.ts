import assert from "node:assert/strict";
import {
  buildProgressDisplayRows,
  buildDetailTimingRows,
  uiChannelsForScope,
  formatCountRight
} from "../lib/luna/progress-display";

assert.deepEqual(uiChannelsForScope("term"), {
  glossary: true,
  wiki: false,
  notion: false,
  link: false,
  work: false,
  image: false,
  nasText: false,
  web: false
});
assert.equal(uiChannelsForScope("policy").wiki, true);
assert.equal(uiChannelsForScope("policy").glossary, false);
assert.equal(uiChannelsForScope("project").notion, true);
assert.equal(uiChannelsForScope("project").link, true);
assert.equal(uiChannelsForScope("reference").image, true);

const rows = buildProgressDisplayRows({
  steps: [
    { key: "ui_read", label: "질문을 읽었습니다 — 용어·정의", status: "done" },
    { key: "ui_glossary", label: "용어사전을 찾았습니다", status: "done", right: "1건" },
    { key: "classify", label: "내부", status: "done" },
    { key: "answer", label: "정리하는 중…", status: "running" }
  ],
  isComplete: false
});
assert.equal(rows.length, 3);
assert.equal(rows[0]!.state, "done");
assert.equal(rows[2]!.state, "now");
assert.equal(formatCountRight(0), "0건");

const detail = buildDetailTimingRows({
  steps: [
    { key: "ui_read", label: "질문을 읽었습니다 — 프로젝트 현황", status: "done" },
    { key: "kw", label: "검색어", status: "done", ms: 300 },
    { key: "ui_notion", label: "노션", status: "done", right: "12건", ms: 800 },
    { key: "answer", label: "정리", status: "done", ms: 6700 }
  ],
  timings: {
    search_ms: 800,
    link_ms: 400,
    llm_ms: 6700,
    candidates_found: 12,
    candidates_added: 18
  },
  classificationLabel: "프로젝트 현황",
  classifySource: "rule",
  keywords: "시즌4"
});
assert.ok(detail.some((r) => r.key === "type" && r.right === "규칙"));
assert.ok(detail.some((r) => r.key === "notion" && r.right.includes("12건")));
assert.ok(detail.some((r) => r.key === "answer" && r.right.includes("초")));

console.log("progress-display ok");
