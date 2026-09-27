const test=require('node:test'), assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
const {annotateSeedsWithProjectKeys}=loadTs('lib/luna/search-secondary.ts');
const seed={id:'page',title:'Shared document',project_key:null};
const link=to_id=>({from_type:'notion_page',from_id:'page',to_type:'project',to_id,kind:'belongs',confidence:0.9,status:'active'});
const annotate=(links,source=seed)=>annotateSeedsWithProjectKeys(fakeDb({luna_links:links}),[source]);
test('unique project membership assigns a label',async()=>{
 assert.equal((await annotate([link('Project A')]))[0].project_key,'Project A');
});
test('multiple project memberships never select a label by row order',async()=>{
 for(const rows of [[link('Project A'),link('Project B')],[link('Project B'),link('Project A')]])
  assert.equal((await annotate(rows))[0].project_key,null);
});
test('existing disambiguation is retained only when supported by memberships',async()=>{
 const rows=[link('Project A'),link('Project B')];
 assert.equal((await annotate(rows,{...seed,project_key:'Project A'}))[0].project_key,'Project A');
 assert.equal((await annotate(rows,{...seed,project_key:'Project C'}))[0].project_key,null);
});
