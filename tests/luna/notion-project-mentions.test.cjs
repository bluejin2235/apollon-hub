const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
const {readProjectMentions}=loadTs('lib/luna/notion-project-mentions.ts');
test('finds reports outside project membership past the first database page without publishing archived records',async()=>{
 const rows=Array.from({length:1001},(_,i)=>({page_id:'report'+i,chunk_id:String(i),text:'빛마을산책 사업의 현장 설치 보고'}));
 const db=fakeDb({luna_notion_chunks:rows,luna_notion_pages:rows.map((r,i)=>({page_id:r.page_id,title:'준공 기록 '+i,archived:i===0}))});
 const result=await readProjectMentions(db,[{key:'2024 03 빛마을산책',pageIds:['project']}]);
 assert.equal(result.complete,true);assert.equal(result.sources.length,1000);
 assert.ok(result.sources.some(s=>s.id==='report1000'));
 assert.ok(result.sources.every(s=>s.via_link==='project_mention'&&!s.project_key));
});
test('a failed body lookup does not claim complete navigation',async()=>{
 const result=await readProjectMentions(fakeDb({}, {luna_notion_chunks:{message:'query failure'}}),[{key:'2024 03 빛마을산책',pageIds:[]}]);
 assert.equal(result.complete,false);assert.deepEqual(result.sources,[]);
});
