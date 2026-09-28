const test=require('node:test');const assert=require('node:assert/strict');const {loadTs}=require('./helpers.cjs');
const {buildDocumentGrounding:build,groundingFreshness}=loadTs('lib/luna-admin/document-grounding.ts',{'node:crypto':require('node:crypto')});
const at='2026-09-29T00:00:00Z',commit='b'.repeat(40),root='02 Project/2023/230101 Demo',path=root+'/Document/운영 제안.pdf';
function fixture(){return {primary:{id:1,drive:'T',path,type:'file',size_bytes:10,modified_at:at,scan_batch:at,importance:1,marked_reason:'scanner'},
text:{path,drive:'T',status:'ok',size_bytes:10,modified_at:at,content_hash:'hash1',chunk_count:1,text_length:100,extracted_at:at,updated_at:at},
chunks:[{id:'chunk1',path,seq:0,content:'디지털 미디어 콘텐츠 제작 / 운영 제안\n2023.03.17\n-- 1 of 3 --\n-- 2 of 3 --\n-- 3 of 3 --',created_at:at}],path_owner_count:1,
marks:[{id:10,drive:'T',path:root+'/Document',note:'important',created_at:at}],
notion:[{page_id:'doc',title:'운영 제안',nas_path:'T:/'+root+'/Document',parent_id:'project',parent_type:'page_id',archived:false,last_edited_time:at,scan_batch:'batch'},
{page_id:'project',title:'Demo 시즌1',nas_path:null,parent_id:'archive',parent_type:'page_id',archived:false,last_edited_time:at,scan_batch:'batch'}]};}
test('independent checks preserve manual ancestry, exact Notion chain and explicit proposal heading',()=>{
const x=fixture(),before=JSON.stringify(x),p=build(x,commit,at);
assert.equal(p.layer,2);assert.equal(p.review_state,'candidate');assert.equal(p.checks.manual_importance.state,'verified-path-ancestry');
assert.equal(p.checks.season.value,1);assert.equal(p.inputs.notion[0].association,'title-and-path');
assert.equal(p.checks.document_role.value,'proposal');assert.equal(p.checks.document_role.evidence.chunk_id,'chunk1');
assert.equal(p.checks.body.full_document_verified,false);assert.equal(JSON.stringify(x),before);
});
test('extraction success with almost empty pages is sparse, not a verified body',()=>{
const x=fixture();x.chunks[0].content='-- 1 of 14 --\nMoon\n-- 2 of 14 --\n-- 3 of 14 --\nTHANK YOU\n-- 14 of 14 --';
const p=build(x,commit,at);assert.equal(p.checks.body.state,'current-extraction');
assert.equal(p.checks.body.coverage.state,'sparse-page-text');assert.equal(p.checks.body.coverage.page_count,14);
assert.equal(p.checks.document_role.state,'insufficient-body-evidence');
});
test('stale, duplicate, missing and cross-drive body evidence cannot support a role',()=>{
for(const change of [x=>x.text.modified_at='2020-01-01',x=>x.text.drive='P',x=>x.path_owner_count=2,x=>x.text.chunk_count=2,x=>x.chunks.push({...x.chunks[0]}),x=>x.chunks[0].path+='x']){
 const x=fixture();change(x);assert.equal(build(x,commit,at).checks.document_role.state,'insufficient-body-evidence');
}
});
test('Notion siblings, other drives and sibling path prefixes never establish season membership',()=>{
const x=fixture();x.notion.push({...x.notion[0],page_id:'sibling',title:'Other 시즌3',nas_path:'T:/'+root+'/Document Other'});
assert.equal(build(x,commit,at).checks.season.value,1);
x.notion[0].nas_path='P:/'+root+'/Document';assert.equal(build(x,commit,at).checks.season.state,'unknown');
});
test('explicit conflicting season and parent cycles stay unresolved',()=>{
const x=fixture();x.notion[0].title+=' 시즌3';assert.equal(build(x,commit,at).checks.season.state,'conflict');
const y=fixture();y.notion[1].parent_id='doc';assert.equal(build(y,commit,at).checks.notion_association.state,'conflict');
assert.equal(build(y,commit,at).checks.season.value,null);
});
test('unversioned pages cannot establish an inherited season',()=>{
 const x=fixture();x.notion[1].last_edited_time=null;assert.equal(build(x,commit,at).checks.season.state,'unknown');
 x.notion[0].scan_batch=null;assert.equal(build(x,commit,at).checks.notion_association.state,'unavailable');
});
test('changes in Notion parent/revision, chunks, source scan and manual marks invalidate saved evidence',()=>{
const p=build(fixture(),commit,at);assert.equal(groundingFreshness(p,fixture()),'current');
for(const change of [x=>x.notion[0].parent_id='new',x=>x.notion[1].last_edited_time='new',x=>x.notion[1].archived=true,x=>x.chunks[0].content+='changed',x=>x.primary.scan_batch='new',x=>x.marks[0].note='new']){
 const x=fixture();change(x);assert.equal(groundingFreshness(p,x),'stale');
}
assert.equal(groundingFreshness(p,null),'unavailable');
});
