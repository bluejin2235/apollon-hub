const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {loadTs, root} = require('./helpers.cjs');
const {searchWithConversationContext} = loadTs('lib/luna/search-context.ts');
const {runSearchTask} = loadTs('lib/luna/search-task.ts');
const {currentProgressLabel} = loadTs('lib/luna/progress-display.ts');

test('follow-ups carry prior user questions; a new topic never inherits the old project', () => {
  assert.equal(searchWithConversationContext('이미지도 찾아줘', ['해운대 연출 자료']), '해운대 연출 자료\n후속 요청: 이미지도 찾아줘');
  assert.equal(searchWithConversationContext('그럼 파일만 보여줘', ['광주 자료']), '광주 자료\n후속 요청: 그럼 파일만 보여줘');
  assert.equal(searchWithConversationContext('제주 미피 자료 찾아줘', ['광주 자료']), '제주 미피 자료 찾아줘');
  assert.equal(searchWithConversationContext('이미지만 찾아줘', []), '이미지만 찾아줘');
});
test('source deadline aborts the source and releases waiting parallel results', async () => {
  let taskSignal;
  await assert.rejects(runSearchTask(new AbortController().signal, 15, s => {taskSignal=s;return new Promise(()=>{});}), {name:'TimeoutError'});
  assert.equal(taskSignal.aborted, true);
});
test('user cancellation stops a pending source without waiting for its timeout', async () => {
  const abort = new AbortController();
  const task = runSearchTask(abort.signal, 60000, () => new Promise(()=>{}));
  abort.abort();
  await assert.rejects(task, {name:'AbortError'});
});
test('progress rotates actual active sources and distinguishes partial/error/stopped', () => {
  const rows = [{key:'ui_notion',state:'now',label:'노션 검색'}, {key:'ui_work',state:'now',label:'Work 검색'}];
  assert.equal(currentProgressLabel([],rows,false,0),'노션 검색');
  assert.equal(currentProgressLabel([],rows,false,3000),'Work 검색');
  assert.equal(currentProgressLabel([],rows,false,6000),'노션 검색');
  for (const [key,label] of [['partial','일부 자료 제외 · 검색 완료'],['error','검색 실패'],['stopped','답변 중지']])
    assert.equal(currentProgressLabel([{key,status:'done',label:''}],rows,true,9000),label);
});
test('shared image enrichment and link builders no longer read raw Notion index tables', () => {
  for (const file of ['lib/luna/media-vision-prompt.ts','lib/luna-admin/build-links.ts']) {
    const content=fs.readFileSync(path.join(root,file),'utf8');
    assert.doesNotMatch(content, /["']luna_notion_(pages|chunks|relations)["']/);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(root,'app/api/luna/notion/test/route.ts'),'utf8'), /NOTION_TOKEN|api\.notion\.com\/v1\/search/);
});
test('reflection rejects per-user live search evidence before shared learning', () => {
  const content=fs.readFileSync(path.join(root,'app/api/luna/reflect/route.ts'),'utf8');
  assert.ok(content.indexOf('user_scoped_evidence') < content.indexOf('.from("luna_learnings")', content.indexOf('const messages =')));
});
