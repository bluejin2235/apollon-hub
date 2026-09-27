const test = require('node:test');
const assert = require('node:assert/strict');
const {loadTs,fakeDb} = require('./helpers.cjs');
const overrides = {'@/lib/luna/embedding':{EMBEDDING_SCORE_WEIGHT:10}};
const index = loadTs('lib/luna/notion-index-search.ts',overrides);
const notion = loadTs('lib/luna/notion.ts');
const pack = loadTs('lib/luna/source-pack.ts',overrides);
const filter = loadTs('lib/luna/search-filter.ts');
const {prepareSearchTerms} = loadTs('lib/luna/workserver.ts');
const exact = Array.from({length:5},(_,i)=>({chunk_id:`k${i}`,page_id:`p${i}`,similarity:0,keyword_score:2,fused_score:2,match_via:'keyword'}));
const vector = Array.from({length:20},(_,i)=>({chunk_id:`v${i}`,page_id:`v${i}`,similarity:.47,keyword_score:0,embedding_score:4.7,fused_score:4.7,match_via:'embedding'}));
test('exact body passages survive chunk selection, page caps, and final prompt selection',async()=>{
 const pages=[...exact,...vector].map(h=>({page_id:h.page_id,title:`Document ${h.page_id}`,parent_id:null,path_titles:[],url:`https://notion.so/${h.page_id}`}));
 const chunks=[...exact,...vector].map(h=>({chunk_id:h.chunk_id,page_id:h.page_id,heading:'Intro',text:h.keyword_score ? '서론 '.repeat(300)+'고래쇼는 내부 제작한 공연이다. 출처 근거 설명.' : '별개의 전시 제안과 다른 사례',position:0}));
 const built=await index.buildIndexedSourcesFromChunks(fakeDb({luna_notion_pages:pages,luna_notion_chunks:chunks}),[...vector,...exact],'고래쇼 자료 찾아줘');
 const top=pack.takeTopNotionSourcesForLlm(built.sources,3);
 assert.ok(top.filter(s=>s.keyword_score>0).length>=2);
 assert.ok(top.some(s=>s.similarity>0));
 const prompt=notion.formatNotionSourcesForPrompt(top,{compact:true});
 assert.match(prompt,/고래쇼는 내부 제작한 공연이다/);
 assert.ok(top.filter(s=>s.keyword_score>0).every(s=>s.excerpt.includes('고래쇼')));
});
test('relaxed show keyword does not restore failed compound, but project and date remain',()=>{
 const result=prepareSearchTerms('고래 쇼','인스파이어 고래쇼 260204 자료 찾아줘');
 assert.ok(result.includes('고래'));
 assert.ok(!result.includes('고래쇼'));
 assert.ok(result.includes('인스파이어'));
 assert.ok(result.includes('260204'));
 const registered=[{canonical:'고래쇼',kind:'project',aliases:[],searchPhrases:[],parentCanonical:null}];
 assert.ok(prepareSearchTerms('고래','고래쇼 자료',registered).includes('고래쇼'));
});
test('unsubstantiated mention does not turn a missing answer into success',()=>{
 const answer='내부 자료를 찾지 못했습니다. 노션에 제안 자료가 있으나, 본문을 확인할 수 없어 관련 자료라고 판단할 근거가 없습니다.';
 assert.equal(filter.isNotFoundAnswerText(answer),true);
 assert.deepEqual(filter.keepSourcesUsedInAnswer({cards:[{type:'image',title:'고래 사진'}],notion:[],wiki:[],answer,notFound:false}),{cards:[],notion:[],wiki:[]});
 assert.equal(filter.scoreEvidenceMatch({retrieved:24,matching:24,askedClear:false,notFound:true}).confidence_score,2);
 assert.equal(filter.scoreEvidenceMatch({retrieved:24,matching:24,askedClear:false,notFound:false}).confidence_score,null);
});
test('NAS search falls back from compound show to stem after the strict search misses',async()=>{
 const named=loadTs('lib/luna/named-entities.ts');
 const {searchAll}=loadTs('lib/luna/workserver.ts',{'@/lib/luna/named-entities':{...named,loadNamedEntities:async()=>[]}});
 const db=fakeDb({nas_directory:[{drive:'T',path:'Project\\고래 연출안.pdf',type:'file',importance:1}]});
 const result=await searchAll(db,'고래쇼','고래쇼 자료 찾아줘');
 assert.equal(result.length,1);
 assert.match(result[0].path,/고래 연출안/);
});
