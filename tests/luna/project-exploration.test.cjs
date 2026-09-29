const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {reviewProjectExploration}=loadTs('lib/luna/project-exploration.ts');
const projects=Array.from({length:49},(_,i)=>({key:'project-'+i,pageIds:['page-'+i]}));
test('every directory entry is assessed, including late projects outside a generated shortlist',async()=>{
 const seen=[];
 const result=await reviewProjectExploration(projects,async batch=>{
  seen.push(...batch.map(p=>p.key));
  return {explore:batch.flatMap((p,i)=>p.key==='project-48'?[i]:[]),unrelated:batch.flatMap((p,i)=>p.key!=='project-48'?[i]:[])};
 });
 assert.deepEqual(seen,projects.map(p=>p.key));
 assert.deepEqual(result.selected.map(p=>p.key),['project-48']);
 assert.deepEqual(result.unverified,[]);
});
test('invalid partitions retry and preserve unresolved navigation as explicitly incomplete',async()=>{
 let calls=0;
 const result=await reviewProjectExploration(projects.slice(0,2),async()=>{calls++;return {explore:[0],unrelated:[0]};});
 assert.equal(calls,2);assert.equal(result.selected.length,2);
 assert.deepEqual(result.unverified,['project-0','project-1']);
});
