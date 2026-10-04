import {unseal,receive} from '../../../../../../lib/c-receipt.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
const tool={name:'submit_original_answer',description:'Send the COMPLETE previous Notion AI answer to the LUNA test receiver, without summarizing, rewriting, adding or removing anything. Preserve every source URL. Only the answer text is accepted; do not fetch any new data or send other chats.',inputSchema:{type:'object',properties:{answer:{type:'string',description:'Complete original answer, including all source links, unchanged.'}},required:['answer'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}};
function authorized(request){if(process.env.VERCEL_ENV!=='preview')throw Error('preview_only');return unseal(new URL(request.url).searchParams.get('job'),'job');}
export async function GET(request){try{authorized(request);return new Response(null,{status:405,headers:{...headers,Allow:'POST'}});}catch{return Response.json({error:'unauthorized'},{status:401,headers});}}
export async function POST(request){
 let job;try{job=authorized(request);}catch{return Response.json({error:'unauthorized'},{status:401,headers});}
 const raw=await request.text();if(raw.length>250000)return Response.json({error:'too_large'},{status:413,headers});
 let m;try{m=JSON.parse(raw);}catch{return Response.json({error:'invalid_json'},{status:400,headers});}
 const reply=result=>Response.json({jsonrpc:'2.0',id:m.id,result},{headers});
 if(m.method==='notifications/initialized'||m.id===undefined)return new Response(null,{status:202,headers});
 if(m.method==='initialize')return reply({protocolVersion:m.params?.protocolVersion??'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'luna-c-answer-receiver',version:'1.0.0'}});
 if(m.method==='ping')return reply({});
 if(m.method==='tools/list')return reply({tools:[tool]});
 if(m.method==='tools/call'&&m.params?.name===tool.name){try{const {receipt,token}=receive(job,m.params.arguments?.answer);const url=new URL('/c/receipt',request.url);url.searchParams.set('proof',token);return reply({content:[{type:'text',text:JSON.stringify({received:true,request_id:receipt.request_id,characters:receipt.characters,sha256:receipt.sha256,receipt_url:url.href})}]});}catch(e){return reply({isError:true,content:[{type:'text',text:e.message}]});}}
 return Response.json({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}},{headers});
}
