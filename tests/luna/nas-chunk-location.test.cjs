const test=require('node:test');const assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
const {matchNasChunkEmbeddings}=loadTs('lib/luna/nas-chunk-search.ts',{'@/lib/luna/embedding':{embeddingToSql:()=> '[0]'}});
function db(files,errors={}){
 const client=fakeDb({nas_file_chunks:[{id:'chunk',content:'body'}],nas_file_text:files.map(f=>({status:"ok",size_bytes:10,modified_at:"2026-09-25T00:00:00Z",...f})),nas_directory:files.map(f=>({type:"file",scan_batch:"2026-09-25T01:00:00Z",size_bytes:10,modified_at:"2026-09-25T00:00:00Z",...f}))},errors);
 client.rpc=async()=>({data:[{id:'chunk',path:'Project/report.pdf',seq:0,similarity:0.8}],error:null});return client;
}
test('semantic NAS results retain the indexed P drive',async()=>{
 const result=await matchNasChunkEmbeddings(db([{path:'Project/report.pdf',drive:'P'}]),[0]);
 assert.equal(result.length,1);assert.equal(result[0].drive,'P');assert.equal(result[0].content,'body');
});
test('missing or invalid drive metadata never silently becomes a T-drive result',async()=>{
 for(const files of [[],[{path:'Project/report.pdf',drive:null}],[{path:'Project/report.pdf',drive:'unknown'}]]) {
  assert.deepEqual(await matchNasChunkEmbeddings(db(files),[0]),[]);
 }
});
test('metadata lookup failure does not return an unverified file location',async()=>{
 assert.deepEqual(await matchNasChunkEmbeddings(db([],{nas_file_text:{message:'unavailable'}}),[0]),[]);
});
