const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs, fakeDb } = require('./helpers.cjs');
const m = loadTs('lib/luna/notion-keyword.ts', { '@/lib/luna/embedding': { EMBEDDING_SCORE_WEIGHT: 10 } });
test('Korean-only questions retain exact keyword retrieval with sufficient vector hits', () => {
  const plan = m.planNotionSearchKeywords('', '고래쇼 자료 찾아줘', []);
  assert.deepEqual(m.pickLightKeywords(plan), ['고래쇼']);
  assert.ok(!plan.keywords.includes('자료'));
  const other = m.pickLightKeywords(m.planNotionSearchKeywords('', '수원화성 야간경관 진행상황 알려줘', []));
  assert.deepEqual(other, ['수원화성', '야간경관']);
});
test('date and English query variants survive within the existing query budget', () => {
  const light = m.pickLightKeywords(m.planNotionSearchKeywords('', '해운대스퀘어 260204 KV 이미지 보여줘', []));
  assert.ok(light.includes('해운대스퀘어'));
  assert.ok(light.includes('260204'));
  assert.ok(light.includes('KV'));
  assert.ok(light.length <= 6);
  assert.deepEqual(m.pickLightKeywords(m.planNotionSearchKeywords('', '자료 찾아줘', [])), []);
});
test('exact Korean body evidence enters hybrid results even when vectors miss it', async () => {
  const db = fakeDb({
    luna_notion_pages: [{ page_id: 'source', title: '프로젝트 제작 보고', archived: false }],
    luna_notion_chunks: [{ chunk_id: 'exact', page_id: 'source', heading: '장면 구성', text: '고래쇼 장면 연출과 제작 과정', position: 1 }]
  });
  const plan = m.planNotionSearchKeywords('', '고래쇼 자료 찾아줘', []);
  const hit = await m.matchNotionChunksByKeyword(db, m.pickLightKeywords(plan), { light: true, limit: 60 });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].chunk_id, 'exact');
  const merged = m.mergeNotionHybridChunkHits([
    { chunk_id: 'v1', page_id: 'p1', similarity: .4 },
    { chunk_id: 'v2', page_id: 'p2', similarity: .38 },
    { chunk_id: 'v3', page_id: 'p3', similarity: .35 }
  ], hit);
  assert.ok(merged.some(h => h.chunk_id === 'exact' && h.match_via === 'keyword'));
  assert.equal(merged.length, 4);
});
test('rare project body evidence outranks many generic topic headings within the same cap',async()=>{
 const others=Array.from({length:30},(_,i)=>({page_id:`other${i}`,title:'공개공지 제안',archived:false}));
 const chunks=others.flatMap(p=>Array.from({length:3},(_,i)=>({chunk_id:`${p.page_id}-${i}`,page_id:p.page_id,heading:'공개공지',text:'공개공지 설계 제안',position:i})));
 const db=fakeDb({luna_notion_pages:[...others,{page_id:'target',title:'Design report',archived:false}],luna_notion_chunks:[...chunks,{chunk_id:'target-body',page_id:'target',heading:'Overview',text:'샘플문화센터 공개공지의 기획 및 설계를 수행했습니다.',position:0}]});
 const hits=await m.matchNotionChunksByKeyword(db,['샘플문화센터','공개공지'],{light:true,limit:3});
 assert.equal(hits[0].chunk_id,'target-body');
 assert.equal(hits.length,3);
 const index=loadTs('lib/luna/notion-index-search.ts',{'@/lib/luna/embedding':{EMBEDDING_SCORE_WEIGHT:10}});
 const pack=loadTs('lib/luna/source-pack.ts',{'@/lib/luna/embedding':{EMBEDDING_SCORE_WEIGHT:10}});
 const hybrid=m.mergeNotionHybridChunkHits([],hits);
 const built=await index.buildIndexedSourcesFromChunks(db,hybrid.map(h=>({...h,similarity:h.similarity??0})),'샘플문화센터 공개공지는 누가 제작했어?',{top:3,perPage:1});
 const injected=pack.takeTopNotionSourcesForLlm(built.sources,1,'샘플문화센터 공개공지는 누가 제작했어?');
 assert.equal(injected[0].id,'target');
 assert.match(injected[0].excerpt,/샘플문화센터/);
});
