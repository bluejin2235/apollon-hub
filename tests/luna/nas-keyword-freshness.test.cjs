const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
const {searchNasTextKeyword}=loadTs('lib/luna/nas-text-keyword.ts');
const file={path:'Project/report.pdf',drive:'P',modified_at:'2026-09-25T00:00:00Z',size_bytes:100,status:'ok'};
const dir={...file,type:'file',importance:0};
function db(dirs=[dir],text=file){return fakeDb({nas_directory:dirs,nas_file_text:[text],nas_file_chunks:[{path:file.path,seq:0,content:'고래 제안 본문'}],nas_important_paths:[]});}
test('keyword search uses current body evidence',async()=>{
 const hits=await searchNasTextKeyword(db(),'고래');assert.equal(hits.length,1);assert.equal(hits[0].drive,'P');assert.ok(hits[0].reasons.includes('본문'));
});
test('deleted or modified file body cannot answer a body-only query',async()=>{
 assert.deepEqual(await searchNasTextKeyword(db([]),'고래'),[]);
 assert.deepEqual(await searchNasTextKeyword(db([{...dir,size_bytes:200}]),'고래'),[]);
});
test('modified file stays discoverable by filename without stale body',async()=>{
 const hits=await searchNasTextKeyword(db([{...dir,size_bytes:200}]),'report');
 assert.equal(hits.length,1);assert.equal(hits[0].snippet,'report.pdf');assert.ok(!hits[0].reasons.includes('본문'));
});
test('same relative path on another drive cannot inherit extracted body',async()=>{
 assert.deepEqual(await searchNasTextKeyword(db([{...dir,drive:'T'}]),'고래'),[]);
});
