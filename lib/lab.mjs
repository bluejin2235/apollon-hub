import {createHash,randomUUID} from 'node:crypto';
export const QUESTION='원형보존지 관련 자료 모두 찾아줘';
export const SCOPE='아폴론 Working';
export const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
export function readiness(env=process.env) {
  const browser=Boolean(env.LUNA_LAB_BROWSER_WORKER_URL && env.LUNA_LAB_BROWSER_WORKER_KEY);
  const browserIdentity=Boolean(env.LUNA_LAB_BROWSER_PROFILE_ID);
  const scope=env.LUNA_LAB_SCOPE_REVIEWED==='working-only';
  const api=Boolean(env.LUNA_LAB_NOTION_API_TOKEN);
  const agent=Boolean(env.LUNA_LAB_NOTION_AGENT_ID);
  const callback=Boolean(env.LUNA_LAB_CALLBACK_URL && env.LUNA_LAB_CALLBACK_KEY);
  return {
    A:{checks:[['browser_worker',browser,'루나가 호출할 전용 브라우저 실행기'],['browser_identity',browserIdentity,'시험 사용자에게 연결된 노션 브라우저 로그인'],['scope',scope,'Working 전용 접근 범위 검토']]},
    B:{checks:[['notion_api_auth',api,'시험 전용 노션 API 인증'],['custom_agent',agent,'검색 전용 커스텀 에이전트'],['scope',scope,'Working 전용 접근 범위 검토']]},
    C:{checks:[['browser_worker',browser,'질문을 입력할 전용 브라우저 실행기'],['browser_identity',browserIdentity,'시험 사용자에게 연결된 노션 브라우저 로그인'],['callback',callback,'노션에서 호출할 인증된 루나 MCP 수신기'],['scope',scope,'Working 전용 접근 범위 검토']]}
  };
}
export function newRun(method,question) {
  return {request_id:randomUUID(),method,question,question_sha256:hash(question),started_at:new Date().toISOString(),scope:SCOPE,
    stages:[{step:1,name:'루나 → 노션 질문 전달',status:'not_run',evidence:null},{step:2,name:'동일 요청의 노션 AI 답변 완료',status:'not_run',evidence:null},{step:3,name:'노션 원문 → 루나 수신 일치',status:'not_run',evidence:null}],
    answer:null,source_answer:null,citations:[],notion_session_id:null,notion_called:false,automatic_transfer:false,
    cost:{measured:false,notion_credits:null,browser_seconds:null},generation_ms:null,transfer_ms:null,total_ms:null};
}
export function block(run,checks) {
  const missing=checks.filter(c=>!c[1]).map(([code,,label])=>({code,label}));
  return {...run,status:'blocked_before_submission',missing,stages:run.stages.map((s,i)=>({...s,status:i===0?'blocked':'not_run'})),message:'노션에 질문을 보내기 전 연결 준비 단계에서 차단됐습니다. 검색 결과와 검색 시간은 없습니다.'};
}
// A completed request alone is not proof of transmission or content identity.
export function verifyTranscript(question,sent,source,received) {
  const inputOk=sent===question;
  const completed=inputOk && source?.status==='completed' && typeof source.text==='string' && source.text.length>0;
  const bodyMatches=completed && typeof received?.text==='string' && source.text===received.text;
  const linksMatch=bodyMatches && JSON.stringify(source.citations??[])===JSON.stringify(received.citations??[]);
  return {inputOk,completed,bodyMatches,linksMatch,passed:Boolean(linksMatch)};
}
