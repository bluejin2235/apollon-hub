const test=require('node:test');const assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
const crypto=require('node:crypto');
const {planEmbeddingRequests,embeddingCostUsd}=loadTs('lib/luna/bounded-embeddings.ts',{'@/lib/luna/embedding':{},'@/lib/luna/env-keys':{}});

function harness({change=false,stale=false}={}) {
 const rows=Array.from({length:30},(_,i)=>({id:`id-${i}`,path:`project/file-${Math.floor(i/5)}`,seq:i%5,content:`source ${i}`}));
 const db=fakeDb({nas_file_chunks:rows,nas_file_text:[...new Set(rows.map(row=>row.path))].map(path=>({path,status:'ok'}))});let calls=0,versionsCalls=0;
 const methods=loadTs('lib/luna/nas-embedding-sample.ts',{
  'node:crypto':crypto,
  '@/lib/luna/nas-source-version':{currentNasBodyFiles:async(_db,paths)=>{
   versionsCalls++;
   return new Map(stale?[]:paths.map(path=>[path,{path,drive:'T',modified_at:change&&versionsCalls>1?'changed':'same',size_bytes:1,status:'ok'}]));
  }},
  '@/lib/luna/bounded-embeddings':{planEmbeddingRequests,embeddingCostUsd,createBoundedEmbeddingsBatch:async input=>{
   calls++;return {vectors:input.map((_,i)=>[i===0?1:0.5,0.5]),tokens:20};
  }}
 });
 return {rows,db,methods,calls:()=>calls};
}
test('sample dry run is bounded, read-only and never embeds or emits private source text',async()=>{
 const h=harness();
 const result=await h.methods.runNasEmbeddingSample(h.db,{term:'project',query:'find source',execute:false});
 assert.equal(result.selected_chunks,18);assert.equal(result.selected_files,6);
 assert.equal(h.calls(),0);assert.equal(result.database_writes,0);
 assert.equal(h.db.calls.some(call=>call.mutation),false);
 assert.equal(JSON.stringify(result).includes('project/file'),false);
 assert.equal(JSON.stringify(result).includes('find source'),false);
});
test('live-mode sample ranks in memory and only performs database reads',async()=>{
 const h=harness();
 const result=await h.methods.runNasEmbeddingSample(h.db,{term:'project',query:'find source',execute:true});
 assert.equal(h.calls(),1);assert.equal(result.actual_tokens,20);assert.equal(result.top.length,5);
 assert.equal(result.mode,'memory_only');assert.equal(result.database_writes,0);
 assert.equal(h.db.calls.some(call=>call.mutation),false);
 assert.ok(result.top.every(row=>Number.isFinite(row.similarity)&&!('content' in row)&&!('path' in row)));
});
test('stale sample refuses paid calls and mid-run source changes invalidate results',async()=>{
 const stale=harness({stale:true});
 await assert.rejects(stale.methods.runNasEmbeddingSample(stale.db,{term:'project',query:'find source',execute:true}), /No fresh/);
 assert.equal(stale.calls(),0);
 const changed=harness({change:true});
 await assert.rejects(changed.methods.runNasEmbeddingSample(changed.db,{term:'project',query:'find source',execute:true}), /changed during/);
 assert.equal(changed.calls(),1);
});
test('sample CLI rejects accidental write flags and invalid parameters',()=>{
 const {parseNasSampleArgs}=harness().methods;
 assert.equal(parseNasSampleArgs(['--term=해운대','--query=KV 이미지']).execute,false);
 for(const argv of [[],['--apply'],['--term=해운대','--query=🌙'.repeat(2000)]]) assert.throws(()=>parseNasSampleArgs(argv));
});
