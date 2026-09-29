const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const mocks={'@/lib/luna/embedding':{EMBEDDING_SCORE_WEIGHT:10}};
const {selectNotionChunkHits}=loadTs('lib/luna/notion-index-search.ts',mocks);
const {takeTopNotionSourcesForLlm}=loadTs('lib/luna/source-pack.ts',mocks);
test('broad retrieval retains semantic pages when lexical scores are on a much larger scale',()=>{
 const words=Array.from({length:60},(_,i)=>({chunk_id:'k'+i,page_id:'k'+Math.floor(i/2),keyword_score:1000-i,fused_score:1000-i,similarity:0}));
 const meanings=Array.from({length:20},(_,i)=>({chunk_id:'v'+i,page_id:'v'+i,keyword_score:0,fused_score:5-i/100,similarity:.5-i/1000}));
 const out=selectNotionChunkHits([...words,...meanings],{top:24,perPage:2,balanced:true});
 assert.equal(out.filter(h=>h.page_id.startsWith('v')).length,6);
 assert.equal(new Set(out.map(h=>h.page_id)).size,24);
 assert.equal(out[0].chunk_id,'k0');assert.equal(out[3].chunk_id,'v0');
 assert.equal(out[0].keyword_score,1000);
});
test('broad answer reserves room for related source bodies rather than only initial hits',()=>{
 const base=Array.from({length:32},(_,i)=>({id:'base'+i,title:'기본 자료',excerpt:'숲 본문',match_score:100-i,keyword_score:5}));
 const linked=Array.from({length:12},(_,i)=>({id:'linked'+i,title:'연결 회의록',excerpt:'후속 일정',match_score:3,keyword_score:0,link_expanded:true}));
 const selected=takeTopNotionSourcesForLlm([...base,...linked],32,'숲 자료 모두 찾아줘');
 assert.equal(selected.length,32);assert.equal(selected.filter(s=>s.link_expanded).length,8);
 assert.equal(new Set(selected.map(s=>s.id)).size,32);
 assert.equal(takeTopNotionSourcesForLlm([...base,...linked],3,'특정 문서').filter(s=>s.link_expanded).length,0);
});
