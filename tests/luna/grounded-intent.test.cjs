const test=require('node:test');const assert=require('node:assert/strict');const {loadTs}=require('./helpers.cjs');
const {parseAskedWhat}=loadTs('lib/luna/ask-what.ts');
const {discoverGroundedTargets}=loadTs('lib/luna/grounded-target.ts');
const {haystackMatchesAsked,filterCardsByAsked}=loadTs('lib/luna/search-filter.ts');
const row=(text)=>({chunk_id:'chunk',page_id:'source',heading:'소개',text});
test('unregistered ordinary phrases never become mandatory project filters',()=>{
 for(const q of ['바다를 활용한 자료 중 우리가 제작한 것과 외부 참고자료를 나눠줘','프레젠테이션 참고자료 찾아줘','우리가 제작한 공간디자인 자료']) assert.equal(parseAskedWhat(q).projectCanonical,null);
 assert.equal(parseAskedWhat('가상무지개 프로젝트의 견적서 찾아줘').projectCanonical,'가상무지개');
 assert.equal(parseAskedWhat('특정 프로젝트의 자료').projectCanonical,null);
});
test('aliases require explicit evidence and generalize across names',()=>{
 const result=discoverGroundedTargets([row("대표 공연 'Journey to Mars(일명 붉은별쇼)' 제작"),row('붉은별쇼와 다른 작품을 참고')],['붉은별쇼']);
 assert.equal(result.length,1);assert.equal(result[0].name,'Journey to Mars');assert.equal(result[0].page_id,'source');
 assert.equal(discoverGroundedTargets([row('푸른빛쇼: Journey to Mars를 참고')],['푸른빛쇼']).length,0);
 assert.equal(discoverGroundedTargets([row('「빛의 정원」(별칭 초록빛쇼)')],['초록빛쇼'])[0].name,'빛의 정원');
 assert.equal(discoverGroundedTargets([row('Silver Forest (aka forestshow)')],['forestshow'])[0].name,'Silver Forest');
});
test('conflicting explicit aliases stay distinct instead of silently choosing one',()=>{
 assert.equal(discoverGroundedTargets([row('Red World(일명 붉은별쇼)'),row('Red Journey(일명 붉은별쇼)')],['붉은별쇼']).length,2);
});
test('provenance can discover explicit aliases related to a broad topic without inventing equivalence',()=>{
 const rows=[row('Journey to Mars(일명 붉은별쇼)'),row('Red Journey(일명 붉은별축제)')];
 assert.equal(discoverGroundedTargets(rows,['붉은별']).length,0);
 const related=discoverGroundedTargets(rows,['붉은별'],true);
 assert.equal(related.length,2);
 assert.equal(related[0].alias,'붉은별쇼');
 assert.equal(related[0].name,'Journey to Mars');
 assert.equal(discoverGroundedTargets([row('붉은별은 Journey to Mars의 참고 이미지')],['붉은별'],true).length,0);
});
test('date constraints select the leaf revision not a matching ancestor',()=>{
 const a=parseAskedWhat('해운대스퀘어 260204 KV 이미지 보여줘');
 assert.equal(haystackMatchesAsked('해운대스퀘어\\260204 KV\\PSD\\scene.jpg',a),true);
 assert.equal(haystackMatchesAsked('해운대스퀘어\\260204 KV\\PSD\\260209 KV\\scene.jpg',a),false);
 const cards=[{type:'image',title:'scene.jpg',raw_path:'260108 해운대스퀘어\\260204 KV\\PSD\\scene.jpg',project:'260108 해운대스퀘어'}];
 assert.equal(filterCardsByAsked(cards,a).length,1);
});
