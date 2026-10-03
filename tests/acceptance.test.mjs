import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTranscript,readiness,newRun,block,QUESTION} from '../lib/lab.mjs';
test('duplicated input invalidates every downstream success',()=>{
 const source={status:'completed',text:'actual answer',citations:['source']};
 assert.deepEqual(verifyTranscript(QUESTION,QUESTION+QUESTION,source,source),{inputOk:false,completed:false,bodyMatches:false,linksMatch:false,passed:false});
});
test('completed answer with missing citation or truncated body is not success',()=>{
 const source={status:'completed',text:'完整 원문 answer',citations:['source-a','source-b']};
 assert.equal(verifyTranscript(QUESTION,QUESTION,source,{...source,text:'完整'}).passed,false);
 assert.equal(verifyTranscript(QUESTION,QUESTION,source,{...source,citations:['source-a']}).passed,false);
 assert.equal(verifyTranscript(QUESTION,QUESTION,source,{...source}).passed,true);
});
test('missing runtime prerequisites are blocked before search, not a failed search or answer',()=>{
 for(const method of ['A','B','C']){
  const result=block(newRun(method,QUESTION),readiness({})[method].checks);
  assert.deepEqual(result.stages.map(s=>s.status),['blocked','not_run','not_run']);
  assert.equal(result.notion_called,false);assert.equal(result.answer,null);assert.equal(result.total_ms,null);
 }
});
