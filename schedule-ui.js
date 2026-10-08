import { copy, completeTaskModel, startTaskModel, isDaily, questText } from './schedule-domain.js';
import { scheduleEnd, scheduleStart } from './schedule-lifecycle.js';
export function createCompletionController({getData, saveData, message}) {
  const dialog=document.createElement('dialog');dialog.className='schedule-adjust-dialog';
  dialog.innerHTML=`<div class="schedule-adjust-shell"><div class="schedule-adjust-head"><h2>确认完成</h2><button type="button" class="done-close" aria-label="关闭">×</button></div><p class="done-title"></p><p class="done-note">时间到了不会自动算作完成。请确认本次进度。</p><div class="schedule-fields"><label>本次完成的工作量（分钟）<input class="done-minutes" type="number" min="0" max="480"></label><label>还需约（分钟）<input class="done-remaining" type="number" min="0" max="480"></label></div><p class="done-error" role="alert"></p><div class="schedule-adjust-actions"><button type="button" class="done-segment">完成本段</button><button type="button" class="done-all">全部完成</button></div></div>`;
  document.body.append(dialog);const $=(s)=>dialog.querySelector(s);let id=null,revision=0;
  $('.done-close').onclick=()=>dialog.close();
  $('.done-minutes').oninput=()=>{const t=getData().tasks.find((t)=>t.id===id);$('.done-remaining').value=Math.max(0,t.remainingMinutes-Number($('.done-minutes').value));};
  function finish(mode){
    const data=getData(),task=data.tasks.find((t)=>t.id===id);
    if(!task||data.revision!==revision){$('.done-error').textContent='日程已更新，请关闭并重新确认。';return;}
    const minutes=Number($('.done-minutes').value),remaining=Number($('.done-remaining').value);
    if(!Number.isFinite(minutes)||minutes<0||minutes>480||!Number.isFinite(remaining)||remaining<0||remaining>480){$('.done-error').textContent='请填写0–480分钟的有效工作量。';return;}
    const next=copy(data);next.tasks=next.tasks.map((t)=>t.id===id?completeTaskModel(t,{mode,minutes,remaining}):t);
    if(saveData(next,mode==='all'?'已确认全部完成。':'本段进度已记录；剩余工作可以继续安排。')!==false)dialog.close();
  }
  $('.done-segment').onclick=()=>finish('segment');$('.done-all').onclick=()=>finish('all');
  return {
    open(taskId){const data=getData(),task=data.tasks.find((t)=>t.id===taskId);if(!task||task.status!=='pending')return;
      if(isDaily(task)){const next=copy(data);next.tasks=next.tasks.map((t)=>t.id===taskId?completeTaskModel(t):t);saveData(next,'今天的每日任务已完成，明天会重新出现。');return;}
      id=taskId;revision=data.revision;$('.done-title').textContent=task.title;$('.done-error').textContent='';
      $('.done-minutes').value=task.plannedMinutes||task.estimateMinutes;$('.done-remaining').value=Math.max(0,task.remainingMinutes-(task.plannedMinutes||task.estimateMinutes));
      $('.schedule-fields').hidden=task.kind==='event';$('.done-segment').hidden=task.kind==='event';dialog.showModal();
    },
    start(taskId){const data=getData(),next=copy(data);next.tasks=next.tasks.map((t)=>t.id===taskId?startTaskModel(t):t);return saveData(next,'已开始这一段，原定安排会受到保护。');}
  };
}
export function busySummary(tasks, preferences, from, to) {
  const windows=[];let capacity=0,day=new Date(from);day.setHours(0,0,0,0);
  while(day.getTime()<to){let total=0;for(const[a,b]of preferences.windows){const start=new Date(day);start.setMinutes(a*60);const end=new Date(day);end.setMinutes(b*60);const x=Math.max(start.getTime(),from),y=Math.min(end.getTime(),to);if(y>x){windows.push([x,y]);total+=(y-x)/60000;}}capacity+=Math.min(total,preferences.maxMinutes);day.setDate(day.getDate()+1);}
  const intervals=tasks.filter((t)=>t.status==='pending'&&scheduleStart(t)!==null).map((t)=>[Math.max(from,scheduleStart(t)),Math.min(to,scheduleEnd(t))]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
  const merged=[];for(const x of intervals){const last=merged.at(-1);if(last&&x[0]<=last[1])last[1]=Math.max(last[1],x[1]);else merged.push([...x]);}
  const minutes=merged.reduce((sum,[a,b])=>sum+(b-a)/60000,0),buffer=tasks.filter((t)=>t.status==='pending'&&scheduleStart(t)>=from&&scheduleStart(t)<to&&t.kind==='task').length*preferences.bufferMinutes;
  capacity=Math.max(0,capacity-buffer);const level=minutes?capacity?Math.min(5,Math.ceil(minutes/capacity*5)):5:0;
  return {minutes,capacity,level,hours:Math.round(minutes/6)/10,unplanned:tasks.filter((t)=>t.status==='pending'&&!isDaily(t)&&!t.scheduledAt).length};
}
export function appendMangoes(host,summary){host.replaceChildren();const text=document.createElement('span');text.textContent=`预计工作 ${summary.hours} 小时`;host.append(text);if(summary.level){const strip=document.createElement('span');strip.className=`mango-strip level-${summary.level}`;strip.setAttribute('aria-label',`忙碌度${summary.level}/5`);strip.setAttribute('role','img');for(let i=0;i<summary.level;i++){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 28');svg.innerHTML='<path fill="#123353" d="M9 5h4l2-4 3 1-2 5c7 5 7 17-4 20C2 28-1 16 5 9z"/><path fill="currentColor" d="M9 8c-6 3-7 15 1 16 9 1 12-10 6-15-2-2-5-2-7-1z"/>';strip.append(svg);}host.append(strip);}}

export function foldDraftFields(card, draft) {
  const advanced=document.createElement('details');advanced.className='draft-advanced';advanced.open=Boolean(draft.expanded);
  const summary=document.createElement('summary');summary.textContent='更多：归属、重复、工作量与补录';advanced.append(summary);
  const grid=document.createElement('div');grid.className='draft-grid';advanced.append(grid);
  for(const label of [...card.querySelectorAll('label')]){
    const name=label.firstChild?.textContent||'';
    if(['长期归属','重复','紧急程度','旅程名称','旅程','优先级','预计分钟','记录状态','状态'].includes(name))grid.append(label);
  }
  advanced.addEventListener('toggle',()=>draft.expanded=advanced.open);card.append(advanced);
  if(draft.needsTimeConfirmation&&draft.deadlineTime){
    const label=document.createElement('label');label.className='time-confirmation';const check=document.createElement('input');check.type='checkbox';check.checked=Boolean(draft.timeConfirmed);check.onchange=()=>draft.timeConfirmed=check.checked;
    label.append(check,document.createTextNode('原文未说明截止钟点；我已核对推测的时间。'));card.append(label);
  }
}
