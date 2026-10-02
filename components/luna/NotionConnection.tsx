"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { NotionMark } from "@/components/luna/NotionMark";
export function NotionConnection() {
  const [connected,setConnected]=useState<boolean|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const connectButton=useRef<HTMLButtonElement>(null);
  const headers=async()=>{const {data}=await supabase.auth.getSession();return {Authorization:`Bearer ${data.session?.access_token || ""}`};};
  const refresh=useCallback(async()=>{try{const r=await fetch("/api/luna/notion/connection",{headers:await headers(),cache:"no-store"});const data=await r.json();if(!r.ok)throw new Error(data.error);setConnected(data.connected===true);}catch{setConnected(null);}},[]);
  useEffect(()=>{
    void refresh();
    const show=()=>{setOpen(true);setError("");};
    const message=(event:MessageEvent)=>{if(event.origin!==window.location.origin||event.data?.type!=="luna-notion-connection")return;setBusy(false);void refresh();if(event.data.status==="connected"){setOpen(false);setError("");}else{setOpen(true);setError("노션 연결이 완료되지 않았습니다. 아폴론 Working에 참여한 본인 계정인지 확인해 주세요.");}};
    window.addEventListener("luna-notion-connect",show);window.addEventListener("message",message);
    const params=new URLSearchParams(window.location.search),status=params.get("notion_connection");
    if(status){
      if(window.opener){window.opener.postMessage({type:"luna-notion-connection",status},window.location.origin);window.close();}
      else if(status!=="connected"){setOpen(true);setError("노션 연결을 완료하지 못했습니다. 다시 연결해 주세요.");}
      params.delete("notion_connection");window.history.replaceState({},"",`${window.location.pathname}${params.size?`?${params}`:""}`);
    }
    const focus=()=>{void refresh();};window.addEventListener("focus",focus);
    return()=>{window.removeEventListener("luna-notion-connect",show);window.removeEventListener("message",message);window.removeEventListener("focus",focus);};
  },[refresh]);
  useEffect(()=>{if(open)connectButton.current?.focus();},[open]);
  async function connect(){
    setBusy(true);setError("");
    const popup=window.open("about:blank","luna-notion-connect","width=640,height=760");
    try{
      const r=await fetch("/api/luna/notion/connect",{method:"POST",headers:await headers()});const data=await r.json();
      if(!r.ok||typeof data.url!=="string")throw new Error(data.error||"연결을 시작하지 못했습니다.");
      if(popup)popup.location.href=data.url;else window.location.assign(data.url);
    }catch(e){popup?.close();setError(e instanceof Error?e.message:"연결 실패");}finally{setBusy(false);}
  }
  async function disconnect(){setBusy(true);try{const r=await fetch("/api/luna/notion/connection",{method:"DELETE",headers:await headers()});if(!r.ok)throw new Error();setConnected(false);setOpen(false);}catch{setError("연결을 해제하지 못했습니다.");}finally{setBusy(false);}}
  return <>
    <button type="button" onClick={()=>setOpen(true)} className="mb-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[12px] text-[#52665b] hover:bg-[#edf3ee]" aria-label="내 노션 연결 관리"><NotionMark />{connected?"내 노션 연결됨":"내 노션 연결"}</button>
    {open&&<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-5" onClick={()=>!busy&&setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-labelledby="notion-connect-title" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==="Escape"&&!busy)setOpen(false);if(e.key==="Tab"){const nodes=e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}}>
        <h2 id="notion-connect-title" className="text-lg font-semibold">내 노션 계정 연결</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">본인의 노션 계정으로 로그인해 주세요. 루나는 연결한 계정으로 아폴론 Working 팀스페이스만 검색합니다.</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">연결하지 않아도 이미지·파일 검색은 이용할 수 있습니다. 비밀번호는 노션 로그인 화면에서만 입력합니다.</p>
        {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button ref={connectButton} type="button" disabled={busy} onClick={()=>void connect()} className="min-h-11 rounded-xl bg-[#315e49] px-4 text-sm text-white disabled:opacity-50">{busy?"연결 중…":connected?"계정 다시 연결":"노션 로그인"}</button>
          {connected&&<button type="button" disabled={busy} onClick={()=>void disconnect()} className="min-h-11 px-3 text-sm text-slate-600">연결 해제</button>}
          <button type="button" disabled={busy} onClick={()=>setOpen(false)} className="min-h-11 px-3 text-sm text-slate-600">닫기</button>
        </div>
      </section>
    </div>}
  </>;
}
