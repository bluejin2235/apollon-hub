const test=require('node:test');const assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {parseNasEmbeddingArgs}=loadTs('lib/luna/nas-embedding-options.ts');
const {planEmbeddingRequests,embeddingCostUsd}=loadTs('lib/luna/bounded-embeddings.ts',{'@/lib/luna/embedding':{},'@/lib/luna/env-keys':{}});
test('default and full runs are bounded and read-only',()=>{
 assert.deepEqual(parseNasEmbeddingArgs([]),{limit:500,batchSize:100,kind:'incremental',apply:false,maxCostUsd:1});
 assert.equal(parseNasEmbeddingArgs(['--full']).apply,false);
 assert.equal(parseNasEmbeddingArgs(['--full']).limit,500);
});
test('paid execution requires an explicit switch with bounded limits',()=>{
 assert.deepEqual(parseNasEmbeddingArgs(['--limit=20','--batch=10','--apply']),{limit:20,batchSize:10,kind:'incremental',apply:true,maxCostUsd:1});
});
test('bad flags cannot silently start an unlimited run',()=>{
 for(const flag of ['--limit=0','--limit=-1','--limit=999999','--limit=abc','--batch=101','--apply=yes','--limt=5','--max-cost-usd=0','--max-cost-usd=50','--max-cost-usd=Infinity']) {
  assert.throws(()=>parseNasEmbeddingArgs([flag]));
 }
});

