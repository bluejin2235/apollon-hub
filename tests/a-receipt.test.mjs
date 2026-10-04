import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SCOPE,TEAMSPACES} from '../lib/scope.mjs';
import {validateReceipt} from '../lib/a-receipt.mjs';
const now=Date.parse('2026-10-03T16:00:00Z');
const job={scope:SCOPE,request_id:'one',nonce:'random',execution_mode:'supervised_cua_browser',question:'원형보존지 관련 자료 모두 찾아줘',started_at:new Date(now-60000).toISOString()};
const r={request_id:'one',observed_question:job.question,question_occurrences:1,submitted_at:new Date(now-50000).toISOString(),completed_observed_at:new Date(now-1000).toISOString(),scope:SCOPE,scope_proof:{selected_teamspaces:TEAMSPACES,other_sources_off:true},notion_url:'https://app.notion.com/chat?t=example',source_text:'This is a synthetic validation fixture, not a Notion result.',source_text_recheck:'This is a synthetic validation fixture, not a Notion result.',citations:[],citations_recheck:[],completion_evidence:{copy_response_visible:true,stop_button_absent:true}};
test('browser receipt rejects replay, duplicate question, unstable text and absent completion',()=>{
 assert.deepEqual(validateReceipt(job,r,'random',now),[]);
 assert.ok(validateReceipt(job,r,'other',now).length);
 assert.ok(validateReceipt(job,{...r,question_occurrences:2},'random',now).length);
 assert.ok(validateReceipt(job,{...r,source_text_recheck:r.source_text+' altered'},'random',now).length);
 assert.ok(validateReceipt(job,{...r,completion_evidence:{}},'random',now).length);
 assert.ok(validateReceipt(job,{...r,citations_recheck:[{text:'new',href:'https://example.com'}]},'random',now).length);
});

test('reject subset scope, duplicates, and external sources',()=>{
 for (const scope_proof of [{selected_teamspaces:['아폴론 Working'],other_sources_off:true},{selected_teamspaces:['아폴론 Working','WORKING','WORKING'],other_sources_off:true},{selected_teamspaces:TEAMSPACES,other_sources_off:false}]) assert.ok(validateReceipt(job,{...r,scope_proof},'random',now).length);
});
