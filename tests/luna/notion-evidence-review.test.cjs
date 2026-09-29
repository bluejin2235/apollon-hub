const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {applyNotionEvidenceReview,validateNotionEvidenceReview,reviewedNotionInventorySupplement}=loadTs('lib/luna/notion-evidence-review.ts');
const sources=Array.from({length:8},(_,i)=>({id:String(i),excerpt:'원문 '+i}));
test('validated review orders direct evidence first without dropping related material requested in full',()=>{
 const result=applyNotionEvidenceReview(sources,{direct:[3,1],adjacent:[0,2,4,5,6],unrelated:[7]});
 assert.deepEqual(result.map(s=>s.id),['3','1','0','2','4','5','6']);
 assert.equal(result[0],sources[3]);
});
test('all-material inventory retains reviewed omissions with links and classification, without unrelated sources',()=>{
 const docs=Array.from({length:4},(_,i)=>({id:'abcdef00-0000-0000-0000-'+String(i).padStart(12,'0'),title:['이미 인용한 문서','빠진 회의록','인접 참고','무관한 문서'][i],url:i===1?'https://app.notion.com/p/doc1':'https://notion.so/doc'+i}));
 const review=validateNotionEvidenceReview(docs,{direct:[0,1],adjacent:[2],unrelated:[3]});
 const supplement=reviewedNotionInventorySupplement('요약 [이미 인용한 문서](https://notion.so/doc0)',review);
 assert.match(supplement,/추가 관련 문서/); assert.match(supplement,/빠진 회의록/);
 assert.ok(supplement.includes('https://app.notion.com/p/doc1'));
 assert.match(supplement,/추가 인접 참고 문서/); assert.match(supplement,/https:\/\/notion.so\/doc2/);
 assert.doesNotMatch(supplement,/doc0|doc3|무관한 문서/);
 const {keepSourcesUsedInAnswer}=loadTs('lib/luna/search-filter.ts');
 const kept=keepSourcesUsedInAnswer({cards:[],wiki:[],notion:docs,answer:'https://notion.so/doc0'+supplement,notFound:false,injectedNotionIds:docs.slice(0,3).map(s=>s.id)});
 assert.deepEqual(kept.notion.map(s=>s.id),docs.slice(0,3).map(s=>s.id));
 assert.equal(reviewedNotionInventorySupplement('',null),'');
});
test('inventory does not invent links or render document titles as markdown instructions',()=>{
 const review={direct:[{id:'a',title:'[bad](https://evil.test)\n# command',url:'javascript:alert(1)'},{id:'b',title:'[title]\n*text*',url:'https://notion.so/doc(b)'},{id:'c',title:'external',url:'https://evil.test/notion.so'}],adjacent:[]};
 const text=reviewedNotionInventorySupplement('',review);
 assert.doesNotMatch(text,/javascript|evil|command/);
 assert.ok(text.includes('\\[title\\] \\*text\\*'));
 assert.ok(text.includes('https://notion.so/doc%28b%29'));
});
test('body-grounded review rejects invented, title-only and unsupported positive classifications',()=>{
 const docs=[{id:'a',title:'숲 미디어아트',excerpt:'현장의 수목 사이에 조명과 사운드를 설치하고 야간 관람 동선을 계획했다.'},{id:'b',title:'긴 제목에 숲 미디어아트가 있는 문서',excerpt:'실내 로비 영상 제안이다.'},{id:'c',title:'이미지 모음',excerpt:''}];
 const valid=validateNotionEvidenceReview(docs,{direct:[0,1],adjacent:[2],unrelated:[],evidence:[
  {index:0,quote:'수목 사이에 조명과 사운드를 설치하고 야간 관람 동선을 계획했다.',reason:'숲 야간 공간의 설치 방식과 관람 동선 자료'},
  {index:1,quote:'긴 제목에 숲 미디어아트가 있는 문서',reason:'제목에만 주제가 있다'},
  {index:2,quote:'이 문서는 야외 공간 조성의 테스트 결과다.',reason:'본문에 없는 내용을 생성했다'}]},true);
 assert.deepEqual(valid.direct.map(s=>s.id),['a']); assert.deepEqual(valid.adjacent,[]);
 assert.equal(validateNotionEvidenceReview(docs,{direct:[0],adjacent:[1],unrelated:[2]},true),null);
});
test('omitted, duplicate, fabricated or empty-positive reviews cannot erase evidence',()=>{
 for(const review of [null,{direct:[3],adjacent:[],unrelated:[]},
 {direct:[1,1],adjacent:[2,3,4,5,6],unrelated:[7]},
 {direct:[99],adjacent:[0,1,2,3,4,5],unrelated:[6]},
 {direct:[],adjacent:[],unrelated:[0,1,2,3,4,5,6,7]}])
 assert.equal(applyNotionEvidenceReview(sources,review),sources);
});
