const test = require("node:test");
const assert = require("node:assert/strict");
const { CASES, EXISTING } = require("./cases.cjs");
const { registerSanitizerTests, sanitizeDom } = require("./helpers.cjs");

registerSanitizerTests("issue");

function html(id) {
  return CASES.find((item) => item.id === id).html;
}

test("issue-html 은 h2·h3 를 살리되 class 와 sup·sub 는 버린다", async () => {
  assert.match(await sanitizeDom("issue", html("h2")), /<h2>/);
  assert.match(await sanitizeDom("issue", html("h3")), /<h3>/);
  assert.doesNotMatch(await sanitizeDom("issue", html("h2-is-big")), /is-big/);
  assert.doesNotMatch(await sanitizeDom("issue", html("p-sz-lg")), /sz-lg/);
  assert.doesNotMatch(await sanitizeDom("issue", html("p-in-2")), /in-2/);
  const sub = await sanitizeDom("issue", html("sup-sub"));
  assert.doesNotMatch(sub, /<sup>/);
  assert.doesNotMatch(sub, /<sub>/);
});

test("issue-html 은 img 와 ol 을 살린다", async () => {
  const img = await sanitizeDom("issue", html("img"));
  const list = await sanitizeDom("issue", html("ol"));
  assert.match(img, /<img\b/);
  assert.match(img, /https:\/\/x\/y\.jpg/);
  assert.match(list, /<ol>/);
  assert.doesNotMatch(list, /<ul>/);
});

test("issue-html 은 javascript 링크 주소를 버리고 onclick 은 버린다", async () => {
  const link = await sanitizeDom("issue", html("javascript-link"));
  assert.doesNotMatch(link, /javascript:/i);
  assert.doesNotMatch(link, /<a\b/);
  const click = await sanitizeDom("issue", html("onclick"));
  assert.doesNotMatch(click, /onclick/i);
});

test("issue-html 기존 문단·제목·목록은 입력을 그대로 둔다", async () => {
  const keep = EXISTING.filter((item) => item.id !== "existing-nbsp");
  for (const item of keep) {
    assert.equal(await sanitizeDom("issue", item.html), item.html, item.id);
  }
});
