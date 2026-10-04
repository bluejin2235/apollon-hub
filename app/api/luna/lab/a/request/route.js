import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {SCOPE,TEAMSPACES} from '../../../../../../lib/scope.mjs';
export const dynamic='force-dynamic';
export async function POST(request){
 if(process.env.VERCEL_ENV==='production')return Response.json({error:'운영 실행 금지'},{status:403});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'동일 출처만 허용'},{status:403});
 const body=await request.json().catch(()=>null);
 if(body?.question!=='원형보존지 관련 자료 모두 찾아줘')return Response.json({error:'고정 시험 질문만 허용'},{status:400});
 const nonce=randomBytes(32).toString('hex');
 const job={request_id:randomUUID(),nonce,question:body.question,question_sha256:createHash('sha256').update(body.question).digest('hex'),started_at:new Date().toISOString(),execution_mode:'supervised_cua_browser',scope:SCOPE,teamspaces:TEAMSPACES,scope_type:'Notion AI UI search filter',status:'awaiting_browser_worker'};
 return Response.json(job,{headers:{'Cache-Control':'no-store','Set-Cookie':`luna_a_trial=${nonce}; HttpOnly; SameSite=Strict; Secure; Path=/api/luna/lab/a; Max-Age=1200`}});
}
