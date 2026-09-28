const test=require('node:test');const assert=require('node:assert/strict');const {loadTs}=require('./helpers.cjs');
const {provenanceResultAnswer}=loadTs('lib/luna/provenance-answer.ts');
const {isNotFoundAnswerText,keepSourcesUsedInAnswer}=loadTs('lib/luna/search-filter.ts');
const targets=[{name:'Solar Garden',alias:'태양정원',page_id:'bridge',quote:'Solar Garden(일명 태양정원)'}];
const sources=[{id:'11111111-1111-1111-1111-111111111111',title:'직접 근거',url:'https://example.com/a',excerpt:'Example Studio는 Solar Garden을 기획 및 연출했습니다.'},
{id:'22222222-2222-2222-2222-222222222222',title:'다른 사업의 참고 문서',url:'https://example.com/b',excerpt:'벤치마킹 사례: 태양정원.'}];
test('same-work references are linked to verbatim role evidence, never a second inferred owner',()=>{
 const answer=provenanceResultAnswer(sources,targets);
 assert.match(answer,/Example Studio는 Solar Garden을 기획 및 연출했습니다\./);
 assert.match(answer,/별도의 외부 제작물로 나누지 않습니다/);
 assert.equal(isNotFoundAnswerText(answer),false);
 const kept=keepSourcesUsedInAnswer({cards:[],notion:sources,wiki:[],answer,notFound:false,injectedNotionIds:sources.map(s=>s.id)});
 assert.equal(kept.notion.length,2);
});
test('a topic mention or absent production statement cannot create a verified-role answer',()=>{
 assert.equal(provenanceResultAnswer(sources,[]),null);
 assert.equal(provenanceResultAnswer([{...sources[0],excerpt:'Solar Garden 제작 제안 검토'},sources[1]],targets),null);
 assert.equal(provenanceResultAnswer([sources[0],{...sources[1],excerpt:'다른 정원 참고자료'}],targets),null);
});
test('an ambiguous alias cannot be rendered as a confirmed single-work identity',()=>{
 assert.equal(provenanceResultAnswer(sources,[...targets,{...targets[0],name:'Another Garden'}]),null);
});
