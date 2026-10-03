export function validateReceipt(job,r,cookie,now){
 const errors=[];
 if(!job||!r)return ['요청 또는 실행 증거 없음'];
 if(!cookie||cookie!==job.nonce||r.request_id!==job.request_id)return ['현재 브라우저의 요청 연결 불일치'];
 if(job.execution_mode!=='supervised_cua_browser')errors.push('실행 유형 불일치');
 const start=Date.parse(job.started_at),sent=Date.parse(r.submitted_at),done=Date.parse(r.completed_observed_at);
 if(!Number.isFinite(start)||now-start>1200000||start>now||!Number.isFinite(sent)||!Number.isFinite(done)||sent<start||done<sent||done>now)errors.push('실행 시각 불일치 또는 만료');
 if(job.question!=='원형보존지 관련 자료 모두 찾아줘'||r.observed_question!==job.question||r.question_occurrences!==1)errors.push('질문이 정확히 한 번 전달됐다는 증거 없음');
 if(r.scope!=='아폴론 Working'||r.scope_proof?.working_selected!==true||r.scope_proof?.other_sources_off!==true)errors.push('Working 출처 필터 확인 없음');
 let url;try{url=new URL(r.notion_url);}catch{}
 if(url?.protocol!=='https:'||url?.hostname!=='app.notion.com'||url?.pathname!=='/chat'||!url?.searchParams.get('t'))errors.push('노션 대화 URL 증거 없음');
 if(typeof r.source_text!=='string'||r.source_text.trim().length<20||r.source_text!==r.source_text_recheck)errors.push('완료 원문 안정성 확인 없음');
 if(r.completion_evidence?.copy_response_visible!==true||r.completion_evidence?.stop_button_absent!==true)errors.push('노션 완료 화면 확인 없음');
 if(!Array.isArray(r.citations)||!r.citations.every(c=>typeof c.text==='string'&&typeof c.href==='string'&&/^https:\/\//.test(c.href)))errors.push('출처 형식 불일치');
 if(JSON.stringify(r.citations)!==JSON.stringify(r.citations_recheck))errors.push('출처 안정성 불일치');
 return errors;
}
