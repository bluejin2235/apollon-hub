// Driver for the documented cua_repl Tab API, not a server-callable browser service.
// Run start and finish inside the authorized browser session. The Notion tab must
// already be a NEW basic-AI chat with the Working-only source selection inspected.
// No credentials, cookies, private application state, or hidden network APIs are read.
// This source records the procedure exercised in the 2026-10-04 browser trace;
// it has not independently been run as an imported standalone module.
export async function startA({luna,notion,scopeProof}) {
 if(new URL(await notion.url()).pathname!=='/ai')throw Error('A new basic Notion AI chat is required');
 if(!scopeProof?.working_selected||!scopeProof?.other_sources_off)throw Error('Inspect source scope before running');
 await luna.playwright.getByRole('button',{name:'A 질문 보내기',exact:true}).click();
 await luna.playwright.getByText('실행기가 읽는 요청',{exact:true}).click();
 const job=JSON.parse(await luna.playwright.getByTestId('a-job').innerText({timeoutMs:10000}));
 const input=notion.playwright.getByRole('textbox');
 if((await input.innerText()).trim())throw Error('Refuse to append to existing input');
 await input.pressSequentially(job.question);
 if(await input.innerText()!==job.question)throw Error('Input differs; do not submit');
 const submittedAt=new Date().toISOString();
 await notion.playwright.getByRole('button',{name:'Submit AI message',exact:true}).click();
 await notion.getAXState({emit:false});
 await notion.playwright.getByRole('button',{name:'Copy text',exact:true}).click();
 await notion.getAXState({emit:false});
 const question=await notion.clipboard.readText();
 const occurrences=await notion.playwright.getByRole('button',{name:'Copy text',exact:true}).count();
 if(question!==job.question||occurrences!==1)throw Error('Posted question is different or duplicated');
 return {job,submittedAt,question,occurrences,scopeProof,notionUrl:await notion.url()};
}
function readLinks(button){
 let parent=button;
 while(parent&&!parent.querySelector('a'))parent=parent.parentElement;
 if(!parent)throw Error('Response container unavailable');
 return Array.from(parent.querySelectorAll('a')).map(a=>({text:a.innerText||a.getAttribute('aria-label')||'',href:a.href}));
}
export async function finishA({luna,notion,state}){
 if(await notion.url()!==state.notionUrl)throw Error('Notion conversation changed');
 const copy=notion.playwright.getByRole('button',{name:'Copy response',exact:true});
 // A disabled Copy response is not completion. Clicking waits for it to be enabled.
 await copy.click({timeoutMs:45000});
 const completedAt=new Date().toISOString();
 await notion.getAXState({emit:false});
 const source=await notion.clipboard.readText();
 const stopAbsent=(await notion.playwright.getByRole('button',{name:'Stop AI message',exact:true}).count())===0;
 if(!stopAbsent||source===state.question||source.length<20)throw Error('Answer not complete or clipboard stale');
 const citations=await copy.evaluate(readLinks);
 await copy.click();await notion.getAXState({emit:false});
 const recheck=await notion.clipboard.readText();
 const citationsRecheck=await copy.evaluate(readLinks);
 if(source!==recheck||JSON.stringify(citations)!==JSON.stringify(citationsRecheck))throw Error('Answer changed');
 const receipt={request_id:state.job.request_id,observed_question:state.question,question_occurrences:state.occurrences,submitted_at:state.submittedAt,completed_observed_at:completedAt,scope:'아폴론 Working',scope_proof:state.scopeProof,notion_url:state.notionUrl,source_text:source,source_text_recheck:recheck,citations,citations_recheck:citationsRecheck,completion_evidence:{copy_response_visible:true,stop_button_absent:stopAbsent}};
 await luna.playwright.getByRole('textbox',{name:'브라우저 실행 결과 JSON',exact:true}).fill(JSON.stringify(receipt));
 await luna.playwright.getByRole('button',{name:'자동 수신 결과 처리',exact:true}).click();
 await luna.playwright.getByText('원문 일치·시간·범위 검증 정보',{exact:true}).click({timeoutMs:10000});
 const received=await luna.playwright.getByTestId('a-answer').innerText();
 const result=JSON.parse(await luna.playwright.getByTestId('a-result').innerText());
 if(received!==source||JSON.stringify(result.citations)!==JSON.stringify(citations))throw Error('Transfer mismatch');
 return {source,received,citations,result};
}
