const test = require("node:test");
const assert = require("node:assert/strict");
const { CASES, EXISTING } = require("./cases.cjs");
const { registerSanitizerTests, sanitizeDom } = require("./helpers.cjs");

registerSanitizerTests("lead");

function html(id) {
  return CASES.find((item) => item.id === id).html;
}

test("lead-html 은 h2·h3 를 p 로 누른다", async () => {
  const h2 = await sanitizeDom("lead", html("h2"));
  const h3 = await sanitizeDom("lead", html("h3"));
  const big = await sanitizeDom("lead", html("h2-is-big"));
  assert.match(h2, /<p>/);
  assert.match(h3, /<p>/);
  assert.match(big, /<p>/);
  assert.doesNotMatch(h2, /<h2>/);
  assert.doesNotMatch(h3, /<h3>/);
  assert.doesNotMatch(big, /<h2>/);
});

test("lead-html 은 class 와 sup·sub 를 버린다", async () => {
  assert.doesNotMatch(await sanitizeDom("lead", html("h2-is-big")), /is-big/);
  assert.doesNotMatch(await sanitizeDom("lead", html("p-sz-lg")), /sz-lg/);
  assert.doesNotMatch(await sanitizeDom("lead", html("p-in-2")), /in-2/);
  const sub = await sanitizeDom("lead", html("sup-sub"));
  assert.doesNotMatch(sub, /<sup>/);
  assert.doesNotMatch(sub, /<sub>/);
});

test("lead-html 은 ol 을 ul 로 바꾸고 img 는 버린다", async () => {
  const list = await sanitizeDom("lead", html("ol"));
  assert.match(list, /<ul>/);
  assert.doesNotMatch(list, /<ol>/);
  assert.equal(await sanitizeDom("lead", html("img")), "");
});

test("lead-html 기존 문단·목록은 입력을 그대로 두고 h2 는 p 가 된다", async () => {
  const para = EXISTING.find((item) => item.id === "existing-anchor-tenant");
  const list = EXISTING.find((item) => item.id === "existing-ul");
  const heading = EXISTING.find((item) => item.id === "existing-h2");
  assert.equal(await sanitizeDom("lead", para.html), para.html);
  assert.equal(await sanitizeDom("lead", list.html), list.html);
  const out = await sanitizeDom("lead", heading.html);
  assert.doesNotMatch(out, /<h2>/);
  assert.match(out, /<p>/);
});
