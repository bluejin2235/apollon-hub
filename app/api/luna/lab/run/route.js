import {performance} from 'node:perf_hooks';
import {readiness,newRun,block,QUESTION} from '../../../../../lib/lab.mjs';
import {runCustomAgent} from '../../../../../lib/notion-api.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function POST(request){
  const start=performance.now();
  if(process.env.VERCEL_ENV==='production') return Response.json({error:'시험 코드는 운영에서 실행할 수 없습니다.'},{status:403});
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin) return Response.json({error:'동일 출처 요청만 허용합니다.'},{status:403});
  const body=await request.json().catch(()=>null);
  if(!body||!['A','B','C'].includes(body.method)||body.question!==QUESTION) return Response.json({error:'고정된 시험 질문과 A/B/C 방식만 허용합니다.'},{status:400});
  const run=newRun(body.method,body.question);
  const checks=readiness()[body.method].checks;
  const preflightMs=Math.round((performance.now()-start)*100)/100;
  let result;
  if(checks.some(c=>!c[1])) result=block(run,checks);
  else if(body.method==='B' && process.env.LUNA_LAB_RUN_ENABLED==='true') result=await runCustomAgent(run,request.signal);
  else result={...run,status:'executor_not_verified',message:'인증 설정만으로 자동 실행하지 않습니다. 연결 대상과 실제 검색 범위 검증이 필요합니다.',stages:run.stages.map((s,i)=>({...s,status:i===0?'blocked':'not_run'}))};
  // No fixture answer, no manual relay, no index fallback, no production database imports.
  return Response.json({...result,preflight_ms:preflightMs,finished_at:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
}
