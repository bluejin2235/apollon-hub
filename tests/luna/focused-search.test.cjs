const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers.cjs');
function harness({cards = [], rows = [], embedding = [0.1], pause} = {}) {
  const calls = [], saved = [];
  const { executeFocusedSearch } = loadTs('lib/luna/focused-search.ts', {
    '@/lib/luna/embedding': {createQueryEmbedding: async () => { calls.push('embedding'); if(pause) await pause; return embedding; }},
    '@/lib/luna/ask-what': {parseAskedWhat: () => ({projectPhrases: []})},
    '@/lib/luna/media-index-search': {searchMediaForLuna: async () => { calls.push('images'); return {cards}; }},
    '@/lib/luna/workserver-explore': {exploreWorkserverFallback: async () => { calls.push('files'); return rows; }}
  });
  const run = (mode, signal = new AbortController().signal) => executeFocusedSearch({admin: {}, signal, conversationId:'owned-conversation', message:'숲의 빛', mode, evaluation:true, persist:async data => {saved.push(...data);return {error:null};}});
  return {calls,saved,run};
}
test('image mode uses only media retrieval and persists actual cards', async () => {
  const card={type:'image',title:'숲',url:null,thumbnail:'image.jpg',description:'숲'};
  const h=harness({cards:[card]}); const text=await h.run('images').text();
  assert.deepEqual(h.calls,['embedding','images']);
  assert.match(text,/관련 이미지 1개/);
  assert.deepEqual(h.saved[1].metadata.cards,[card]);
  assert.deepEqual(h.saved[1].metadata.notion_sources,[]);
});
test('file mode preserves indexed path and does not call image or Notion retrieval', async () => {
  const path='01 사업개발\\연출\\제안서.pptx';
  const h=harness({rows:[{drive:'T',path,type:'file',file_summary:null}]});
  await h.run('files').text(); assert.deepEqual(h.calls,['files']);
  assert.equal(h.saved[1].metadata.cards[0].raw_path,path);
  assert.equal(h.saved[1].metadata.cards[0].is_file,true);
});
test('missing image embedding reports failure instead of claiming zero matches', async () => {
  const h=harness({embedding:null}); const text=await h.run('images').text();
  assert.match(text,/이미지 검색을 준비하지 못했습니다/); assert.equal(h.saved.length,0);
});
test('cancellation during retrieval prevents result persistence and emission', async () => {
  let resolve; const pause=new Promise(r => {resolve=r}); const abort=new AbortController();
  const h=harness({pause}); const response=h.run('images',abort.signal);
  abort.abort();resolve();const text=await response.text();
  assert.equal(h.saved.length,0);assert.deepEqual(h.calls,['embedding']);assert.doesNotMatch(text,/관련 이미지/);
});
test('Rai copying uses the user mount without modifying Korean indexed suffixes',()=>{
 const {raiPathForOfficePath}=loadTs('lib/luna/nas-path.ts');
 assert.equal(raiPathForOfficePath('T:\\01 사업개발\\연출', {mode:'office',prefixT:'R:\\Work',prefixP:''}), 'R:\\Work\\01 사업개발\\연출');
 assert.equal(raiPathForOfficePath('P:\\자료', {mode:'office',prefixT:'',prefixP:'Y:\\Partners\\'}), 'Y:\\Partners\\자료');
});
