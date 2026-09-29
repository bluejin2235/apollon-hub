const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {resumeNotionCheckpoint,hydrateNotionCheckpointPage}=loadTs('lib/luna/notion-index-resume.ts');
test('cold resume uses slim checkpoint without repeating full discovery or changing cursor order',async()=>{
 const cp={page_ids:['b','a'],cursor:1,scan_batch:'original',page_meta:{a:{title:'A'},b:{title:'B'}}};
 const resumed=await resumeNotionCheckpoint(cp,undefined,async()=>{throw Error('must not rediscover');});
 assert.equal(resumed,cp);
 const calls=[];
 const meta=await hydrateNotionCheckpointPage(resumed.page_ids[resumed.cursor],resumed.page_meta.a,async id=>{calls.push(id);return {object:'page',id,properties:{related:{type:'relation',relation:[{id:'b'}]}}};});
 assert.deepEqual(calls,['a']); assert.equal(meta.properties.related.relation[0].id,'b');
 assert.equal(Object.hasOwn(cp.page_meta.a,'properties'),false);
});
test('legacy metadata recovery never changes the original worklist, scan or progress',async()=>{
 const cp={page_ids:['b','a'],cursor:1,scan_batch:'original',failed_pages:[{page_id:'b',error:'old'}]};
 const result=await resumeNotionCheckpoint(cp,undefined,async()=>({page_ids:['new','a','b'],cursor:0,scan_batch:'new',page_meta:{a:{title:'A'},b:{title:'B'}}}));
 assert.deepEqual(result.page_ids,['b','a']); assert.equal(result.cursor,1); assert.equal(result.scan_batch,'original');
 assert.deepEqual(result.failed_pages,cp.failed_pages);
});
test('warm properties remain intact and unavailable metadata cannot be written as empty relations',async()=>{
 const meta={title:'A',properties:{relation:{type:'relation',relation:[]}}};
 assert.equal(await hydrateNotionCheckpointPage('a',meta,async()=>{throw Error('must not fetch');}),meta);
 for(const live of [null,{object:'page',id:'other',properties:{}},{object:'block',id:'a',properties:{}},{object:'page',id:'a',archived:true,properties:{}},{object:'page',id:'a'}]){
  await assert.rejects(()=>hydrateNotionCheckpointPage('a',{title:'A'},async()=>live),/unavailable/);
 }
 await assert.rejects(()=>hydrateNotionCheckpointPage('a',{title:'A'},async()=>{throw Error('429');}),/429/);
});
