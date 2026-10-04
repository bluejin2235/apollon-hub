import {createJob} from '../../../../../../lib/c-receipt.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request){
 const headers={'Cache-Control':'no-store'};
 if(process.env.VERCEL_ENV!=='preview'||request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'preview_same_origin_only'},{status:403,headers});
 try{return Response.json(createJob(),{headers});}catch{return Response.json({error:'receiver_not_configured'},{status:503,headers});}
}
