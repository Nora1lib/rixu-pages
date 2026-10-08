import { parseCapture, dayKey } from './planner.js';
const pad=(n)=>String(n).padStart(2,'0');
const API_URL='https://rixu-ai-service-2026.valerienora11.chatgpt.site/api/recognize';
export async function recognizeWithDeepSeek(text,now=new Date()) {
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),16000);
  try{
    const response=await fetch(API_URL,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text.slice(0,2000),localNow:`${dayKey(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Shanghai'})});
    if(!response.ok)throw new Error(`智能识别${response.status}`);const payload=await response.json();
    if(!Array.isArray(payload.tasks)||!payload.tasks.length||payload.tasks.length>12)throw new Error('识别结果格式无效');
    return payload.tasks.map(item=>{
      if(!item||typeof item.title!=='string'||!item.title.trim())throw new Error('识别结果格式无效');
      const sourceText=typeof item.sourceText==='string'&&item.sourceText.trim()?item.sourceText:text;
      const local=parseCapture(sourceText,now)[0]||{};
      const date=(v)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)&&Number.isFinite(new Date(v).getTime())?v:'';
      const kind=item.kind==='event'?'event':'task';
      return {...item,title:item.title.trim().slice(0,180),sourceText,kind,startTime:local.startTime||date(item.startTime)||(kind==='event'?date(item.time):''),
        endTime:local.endTime||date(item.endTime),deadlineTime:local.deadlineTime||date(item.deadlineTime),
        duration:!local.inferred?local.duration:Math.max(10,Math.min(Number(item.duration)||local.duration||45,480)),
        questType:['main','side','normal','adventure','daily'].includes(item.questType)?item.questType:'normal',
        priority:['auto','high','medium','low'].includes(item.priority)?item.priority:'auto',
        recordState:local.recordState!=='future'?local.recordState:['future','ongoing','completed'].includes(item.recordState)?item.recordState:'future',
        inferred:local.inferred,needsTimeConfirmation:local.needsTimeConfirmation};
    });
  }finally{clearTimeout(timeout);}
}
