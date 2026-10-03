import {createHash} from 'node:crypto';
import {validateReceipt} from '../../../../../../lib/a-receipt.mjs';
export const dynamic='force-dynamic';
export async function POST(request){
 const start=performance.now();
 if(process.env.VERCEL_ENV==='production')return Response.json({error:'운영 실행 금지'},{status:403});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'동일 출처만 허용'},{status:403});
 const raw=await request.text();if(Buffer.byteLength(raw)>1000000)return Response.json({error:'시험 반환 용량 초과'},{status:413});
 let body;try{body=JSON.parse(raw);}catch{return Response.json({error:'잘못된 JSON'},{status:400});}
 const {job,receipt:r}=body;
 const cookie=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('luna_a_trial='))?.slice('luna_a_trial='.length);
 const errors=validateReceipt(job,r,cookie,Date.now());
 if(errors.length)return Response.json({error:errors.join(' / ')},{status:422,headers:{'Cache-Control':'no-store'}});
 const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
 // These are DOM observations attested by the supervised browser worker, not Notion API events.
 // Return the supplied original verbatim. No model, index, database, or summary is involved.
 const result={request_id:job.request_id,execution_mode:job.execution_mode,evidence_type:'supervised_browser_DOM_observation',production_ready:false,stages:['화면 확인','완료 화면 확인','원문 일치'],question:job.question,notion_user_message:r.observed_question,notion_url:r.notion_url,scope:r.scope,scope_proof:r.scope_proof,answer:r.source_text,citations:r.citations,question_sha256:hash(job.question),source_sha256:hash(r.source_text),received_sha256:hash(r.source_text),citations_sha256:hash(JSON.stringify(r.citations)),source_chars:Array.from(r.source_text).length,source_utf8_bytes:Buffer.byteLength(r.source_text,'utf8'),citation_count:r.citations.length,submitted_at:r.submitted_at,completed_observed_at:r.completed_observed_at,received_at:new Date().toISOString(),generation_ms:Date.parse(r.completed_observed_at)-Date.parse(r.submitted_at),total_ms:Date.now()-Date.parse(job.started_at),server_receive_ms:Math.round((performance.now()-start)*100)/100,completion_evidence:r.completion_evidence,cost_measured:false};
 return Response.json(result,{headers:{'Cache-Control':'no-store','Set-Cookie':'luna_a_trial=; HttpOnly; SameSite=Strict; Secure; Path=/api/luna/lab/a; Max-Age=0'}});
}
