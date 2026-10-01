const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
let clock=0,calls=[],gradePayload,pause=false;
const {EvalReviewPaused}=loadTs('lib/luna/eval-continuation-control.ts');
const {continueEvalExam,autoGradeAnswer}=loadTs('lib/luna/eval-exam.ts',{
 '@/lib/luna/eval-continuation-control':{EvalReviewPaused},
 '@/lib/luna/engine':{getTierModel:async()=>({model_label:'fixture'})},
 '@/lib/luna/llm/client':{lunaLlmComplete:async(_db,input)=>{gradePayload=JSON.parse(input.user);return {text:JSON.stringify({score:1,must_pass_ok:true,quality_ok:true})};}},
 '@/lib/luna/notify':{LUNA_LINKS:{},lunaNotify:async()=>{throw Error('must not notify');}},
 '@/lib/luna/eval-labels':{evalTierLabel:s=>s},
 '@/lib/luna/run-chat':{runLunaTurn:async(_db,q)=>{if(pause) throw new EvalReviewPaused();calls.push(q);clock+=200000;return {answer:'fixture',notionSources:[],sources:[],metadata:{},streamAudit:{disappearedIds:[]},durationMs:200000};}},
 '@/lib/luna/failures':{recordLunaFailure:async()=>{}}
});
test('semantic grading retains the expected empty result even when explicit rubric fields exist',async()=>{
 await autoGradeAnswer('존재하지 않는 프로젝트 도면','검증된 자료가 없다고 답한다','찾지 못했습니다.',{admin:{},mustPass:'허위 자료는 실패',quality:'간결하게 답한다',searchExpectations:{expect_empty:true}});
 assert.equal(gradePayload.expectation,'검증된 자료가 없다고 답한다');
 assert.deepEqual(gradePayload.search_expectations,{expect_empty:true});
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
test('an expired in-flight case becomes an error, while the remaining case stays resumable',async()=>{
 const checkpoint={case_ids:['a','b'],next:0,trigger:'manual',tier:'heavy',notify:false,assign_reviews:false,in_flight:{case_id:'a',started_at:'2026-01-01T00:00:00Z'}};
 const db=fakeDb({luna_eval_runs:[{id:'run',status:'running',checkpoint,total:2}]});
 db.rpc=async()=>({data:true,error:null});calls=[];
 const result=await continueEvalExam(db,'run',0);
 assert.equal(result.continued,true);assert.equal(checkpoint.next,1);assert.equal(checkpoint.in_flight,undefined);
 assert.deepEqual(calls,[]);
 const failure=db.calls.find(c=>c.table==='luna_eval_results' && c.mutation)?.mutation;
 assert.equal(failure.verdict,'error');assert.equal(failure.auto_pass,false);assert.equal(failure.case_id,'a');
});
test('a saved result survives a worker dying before checkpoint advancement',async()=>{
 const checkpoint={case_ids:['a','b'],next:0,trigger:'manual',tier:'heavy',notify:false,assign_reviews:false,in_flight:{case_id:'a',started_at:'2026-01-01T00:00:00Z'}};
 const db=fakeDb({luna_eval_runs:[{id:'run',status:'running',checkpoint,total:2}],luna_eval_results:[{id:'result',run_id:'run',case_id:'a',verdict:'fail'}]});
 db.rpc=async()=>({data:true,error:null});
 await continueEvalExam(db,'run',0);
 assert.equal(checkpoint.next,1);
 assert.ok(!db.calls.some(c=>c.table==='luna_eval_results' && c.mutation));
});

test('a cooperative pause keeps the same case pending without recording a quality failure',async()=>{
 const checkpoint={case_ids:['a'],next:0,trigger:'manual',tier:'heavy',notify:false,assign_reviews:false};
 const db=fakeDb({luna_eval_runs:[{id:'run',status:'running',checkpoint}],luna_eval_cases:[{id:'a',question:'a',connectors:{}}]});
 db.rpc=async()=>({data:true,error:null});pause=true;
 try {
  const result=await continueEvalExam(db,'run');
  assert.equal(result.continued,true);assert.equal(checkpoint.next,0);
  assert.equal(checkpoint.in_flight,undefined);assert.equal(checkpoint.review_case.case_id,'a');
  assert.ok(!db.calls.some(c=>c.table==='luna_eval_results' && c.mutation));
  assert.ok(!db.calls.some(c=>c.mutation?.status==='done'));
 } finally {pause=false;}
});
test('a different deployment cannot acquire the worker or mix evaluation results',async()=>{
 const checkpoint={deployment:'original-deployment',case_ids:['a'],next:0};
 const db=fakeDb({luna_eval_runs:[{id:'run',status:'running',checkpoint}]});
 db.rpc=async()=>{throw Error('must not claim');};
 const result=await continueEvalExam(db,'run');
 assert.equal(result.skipped,true);assert.equal(result.continued,false);
 assert.match(result.reason,/different or unpinned deployment/);
 assert.ok(!db.calls.some(c=>c.mutation));
});
test('hard termination preserves checkpointed batches and retries the same case with a bounded retry count',async()=>{
 const checkpoint={case_ids:['a','b'],next:0,trigger:'manual',tier:'heavy',notify:false,assign_reviews:false,
  review_case:{case_id:'a',entries:{saved:{direct:[],adjacent:[],unrelated:[0]}},interruptions:0},
  in_flight:{case_id:'a',started_at:'2026-01-01T00:00:00Z'}};
 const db=fakeDb({luna_eval_runs:[{id:'run',status:'running',checkpoint}]});
 db.rpc=async()=>({data:true,error:null});
 await continueEvalExam(db,'run',0);
 assert.equal(checkpoint.next,0);assert.equal(checkpoint.review_case.interruptions,1);
 assert.ok(checkpoint.review_case.entries.saved);
 assert.ok(!db.calls.some(c=>c.table==='luna_eval_results' && c.mutation));
 checkpoint.review_case.interruptions=2;
 checkpoint.in_flight={case_id:'a',started_at:'2026-01-01T00:00:00Z'};
 await continueEvalExam(db,'run',0);
 assert.equal(checkpoint.next,1);
 assert.ok(db.calls.some(c=>c.table==='luna_eval_results' && c.mutation?.verdict==='error'));
});
