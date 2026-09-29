const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
let clock=0,calls=[];
const {continueEvalExam}=loadTs('lib/luna/eval-exam.ts',{
 '@/lib/luna/engine':{getTierModel:async()=>({model_label:'fixture'})},
 '@/lib/luna/llm/client':{lunaLlmComplete:async()=>({text:JSON.stringify({score:1,must_pass_ok:true,quality_ok:true})})},
 '@/lib/luna/notify':{LUNA_LINKS:{},lunaNotify:async()=>{throw Error('must not notify');}},
 '@/lib/luna/eval-labels':{evalTierLabel:s=>s},
 '@/lib/luna/run-chat':{runLunaTurn:async(_db,q)=>{calls.push(q);clock+=200000;return {answer:'fixture',notionSources:[],sources:[],metadata:{},streamAudit:{disappearedIds:[]},durationMs:200000};}},
 '@/lib/luna/failures':{recordLunaFailure:async()=>{}}
});
test('time budget saves the next case and resumes instead of skipping or completing it',async()=>{
 const realNow=Date.now;Date.now=()=>clock;clock=0;calls=[];
 const checkpoint={case_ids:['a','b','c'],next:0,trigger:'manual',tier:'heavy',notify:false,assign_reviews:false};
 const db=fakeDb({luna_eval_runs:[{id:'run',status:'running',checkpoint,total:3}],luna_eval_cases:['a','b','c'].map(id=>({id,question:id,connectors:{},is_active:true}))});
 const rpc=[];db.rpc=async(name)=>{rpc.push(name);return {data:true,error:null};};
 try{
  const first=await continueEvalExam(db,'run',300000);
  assert.equal(first.continued,true);assert.deepEqual(calls,['a']);assert.equal(checkpoint.next,1);
  assert.ok(!db.calls.some(c=>c.mutation?.status==='done'));
  const second=await continueEvalExam(db,'run',300000);
  assert.equal(second.continued,true);assert.deepEqual(calls,['a','b']);assert.equal(checkpoint.next,2);
  assert.equal(rpc.filter(n=>n==='luna_release_eval_worker').length,2);
 }finally{Date.now=realNow;}
});
test('a completed run cannot create an endless continuation loop',async()=>{
 const db=fakeDb({luna_eval_runs:[{id:'run',status:'done',total:3}]});db.rpc=async()=>({data:false,error:null});
 const result=await continueEvalExam(db,'run');assert.equal(result.continued,false);
});
