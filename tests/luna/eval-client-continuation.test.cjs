const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {continueEvalInBrowser,EvalRequestError}=loadTs('lib/luna/eval-client-continuation.ts');

test('gateway failures and active leases resume only the same known run',async()=>{
  const ids=[],waits=[];let progress=0;
  const replies=[new EvalRequestError('gateway',504),{continued:true,skipped:true,run_id:'same'},
    {continued:true,skipped:false,run_id:'same'},new TypeError('fetch failed'),{continued:false,skipped:false,run_id:'same',passed:4,total:6}];
  const result=await continueEvalInBrowser({runId:'same',request:async id=>{
    ids.push(id);const next=replies.shift();if(next instanceof Error) throw next;return next;
  },progress:async()=>{progress++;},sleep:async ms=>{waits.push(ms);}});
  assert.deepEqual(ids,Array(5).fill('same'));assert.equal(progress,4);
  assert.deepEqual(waits,[30000,30000,30000]);assert.equal(result.passed,4);
});
test('authorization and application errors are not blindly retried',async()=>{
  for(const status of [401,403,400,500]) {
    let calls=0;
    await assert.rejects(continueEvalInBrowser({runId:'same',request:async()=>{calls++;throw new EvalRequestError('stop',status);},progress:async()=>{},sleep:async()=>{throw Error('unexpected retry');}}),/stop/);
    assert.equal(calls,1);
  }
});
test('bounded retries leave the original execution recoverable',async()=>{
  let calls=0,clock=0;
  await assert.rejects(continueEvalInBrowser({runId:'same',request:async()=>{calls++;throw new EvalRequestError('unavailable',503);},progress:async()=>{},sleep:async ms=>{clock+=ms;},now:()=>clock,maxMs:60000}),/같은 실행/);
  assert.equal(calls,2);
});
test('a deployment mismatch response ends continuation without a new run',async()=>{
  const response={run_id:'same',skipped:true,continued:false,reason:'different deployment'};
  assert.equal(await continueEvalInBrowser({runId:'same',request:async()=>response,progress:async()=>{throw Error('unexpected continuation');}}),response);
});
