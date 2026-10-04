'use client';
import {useState,useRef} from 'react';
const QUESTION='원형보존지 관련 자료 모두 찾아줘';
export default function BTrial(){
 const secret=useRef(null),started=useRef(0);
 const [agentId,setAgentId]=useState(''),[scope,setScope]=useState(false),[running,setRunning]=useState(false),[result,setResult]=useState(null),[elapsed,setElapsed]=useState(null);
 async function run(e){
  e.preventDefault();if(running)return;setRunning(true);setResult(null);started.current=performance.now();
  const token=secret.current.value;secret.current.value='';
  try{const response=await fetch('/api/luna/lab/b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:QUESTION,token,agentId,scopeReviewed:scope})});const data=await response.json();setResult(data);}catch{setResult({status:'transport_failed',message:'서버 응답을 받지 못했습니다. 재실행 전 노션 세션을 확인해야 합니다.'});}
  finally{setElapsed(Math.round(performance.now()-started.current));setRunning(false);}
 }
 return <main style={{maxWidth:1000,margin:'40px auto',padding:24,fontFamily:'sans-serif',color:'#222'}}>
  <h1>LUNA B · 공식 커스텀 에이전트 API 시험</h1>
  <p>기본 노션 AI가 아닌 별도 커스텀 에이전트입니다. 실제 API 응답만 표시합니다.</p>
  <form onSubmit={run} style={{display:'grid',gap:16}}>
   <label>시험 에이전트 ID<input aria-label="시험 에이전트 ID" value={agentId} onChange={e=>setAgentId(e.target.value)} required style={{display:'block',width:'100%',padding:10}}/></label>
   <label>API 인증키<input aria-label="API 인증키" type="password" ref={secret} autoComplete="off" required style={{display:'block',width:'100%',padding:10}}/></label>
   <label><input type="checkbox" checked={scope} onChange={e=>setScope(e.target.checked)} required/> Working 자료만 읽는 전용 에이전트임을 확인했습니다.</label>
   <p data-testid="b-question">{QUESTION}</p>
   <button disabled={running||!scope} style={{padding:14}}>{running?'노션 API 실행·응답 대기 중…':'동일 질문으로 B 테스트 1회 실행'}</button>
  </form>
  <p>인증키는 제출 직후 입력창에서 비워지며, 서버의 이번 요청에서만 사용됩니다. 반복·예약 실행은 없습니다.</p>
  {running&&<p role="status">실제 노션 커스텀 에이전트의 답변 완료를 기다립니다. 최대 4분.</p>}
  {result&&<section><h2>결과: {result.status??result.error}</h2><p>브라우저에서 측정한 전체 시간: {elapsed} ms</p>
   <ul>{result.stages?.map(s=><li key={s.step}>{s.step}. {s.name}: {s.status}</li>)}</ul>
   <h3>노션 API에서 수신한 원문</h3><pre data-testid="b-answer" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{result.answer??'수신 완료된 답변 없음'}</pre>
   <details><summary>원문·링크·세션을 포함한 검증 JSON</summary><pre data-testid="b-result" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify({...result,browser_total_ms:elapsed},null,2)}</pre></details>
  </section>}
 </main>;
}
