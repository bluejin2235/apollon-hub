const test = require("node:test");
const assert = require("node:assert/strict");
const { CASES, EXISTING } = require("./cases.cjs");
const { registerSanitizerTests, sanitizeDom } = require("./helpers.cjs");

registerSanitizerTests("insight");

function html(id) {
  return CASES.find((item) => item.id === id).html;
}

test("insight-html 은 h2·h3·is-big·sz-lg·in-2·sup·sub 를 살린다", async () => {
  assert.match(await sanitizeDom("insight", html("h2")), /<h2>/);
  assert.match(await sanitizeDom("insight", html("h3")), /<h3>/);
  assert.match(await sanitizeDom("insight", html("h2-is-big")), /is-big/);
  assert.match(await sanitizeDom("insight", html("p-sz-lg")), /sz-lg/);
  assert.match(await sanitizeDom("insight", html("p-in-2")), /in-2/);
  assert.match(await sanitizeDom("insight", html("sup-sub")), /<sup>/);
  assert.match(await sanitizeDom("insight", html("sup-sub")), /<sub>/);
});

test("insight-html 은 ol 을 ul 로 바꾸고 img 는 버린다", async () => {
  const list = await sanitizeDom("insight", html("ol"));
  assert.match(list, /<ul>/);
  assert.doesNotMatch(list, /<ol>/);
  assert.equal(await sanitizeDom("insight", html("img")), "");
});

test("insight-html 은 팔레트 밖 색을 살리고 javascript 링크는 주소만 버린다", async () => {
  assert.match(await sanitizeDom("insight", html("off-palette-color")), /#1e40af/);
  const link = await sanitizeDom("insight", html("javascript-link"));
  assert.doesNotMatch(link, /javascript:/i);
  assert.doesNotMatch(link, /<a\b/);
  assert.match(link, /나쁜 링크/);
});

test("insight-html 기존 문단·제목·목록은 입력을 그대로 둔다", async () => {
  const keep = EXISTING.filter((item) => item.id !== "existing-nbsp");
  for (const item of keep) {
    assert.equal(await sanitizeDom("insight", item.html), item.html, item.id);
  }
});
