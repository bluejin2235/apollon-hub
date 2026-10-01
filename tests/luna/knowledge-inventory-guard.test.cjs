const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {sanitizeKnowledgeListAnswer,KNOWLEDGE_DUMP_CLARIFY}=loadTs('lib/luna/knowledge-dump-guard.ts');
test('verified document inventories survive incidental knowledge words while learned-memory limits remain',()=>{
 const answer=Array.from({length:14},(_,i)=>`- [설계 지식 참고문서 ${i}](https://notion.so/doc${i})`).join('\n');
 assert.equal(sanitizeKnowledgeListAnswer(answer,[],{verifiedDocumentInventory:true}),answer);
 assert.equal(sanitizeKnowledgeListAnswer(answer),KNOWLEDGE_DUMP_CLARIFY);
 const learnings=Array.from({length:11},(_,i)=>({content:`사내 확정 학습 정보 ${i}`}));
 const dump=learnings.map(l=>'- '+l.content).join('\n');
 assert.equal(sanitizeKnowledgeListAnswer(dump,learnings,{verifiedDocumentInventory:true}),KNOWLEDGE_DUMP_CLARIFY);
});
