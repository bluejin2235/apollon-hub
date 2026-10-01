/** Resume an existing evaluation on its immutable deployment. Never starts a
 * new run, changes expectations, or treats request completion as a quality pass.
 * Usage: LUNA_EVAL_ACCESS_TOKEN=... node scripts/resume-luna-eval.mjs <deployment-url> <run-id>
 * Optional: VERCEL_AUTOMATION_BYPASS_SECRET for a protected preview.
 */
import {setTimeout as delay} from 'node:timers/promises';

const [base,runId]=process.argv.slice(2);
const token=process.env.LUNA_EVAL_ACCESS_TOKEN;
if(!base || !runId || !token) throw Error('Deployment URL, run ID and LUNA_EVAL_ACCESS_TOKEN are required');
const origin=new URL(base);
if(origin.protocol!=='https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname!=='/') throw Error('Use an HTTPS deployment origin without credentials or query parameters');
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) throw Error('Invalid run ID');
const headers={'Content-Type':'application/json',Authorization:`Bearer ${token}`};
if(process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass']=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const deadline=Date.now()+6*60*60*1000;
let transientFailures=0;
while(Date.now()<deadline) {
  let response;
  try {
    response=await fetch(new URL('/api/luna/eval/exam',origin),{method:'POST',headers,redirect:'error',body:JSON.stringify({run_id:runId}),signal:AbortSignal.timeout(810000)});
  } catch {
    if(++transientFailures>5) throw Error('Repeated connection failures; run remains incomplete');
    console.log('Connection interrupted; waiting for the worker lease before retrying the same run.');
    await delay(30000);continue;
  }
  if([502,503,504,429].includes(response.status)) {
    await response.body?.cancel();
    if(++transientFailures>5) throw Error(`Repeated HTTP ${response.status}; run remains incomplete`);
    console.log(`HTTP ${response.status}; retrying the same deployment and run after lease expiry.`);
    await delay(30000);continue;
  }
  if(!response.ok) throw Error(`HTTP ${response.status}; no automatic restart or deployment switch`);
  const result=await response.json();
  if(result.run_id!==runId) throw Error('Unexpected evaluation response');
  if(result.continued===true) {
    transientFailures=0;
    console.log(result.skipped?'Worker active; waiting.':'Checkpoint saved; continuing.');
    await delay(result.skipped?30000:1000);continue;
  }
  if(result.skipped && result.reason!=='run finished') throw Error('Continuation refused; verify the original deployment and run');
  if(result.continued!==false) throw Error('No verified final state in evaluation response');
  console.log(JSON.stringify({status:'finished',total:result.total,passed:result.passed,failed:result.failed}));
  process.exitCode=result.total>0 && result.passed===result.total && result.failed===0?0:2;
  break;
}
if(Date.now()>=deadline) throw Error('Supervisor time budget reached; run remains incomplete');
