'use client';
import {useState} from 'react';
export default function CTrial(){const [job,setJob]=useState(null),[error,setError]=useState('');
 async function start(){const r=await fetch('/api/luna/lab/c/job',{method:'POST'});const d=await r.json();if(!r.ok)setError(d.error);else setJob(d);}
 return <main style={{maxWidth:900,margin:'40px auto',padding:24,fontFamily:'sans-serif'}}><h1>LUNA C · 기본 노션 AI → MCP 수신 시험</h1><p>같은 질문의 답변을 먼저 완료한 후, 노션 AI가 수신 도구를 호출하도록 합니다. 수신 원문은 서버가 암호화한 30분 유효 영수증으로 확인하며 DB에 저장하지 않습니다.</p><button onClick={start} disabled={!!job}>C 시험 요청 만들기</button>{error&&<p role="alert">{error}</p>}{job&&<section><p>질문: {job.question}</p><p>요청 생성 완료. 노션 질문 전달·답변 완료·MCP 수신은 아직 미검증입니다.</p><details><summary>연결 설정용 시험 정보</summary><pre data-testid="c-job" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(job,null,2)}</pre></details></section>}</main>;
}
