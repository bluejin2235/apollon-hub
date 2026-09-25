const test=require('node:test');const assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
const {reportSourcesAreCurrent}=loadTs('lib/luna/report-freshness.ts');
const id='12345678-1234-1234-1234-123456789abc',time='2026-09-25T00:00:00Z';
const notion={type:'notion',page_id:id,last_edited_time:time};
const nas={type:'nas',ref:'Project/file.pdf',drive:'P',modified_at:time,size_bytes:100};
const tables=()=>({luna_notion_pages:[{page_id:id,last_edited_time:time,archived:false}],nas_directory:[{drive:'P',path:nas.ref,modified_at:time,size_bytes:100,type:'file',scan_batch:time}]});
test('legacy and unsupported source references are unverified without any DB reads',async()=>{
 const db=fakeDb({});for(const sources of [null,[],[{type:'notion',ref:'https://notion.so/page'}],[{type:'web',ref:'https://example.com'}]])assert.equal(await reportSourcesAreCurrent(db,sources),false);
 assert.equal(db.calls.length,0);
});
test('all stored source revisions must match current indexed metadata',async()=>{
 assert.equal(await reportSourcesAreCurrent(fakeDb(tables()),[notion,nas]),true);
 const changed=tables();changed.nas_directory[0].size_bytes=101;
 assert.equal(await reportSourcesAreCurrent(fakeDb(changed),[notion,nas]),false);
});
test('deleted, archived or modified Notion sources invalidate report reuse',async()=>{
 for(const pages of [[],[{page_id:id,last_edited_time:time,archived:true}],[{page_id:id,last_edited_time:'2026-09-25T01:00:00Z',archived:false}]]){
  assert.equal(await reportSourcesAreCurrent(fakeDb({luna_notion_pages:pages}),[notion]),false);
 }
});
test('drive mismatch and lookup failure do not permit stale report reuse',async()=>{
 const wrong=tables();wrong.nas_directory[0].drive='T';assert.equal(await reportSourcesAreCurrent(fakeDb(wrong),[nas]),false);
 assert.equal(await reportSourcesAreCurrent(fakeDb({}, {luna_notion_pages:{message:'unavailable'}}),[notion]),false);
});
