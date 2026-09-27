const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {startNasTextRun,updateNasTextRunProgress,finishNasTextRun}=loadTs('lib/luna/nas-text-runs.ts');
const progress={ok:1,empty:0,failed:0,skipped:0,chunksCreated:2,embeddingsCreated:0};
function client({rows=[{id:'other',status:'running'},{id:'mine',status:'running'}],error=null,missingReceipt=false}={}) {
  const calls=[];
  return {rows,calls,from(){
    let op,payload; const filters=[];
    const q={insert(p){op='insert';payload=p;return q;},update(p){op='update';payload=p;return q;},
      eq(k,v){filters.push([k,v]);return q;},select(){return q;},
      async single(){
        calls.push({op,payload,filters});
        if(error)return {error,data:null};
        if(missingReceipt)return {error:null,data:null};
        if(op==='insert'){rows.push({id:'new',...payload});return {error:null,data:{id:'new'}};}
        const selected=rows.filter(r=>filters.every(([k,v])=>r[k]===v));
        if(selected.length!==1)return {data:null,error:{code:'PGRST116',message:'Expected one row'}};
        Object.assign(selected[0],payload);return {data:{id:selected[0].id},error:null};
      }};
    return q;
  }};
}
test('starting a run does not interrupt any existing running worker',async()=>{
  const db=client();assert.equal(await startNasTextRun(db,'incremental',3),'new');
  assert.equal(db.rows.find(r=>r.id==='other').status,'running');
  assert.equal(db.rows.find(r=>r.id==='mine').status,'running');
  assert.equal(db.calls.length,1);assert.equal(db.calls[0].op,'insert');
});
test('start fails closed on database failure or missing receipt',async()=>{
  await assert.rejects(startNasTextRun(client({error:{message:'offline'}}),'full',1),/start failed/);
  await assert.rejects(startNasTextRun(client({missingReceipt:true}),'full',1),/no receipt/);
});
test('progress and finish only update their own running record',async()=>{
  const db=client();await updateNasTextRunProgress(db,'mine',progress);
  await finishNasTextRun(db,'mine','done',progress);
  assert.deepEqual(db.rows.find(r=>r.id==='other'),{id:'other',status:'running'});
  assert.equal(db.rows.find(r=>r.id==='mine').status,'done');
  for(const call of db.calls)assert.deepEqual(call.filters,[['id','mine'],['status','running']]);
});
test('completed or externally interrupted receipt cannot be rewritten',async()=>{
  for(const status of ['done','failed','interrupted']){
    const db=client({rows:[{id:'mine',status}]});
    await assert.rejects(updateNasTextRunProgress(db,'mine',progress),/progress failed/);
    await assert.rejects(finishNasTextRun(db,'mine','done',progress),/finish failed/);
    assert.deepEqual(db.rows,[{id:'mine',status}]);
  }
});
test('completion persistence failure propagates instead of reporting success',async()=>{
  await assert.rejects(finishNasTextRun(client({error:{message:'offline'}}),'mine','done',progress),/finish failed/);
  await assert.rejects(updateNasTextRunProgress(client({missingReceipt:true}),'mine',progress),/receipt mismatch/);
});
