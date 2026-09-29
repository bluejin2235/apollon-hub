const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
test('short domain nouns survive every keyword budget and all-material requests get a broad answer budget',()=>{
 const k=loadTs('lib/luna/notion-keyword.ts',{'@/lib/luna/embedding':{EMBEDDING_SCORE_WEIGHT:10}});
 const q='야외 숲 미디어아트 조성관련 자료 모두 찾아줘';const plan=k.planNotionSearchKeywords('',q,[]);
 assert.ok(plan.keywords.includes('숲'));assert.ok(k.pickLightKeywords(plan).includes('숲'));
 assert.ok(k.pickIlikeKeywords(plan.keywords).includes('숲'));
 assert.ok(!plan.keywords.includes('모두'));assert.equal(k.includesKeywordCompact('숲 프로젝션','숲'),true);
 assert.ok(loadTs('lib/luna/question-depth.ts').llmInjectLimitsForQuestion(q).limits.notion>=8);
});
test('a cited partial result retains its link even when the answer reports missing details',()=>{
 const {keepSourcesUsedInAnswer}=loadTs('lib/luna/search-filter.ts');
 const id='312c795f-b818-807b-807b-c894be355a1b';
 const result=keepSourcesUsedInAnswer({cards:[],wiki:[],notion:[{id,title:'숲 제안',url:'https://notion.so/test'}],
 answer:'직접 일치하는 자료는 찾지 못했습니다. 관련 제안입니다. <!--luna-source:notion:312c795fb818807b807bc894be355a1b-->',
 injectedNotionIds:[id],notFound:false});
 assert.equal(result.notion.length,1);
});
