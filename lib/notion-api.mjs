import {setTimeout as delay} from 'node:timers/promises';
import {hash} from './lab.mjs';

// Official Custom Agent sessions API. This is NOT the basic Notion AI chat API.
export async function runCustomAgent(run,outerSignal,env=process.env){
 const began=Date.now();
 const signal=AbortSignal.any([outerSignal,AbortSignal.timeout(240000)]);
 const token=env.LUNA_LAB_NOTION_API_TOKEN, agentId=env.LUNA_LAB_NOTION_AGENT_ID;
 let sessionId=null;
 async function api(path,body,customSignal=signal){
  const response=await fetch(`https://api.notion.com/v1${path}`,{method:body===undefined?'GET':'POST',redirect:'error',cache:'no-store',signal:customSignal,headers:{Authorization:`Bearer ${token}`,'Notion-Version':'2026-03-11','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok)throw new Error(`notion_http_${response.status}`);
  const raw=await response.text();
  if(Buffer.byteLength(raw)>4*1024*1024)throw new Error('response_too_large');
  return JSON.parse(raw);
 }
 async function events(){
  let cursor;const result=[];
  for(let page=0;page<100;page++){
   const data=await api(`/sessions/${sessionId}/events/query`,{page_size:50,...(cursor?{start_cursor:cursor}:{})});
   if(!Array.isArray(data.results))throw new Error('unexpected_event_schema');
   result.push(...data.results);
   if(!data.has_more)return result.sort((a,b)=>a.sequence-b.sequence);
   if(!data.next_cursor||data.next_cursor===cursor)throw new Error('invalid_event_pagination');
   cursor=data.next_cursor;
  }
  throw new Error('event_limit_exceeded');
 }
 const textOf=e=>Array.isArray(e.content)&&e.content.every(c=>c.type==='text'&&typeof c.text==='string')?e.content.map(c=>c.text).join(''):null;
 try{
  const agent=await api(`/agents/${agentId}`);
  if(agent.id!==agentId||agent.agent_type!=='custom_agent'||agent.status!=='active')throw new Error('agent_not_active');
  // Scope review is a prerequisite, not a guarantee derived from this metadata.
  const session=await api('/sessions',{agent_id:agentId,message:run.question});
  run.notion_called=true;
  if(typeof session.id!=='string'||session.agent_id!==agentId)throw new Error('session_identity_mismatch');
  sessionId=session.id;run.notion_session_id=sessionId;
  let state=session;
  while(['queued','in_progress'].includes(state.status)){
   await delay(1500,undefined,{signal});state=await api(`/sessions/${sessionId}`);
  }
  const sourceEvents=await events();
  const inputs=sourceEvents.filter(e=>e.type==='user.message');
  const exact=inputs.length===1&&textOf(inputs[0])===run.question;
  run.stages[0]={...run.stages[0],status:exact?'passed':'failed',evidence:{session_id:sessionId,input_event_id:inputs[0]?.id??null,exact_question:exact}};
  if(!exact)throw new Error('question_not_verified');
  if(state.status!=='completed')throw new Error(`session_${state.status}`);
  const answers=sourceEvents.filter(e=>e.type==='agent.message');
  if(!answers.length||answers.some(e=>textOf(e)===null))throw new Error('answer_schema_not_supported');
  const sourceText=answers.map(textOf).join('\n\n');
  if(!sourceText)throw new Error('empty_answer');
  run.stages[1]={...run.stages[1],status:'passed',evidence:{session_id:sessionId,status:state.status,answer_event_ids:answers.map(e=>e.id)}};
  run.generation_ms=Date.now()-began;
  // Read the completed source history again, then compare whole content objects.
  // Citation-bearing rich content is preserved in evidence rather than summarized.
  const receivedEvents=(await events()).filter(e=>e.type==='agent.message');
  const sourceContents=answers.map(e=>e.content),receivedContents=receivedEvents.map(e=>e.content);
  const equal=JSON.stringify(sourceContents)===JSON.stringify(receivedContents);
  if(!equal)throw new Error('answer_mismatch');
  run.source_answer=sourceText;run.answer=receivedEvents.map(textOf).join('\n\n');
  run.source_events=answers;run.received_events=receivedEvents;
  run.stages[2]={...run.stages[2],status:'passed',evidence:{source_sha256:hash(JSON.stringify(sourceContents)),received_sha256:hash(JSON.stringify(receivedContents)),character_count:[...sourceText].length,whole_content_equal:equal}};
  run.automatic_transfer=true;run.transfer_ms=Date.now()-began-run.generation_ms;run.total_ms=Date.now()-began;
  return {...run,status:'passed_api_transfer',message:'커스텀 에이전트 API 원문 수신 완료. 기본 노션 AI와의 품질 동등성을 의미하지 않습니다.'};
 }catch(error){
  // Cancellation is attempted, never silently claimed to have stopped the agent.
  if(sessionId){try{await api(`/sessions/${sessionId}/cancel`,{},AbortSignal.timeout(10000));run.cancel_request='sent';}catch{run.cancel_request='unconfirmed';}}
  const step=run.stages.find(s=>s.status==='not_run');if(step)step.status='failed';
  return {...run,status:'failed',error_code:/^[a-z0-9_]+$/.test(error.message)?error.message:'request_interrupted',elapsed_ms:Date.now()-began,message:'자동 연결 시험이 완료되지 않았습니다. 단계별 증거를 확인하세요.'};
 }
}
