const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {isNotionBodyReady,completeNotionHealth}=loadTs('lib/luna/notion-index-health.ts');
test('legacy and partial indexing cannot satisfy search readiness',()=>{
 for(const h of [null,{}, {version:1,state:'ready'},{version:2,state:'building'},{version:2,state:'failed'}]) assert.equal(isNotionBodyReady(h),false);
 assert.throws(()=>completeNotionHealth({blocks:10,chunks:3,eligible:3,embedded:2,bodyHash:'x'}),/incomplete embeddings/);
});
test('an actually read empty page is distinct from uncollected content',()=>{
 const empty=completeNotionHealth({blocks:4,chunks:0,eligible:0,embedded:0,bodyHash:'x'});
 assert.equal(empty.state,'empty');assert.equal(isNotionBodyReady(empty),true);
 const ready=completeNotionHealth({blocks:10,chunks:3,eligible:2,embedded:2,bodyHash:'x'});
 assert.equal(ready.state,'ready');assert.equal(isNotionBodyReady(ready),true);
});
