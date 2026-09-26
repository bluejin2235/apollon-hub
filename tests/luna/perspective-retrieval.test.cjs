const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
const {applyPerspectivesToSources}=loadTs('lib/luna/search-secondary.ts');
function client(overrides={},errors={}) {
 return fakeDb({luna_perspectives:[{id:'perspective',name:'미디어',status:'active',hit_count:3,used_count:7}],
  luna_notion_pages:[{page_id:'page',title:'미디어 제안',archived:false}],
  luna_notion_chunks:[{page_id:'page',position:0,heading:'전략',text:'현장 조건에 따른 제안 근거'}],...overrides},errors);
}
test('perspective-injected pages carry their indexed evidence without mutating usage',async()=>{
 const db=client();const result=await applyPerspectivesToSources(db,'미디어 제안 찾아줘',[]);
 assert.equal(result.stats.injected,1);assert.equal(result.sources[0].excerpt,'전략 현장 조건에 따른 제안 근거');
 assert.ok(!db.calls.some(c=>c.mutation));
});
test('repeated evaluator searches never alter production perspective statistics',async()=>{
 const db=client();for(let i=0;i<3;i++) await applyPerspectivesToSources(db,'미디어',[]);
 assert.ok(!db.calls.some(c=>c.mutation));
 // fakeDb does not implement update: calling the old writer would throw and fail this test.
});
test('perspective lookup or page lookup failure adds no fabricated candidates',async()=>{
 for(const table of ['luna_perspectives','luna_notion_pages']) {
  const result=await applyPerspectivesToSources(client({}, {[table]:{message:'offline'}}),'미디어',[]);
  assert.deepEqual(result.sources,[]);
 }
});
test('perspective names with SQL wildcard characters use literal title matching',async()=>{
 const db=client({luna_perspectives:[{id:'p',name:'50%_plan',status:'active',hit_count:1}],
 luna_notion_pages:[{page_id:'page',title:'50%_plan',archived:false}]});
 await applyPerspectivesToSources(db,'50%_plan',[]);
 const filter=db.calls.flatMap(c=>c.filters??[]).find(f=>f[1]==='ilike');
 assert.equal(filter[2],'%50\\%\\_plan%');
});
