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
test('canonicalization is idempotent and does not duplicate internal citation markers',()=>{
 const {canonicalizeNotionAnswerLinks}=loadTs('lib/luna/source-citations.ts');
 const good={id,title:'현장 검토 문서'};
 const once=canonicalizeNotionAnswerLinks('[현장 검토 문서](https://notion.so/'+id.replace(/-/g,'')+')'+notionCitationMarker(id),[good]);
 assert.equal(once.split(notionCitationMarker(id)).length-1,1);
 assert.equal(canonicalizeNotionAnswerLinks(once,[good]),once);
});
test('the shared prompt formatter provides exact markers for supplied sources',()=>{
 const {formatNotionSourcesForPrompt}=loadTs('lib/luna/notion.ts',{
  '@/lib/luna/named-entities':{},'@/lib/luna/project-stage':{},'@/lib/luna/workserver':{}
 });
 const prompt=formatNotionSourcesForPrompt([source],{compact:true});
 assert.ok(prompt.includes(notionCitationMarker(id)));
 assert.ok(prompt.includes('실제 사용한 자료'));
});

test('copy text removes internal source IDs while preserving answer text and ordinary comments',()=>{
 const {stripLunaSourceMarkers,notionCitationMarker,citedNotionIds}=loadTs('lib/luna/source-citations.ts');
 const marker=notionCitationMarker('12345678-1234-1234-1234-123456789abc');
 const answer=`문서 요약입니다.${marker}\n<!--ordinary comment-->\nhttps://example.com`;
 assert.equal(stripLunaSourceMarkers(answer),'문서 요약입니다.\n<!--ordinary comment-->\nhttps://example.com');
 assert.equal(citedNotionIds(answer).size,1);
});
test('source URLs and names come only from verified records, never generated UUIDs',()=>{
 const {canonicalizeNotionAnswerLinks}=loadTs('lib/luna/source-citations.ts');
 const good={id,title:'변경 설계안'};
 const repaired=canonicalizeNotionAnswerLinks('[변경 설계안](https://app.notion.com/p/wrong-1234)',[good]);
 assert.match(repaired,/https:\/\/www.notion.so\/0123456789abcdef0123456789abcdef/);
 assert.ok(repaired.includes(notionCitationMarker(id)));
 const missing=canonicalizeNotionAnswerLinks('[없는 자료](https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)',[good]);
 assert.equal(missing,'없는 자료');
 assert.equal(canonicalizeNotionAnswerLinks('[웹](https://example.com)',[good]),'[웹](https://example.com)');
 assert.equal(canonicalizeNotionAnswerLinks('설명<!--luna-source:notion:0123456789abcdef0123456789abcdef0-->',[good]),'설명');
});
