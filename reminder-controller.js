import { reminderEvents, reminderTitle } from './schedule-lifecycle.js';
const LEDGER='rixu.reminders.v3';
export function createReminderController({getData,show,complete,start,onError}) {
  let active=null,checking=false,nativeSignature='';
  const native=Boolean(window.webkit?.messageHandlers?.rixu);
  const read=()=>{try{return JSON.parse(localStorage.getItem(LEDGER)||'{}')||{};}catch{return {};}};
  const write=(ledger)=>localStorage.setItem(LEDGER,JSON.stringify(ledger));
  const bridge=(value)=>window.webkit?.messageHandlers?.rixu?.postMessage(value);
  function syncNative(){
    if(!native)return;
    const data=getData(),ledger=read(),events=data.quietReminders?reminderEvents(data.tasks,data.preferences).filter((e)=>e.time>=Date.now()&&!['shown','ignored'].includes(ledger[e.key]?.status)).slice(0,60).map((e)=>({id:e.key,title:`${reminderTitle(e.kind)} · ${e.task.title}`,body:e.kind==='deadline'?'交付截止临近，请查看剩余工作。':e.kind==='start'?'即将开始；时间到了不会自动完成。':'本段即将结束，请确认进度。',at:Math.max(Date.now()+1500,ledger[e.key]?.until||e.triggerAt),sound:data.reminderMode==='sound'})):[];
    const signature=JSON.stringify(events);if(signature!==nativeSignature){nativeSignature=signature;bridge({action:'scheduleReminders',events});}
  }
  async function tick(){
    if(checking)return;checking=true;
    try{syncNative();if(document.visibilityState!=='visible'||window.rixuNativeHidden||active)return;
      const action=()=>{
        const data=getData();if(!data.quietReminders)return;
        const ledger=read(),now=Date.now(),events=reminderEvents(data.tasks,data.preferences);
        const available=events.filter((e)=>e.triggerAt<=now&&!['shown','ignored'].includes(ledger[e.key]?.status)&&(!ledger[e.key]?.until||ledger[e.key].until<=now));
        if(!available.length)return;
        const due=available.find((e)=>e.time>=now-300000)||available.find((e)=>e.time>=now-86400000);
        if(!due)return;
        const recovered=due.time<now-300000;
        active={...due,recovered};
        // A missed group becomes one actionable summary, rather than a burst.
        if(recovered)for(const e of available)if(e.time<now)ledger[e.key]={status:'shown',at:now};
        ledger[due.key]={status:'shown',at:now};write(ledger);
        show({...active,title:recovered?'有安排需要确认':reminderTitle(due.kind),minutes:(due.time-now)/60000,count:recovered?available.filter((e)=>e.time<now).length:1});
      };
      if(navigator.locks)await navigator.locks.request('rixu-reminder',action);else action();
    }catch(e){onError?.('提醒记录暂时无法保存，请导出备份后重试。');}finally{checking=false;}
  }
  window.addEventListener('rixu:notification-shown',(event)=>{try{const ledger=read();ledger[event.detail]={status:'shown',at:Date.now()};write(ledger);}catch{}});
  window.addEventListener('rixu:plan-written',()=>{active=null;document.querySelectorAll('#reminderBanner,#widgetReminder').forEach(el=>el.hidden=true);nativeSignature='';syncNative();});
  window.addEventListener('visibilitychange',()=>tick());
  window.addEventListener('rixu:resume',()=>tick());
  window.addEventListener('rixu:native-reminders',event=>{document.querySelectorAll('[data-native-reminder-status]').forEach((el)=>el.textContent=event.detail?.allowed?'Mac 系统通知已获允许；收起后仍可提醒。':'Mac 系统通知未获允许，请在系统设置中开启。');});
  return {tick,syncNative,
    dismiss(){active=null;syncNative();},
    snooze(){if(!active)return;const ledger=read();ledger[active.key]={status:'snoozed',until:Date.now()+10*60000};write(ledger);active=null;nativeSignature='';syncNative();},
    complete(){if(!active)return;const e=active;active=null;complete(e.task.id);},
    start(){if(!active)return;const e=active;active=null;start(e.task.id);}
  };
}
