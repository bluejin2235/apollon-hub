const test = require('node:test'), assert = require('node:assert/strict');
const {loadTs} = require('./helpers.cjs');
const cache = new Map();
const {createEvalReviewCheckpoint} = loadTs('lib/luna/eval-review-checkpoint.ts', {}, cache);
const {EvalReviewPaused} = loadTs('lib/luna/eval-continuation-control.ts', {}, cache);
const {reviewAllNotionEvidence} = loadTs('lib/luna/notion-evidence-review.ts', {}, cache);
const source = id => ({id, title:id, excerpt:'A concrete installation constraint from the original source.'});
const result = batch => ({direct:batch.map((_,i)=>i), adjacent:[], unrelated:[], evidence:batch.map((_,i)=>({index:i, quote:'A concrete installation constraint', reason:'This source contains an explicit design constraint.'}))});

test('a serialized checkpoint resumes all documents without rerunning completed batches', async () => {
  const realNow=Date.now; let clock=0, persisted={}, calls=0;
  Date.now=()=>clock;
  try {
    const sources=Array.from({length:112},(_,i)=>source(String(i)));
    const entries={};
    const first=createEvalReviewCheckpoint({entries,deadline:180000,save:async()=>{persisted=JSON.parse(JSON.stringify(entries));}});
    const work=async batch=>{calls++; await Promise.resolve(); clock=100000; return result(batch);};
    await assert.rejects(reviewAllNotionEvidence(sources,b=>first.review('same question and rules',b,pending=>work(pending))),EvalReviewPaused);
    assert.equal(calls,6);
    assert.equal(Object.keys(persisted).length,96);
    clock=0;
    const second=createEvalReviewCheckpoint({entries:persisted,deadline:300000,save:async()=>{}});
    const reviewed=await reviewAllNotionEvidence(sources,b=>second.review('same question and rules',b,pending=>work(pending)));
    assert.equal(calls,7);
    assert.equal(reviewed.direct.length,112);
    assert.deepEqual(reviewed.unverifiedIds,[]);
    assert.equal(new Set(reviewed.reviewedIds).size,112);
  } finally {Date.now=realNow;}
});

test('changed question, rules, model or body cannot reuse a review', async () => {
  const entries={};let calls=0;
  const session=createEvalReviewCheckpoint({entries,deadline:Date.now()+600000,save:async()=>{}});
  async function review(identity,batch) {return session.review(identity,batch,async()=>{calls++;return result(batch);});}
  const identity={question:'q',rules:'r',model:'m'};
  await review(identity,[source('a')]);
  await review(identity,[source('a')]);
  assert.equal(calls,1);
  for (const field of ['question','rules','model']) await review({...identity,[field]:'changed'},[source('a')]);
  await review(identity,[{...source('a'),excerpt:source('a').excerpt+' Updated.'}]);
  assert.equal(calls,5);
});

test('ungrounded and incomplete outputs are never checkpointed as completed', async () => {
  const entries={};let saves=0;
  const session=createEvalReviewCheckpoint({entries,deadline:Date.now()+600000,save:async()=>{saves++;}});
  await session.review('q',[source('a')],async()=>({direct:[0],adjacent:[],unrelated:[],evidence:[]}));
  await session.review('q',[source('a')],async()=>null);
  assert.deepEqual(entries,{});assert.equal(saves,0);
});

test('checkpoint writes are serialized and a write failure suspends rather than marks sources unverified', async () => {
  let active=0,maximum=0;
  const entries={};
  const session=createEvalReviewCheckpoint({entries,deadline:Date.now()+600000,save:async()=>{active++;maximum=Math.max(maximum,active);await Promise.resolve();active--;}});
  await Promise.all(['a','b','c'].map(id=>session.review('q',[source(id)],async()=>result([source(id)]))));
  assert.equal(maximum,1);
  const failing=createEvalReviewCheckpoint({entries:{},deadline:Date.now()+600000,save:async()=>{throw Error('DB unavailable');}});
  await assert.rejects(reviewAllNotionEvidence([source('a')],b=>failing.review('q',b,async()=>result(b))),/Checkpoint persistence failed/);
});

test('a paused stream reaches the evaluation caller as suspension, not an incomplete answer',async()=>{
  const {runLunaTurn}=loadTs('lib/luna/run-chat.ts',{
    'next/server':{NextRequest:Request},
    '@/lib/luna/chat-handler':{executeLunaChat:async()=>new Response(new ReadableStream({start(controller){controller.error(new EvalReviewPaused());}}))}
  });
  await assert.rejects(runLunaTurn({},'question',{},'actor'),EvalReviewPaused);
});

test('retrieval score changes do not repeat an identical rendered review request',async()=>{
 const entries={};let calls=0;
 const session=createEvalReviewCheckpoint({entries,deadline:Date.now()+600000,save:async()=>{}});
 const identity={request:{system:'same rule',user:'same question and document text'},model:'same model'};
 for(const score of [1,2]) await session.review(identity,[{...source('a'),keyword_score:score,match_score:score}],async()=>{calls++;return result([source('a')]);});
 assert.equal(calls,1);
});

test('reordering and regrouping preserve per-source decisions and only new windows invoke the model',async()=>{
 const entries={},requests=[];
 const cp=createEvalReviewCheckpoint({entries,deadline:Date.now()+600000,save:async()=>{}});
 const work=async pending=>{requests.push(pending.map(s=>s.id));return result(pending);};
 await cp.review({question:'q',rules:'r'},[source('a'),source('b')],work);
 const replay=await cp.review({question:'q',rules:'r'},[source('b'),source('c'),source('a')],work);
 assert.deepEqual(requests,[['a','b'],['c']]);
 assert.deepEqual(replay.direct,[0,1,2]);
 assert.deepEqual(replay.evidence.map(e=>e.index),[0,1,2]);
 assert.equal(Object.keys(entries).length,3);
});
test('project membership changes require a new decision even with an unchanged body',async()=>{
 let calls=0;const cp=createEvalReviewCheckpoint({entries:{},deadline:Date.now()+600000,save:async()=>{}});
 for(const project_key of ['first','second']) await cp.review('same question',[{...source('a'),project_key}],async pending=>{calls++;return result(pending);});
 assert.equal(calls,2);
});
