import {newRun, QUESTION} from '../../../../../lib/lab.mjs';
import {runCustomAgent} from '../../../../../lib/notion-api.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function POST(request){
  const headers={'Cache-Control':'no-store'};
  if(process.env.VERCEL_ENV!=='preview')return Response.json({error:'preview_only'},{status:403,headers});
  if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'same_origin_required'},{status:403,headers});
  const raw=await request.text();
  if(raw.length>4096)return Response.json({error:'invalid_request'},{status:400,headers});
  let body;try{body=JSON.parse(raw);}catch{return Response.json({error:'invalid_json'},{status:400,headers});}
  if(body.question!==QUESTION||!/^ntn_[A-Za-z0-9_-]+$/.test(body.token??'')||!/^[0-9a-f-]{36}$/.test(body.agentId??'')||body.scopeReviewed!==true)return Response.json({error:'invalid_test_configuration'},{status:400,headers});
  // Credentials remain request-local: no logging, DB persistence or environment mutation.
  const result=await runCustomAgent(newRun('B',QUESTION),request.signal,{LUNA_LAB_NOTION_API_TOKEN:body.token,LUNA_LAB_NOTION_AGENT_ID:body.agentId});
  return Response.json(result,{headers});
}
