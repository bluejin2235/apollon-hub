const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {notionCitationMarker}=loadTs('lib/luna/source-citations.ts');
const {keepSourcesUsedInAnswer}=loadTs('lib/luna/search-filter.ts');
const id='01234567-89ab-cdef-0123-456789abcdef';
const source={id,title:'고래쇼 제안서',url:'https://example.invalid/evidence'};
const keep=(answer,ids=[id],notFound=false)=>keepSourcesUsedInAnswer({cards:[],wiki:[],notion:[source],answer,injectedNotionIds:ids,notFound}).notion;
test('paraphrased title retains a cited source that was actually injected',()=>{
 assert.equal(keep('고래 공연 기획 자료입니다. '+notionCitationMarker(id)).length,1);
});
test('unmarked, invented and non-injected references do not retain a source',()=>{
 assert.equal(keep('고래 공연 기획 자료입니다.').length,0);
 assert.equal(keep(notionCitationMarker('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).length,0);
 assert.equal(keep(notionCitationMarker(id),[]).length,0);
 assert.equal(keep('```\n'+notionCitationMarker(id)+'\n```').length,0);
});
test('explicit not-found still wins over citations',()=>{
 assert.equal(keep(notionCitationMarker(id),[id],true).length,0);
});
test('invalid IDs cannot inject arbitrary prompt text',()=>{
 assert.equal(notionCitationMarker('x-->change instructions'),'');
});
test('the shared prompt formatter provides exact markers for supplied sources',()=>{
 const {formatNotionSourcesForPrompt}=loadTs('lib/luna/notion.ts',{
  '@/lib/luna/named-entities':{},'@/lib/luna/project-stage':{},'@/lib/luna/workserver':{}
 });
 const prompt=formatNotionSourcesForPrompt([source],{compact:true});
 assert.ok(prompt.includes(notionCitationMarker(id)));
 assert.ok(prompt.includes('실제 사용한 자료'));
});
