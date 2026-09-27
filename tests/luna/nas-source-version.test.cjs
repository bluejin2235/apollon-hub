const test=require('node:test'), assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
const {currentNasBodyFiles}=loadTs('lib/luna/nas-source-version.ts');
const file={path:'Project/report.pdf',drive:'P',size_bytes:100,modified_at:'2026-09-25T00:00:00Z',status:'ok'};
const dir={...file,type:'file',scan_batch:'2026-09-25T01:00:00Z'};
const check=(texts,dirs,errors={})=>currentNasBodyFiles(fakeDb({nas_file_text:texts,nas_directory:dirs},errors),[file.path]);
test('current body matches drive, path, timestamp and size',async()=>{
 assert.equal((await check([file],[dir])).get(file.path).drive,'P');
});
test('removed, changed, failed extraction and wrong-drive bodies are excluded',async()=>{
 for(const [texts,dirs] of [[[file],[]],[[file],[{...dir,size_bytes:101}]],[[file],[{...dir,modified_at:'2026-09-24T00:00:00Z'}]],
  [[{...file,status:'failed'}],[dir]],[[file],[{...dir,drive:'T'}]],[[{...file,size_bytes:null}],[dir]]]){
  assert.equal((await check(texts,dirs)).size,0);
 }
});
test('ambiguous extraction and disagreeing live generations fail closed',async()=>{
 assert.equal((await check([file,{...file,drive:'T'}],[dir])).size,0);
 assert.equal((await check([file],[dir,{...dir,size_bytes:999}])).size,0);
});
test('provenance lookup error cannot mark a body current',async()=>{
 assert.equal((await check([file],[dir],{nas_directory:{message:'offline'}})).size,0);
});

test('surviving row from an older snapshot cannot make a deleted source current',async()=>{
 const newer={...dir,path:'Project/other.pdf',scan_batch:'2026-09-26T01:00:00Z'};
 assert.equal((await check([file],[dir,newer])).size,0);
});
test('same relative path current on two drives is ambiguous even when one body matches',async()=>{
 assert.equal((await check([file],[dir,{...dir,drive:'T'}])).size,0);
});
test('old disagreeing rows do not disqualify a matching current snapshot',async()=>{
 assert.equal((await check([file],[dir,{...dir,size_bytes:999,scan_batch:'2026-09-24T01:00:00Z'}])).size,1);
});
test('missing scan generation cannot establish current source membership',async()=>{
 assert.equal((await check([file],[{...dir,scan_batch:null}])).size,0);
});
