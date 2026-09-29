const test=require('node:test'), assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {NotionIndexClient}=loadTs('lib/luna/notion-index.ts',{
 crypto:require('node:crypto'),
 '@/lib/luna/embedding':{contentHash:()=>'',EMBEDDING_DIMS:1,EMBEDDING_MODEL:'test'},
 '@/lib/luna/env-keys':{openaiApiKey:()=>''},
 '@/lib/luna/notion':{extractWorkserverPathsFromText:()=>[]}
});
test('concurrent page reads share the request-start rate limit',async()=>{
 const original=global.fetch, starts=[];
 global.fetch=async()=>{starts.push(Date.now());return new Response(JSON.stringify({results:[],has_more:false}),{status:200});};
 try {
  const client=new NotionIndexClient('fixture-token');
  await Promise.all(['a','b','c'].map(id=>client.fetchBlockChildren(id)));
  assert.equal(starts.length,3);
  assert.ok(starts[1]-starts[0]>=330);
  assert.ok(starts[2]-starts[1]>=330);
 } finally {global.fetch=original;}
});
test('retries a rate-limited read but never retries a blocked connection',async()=>{
 const original=global.fetch;let calls=0;
 try {
  global.fetch=async()=>++calls===1 ? new Response('{"code":"rate_limited"}',{status:429,headers:{'retry-after':'0.01'}}) : new Response('{"results":[],"has_more":false}',{status:200});
  assert.deepEqual(await new NotionIndexClient('fixture-token').fetchBlockChildren('a'),[]);
  assert.equal(calls,2);calls=0;
  global.fetch=async()=>{calls++;return new Response('{"code":"public_api_request_blocked"}',{status:429});};
  await assert.rejects(()=>new NotionIndexClient('fixture-token').fetchBlockChildren('a'),/429/);
  assert.equal(calls,1);
 }finally{global.fetch=original;}
});
