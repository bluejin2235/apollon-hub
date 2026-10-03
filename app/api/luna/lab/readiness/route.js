import {readiness} from '../../../../../lib/lab.mjs';
export const dynamic='force-dynamic';
export function GET(){return Response.json({environment:process.env.VERCEL_ENV||'local',database_access:false,legacy_search:false,methods:readiness()},{headers:{'Cache-Control':'no-store'}});}
