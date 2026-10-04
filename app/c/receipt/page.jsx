import {unseal} from '../../../lib/c-receipt.mjs';
export const dynamic='force-dynamic';
export default async function Receipt({searchParams}){let data;try{if(process.env.VERCEL_ENV!=='preview')throw Error();data=unseal((await searchParams).proof,'receipt');}catch{return <main><h1>수신 영수증이 없거나 만료됐습니다.</h1></main>;}
 return <main style={{maxWidth:1000,margin:'40px auto',padding:24,fontFamily:'sans-serif'}}><h1>C · 루나 서버 실제 수신 원문</h1><p>수신은 확인됐습니다. 노션 원문과의 일치 여부는 별도 대조해야 합니다.</p><p>{data.characters}자 · 수신 시간 {data.received_at}</p><pre data-testid="c-answer" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{data.answer}</pre><details><summary>수신 증거</summary><pre data-testid="c-receipt" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(data,null,2)}</pre></details></main>;
}
