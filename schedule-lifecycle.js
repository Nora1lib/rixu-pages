import { currentSession, isDaily, stamp } from './schedule-domain.js';
export function scheduleStart(task) { const value=currentSession(task)?.plannedStart || task.scheduledAt || task.fixedAt; return value ? new Date(value).getTime() : null; }
export function scheduleEnd(task) {
  const value=currentSession(task)?.plannedEnd||task.scheduledEndAt;
  if(value)return new Date(value).getTime();
  const start=scheduleStart(task);return start===null?null:start+(Number(task.plannedMinutes)||Number(task.estimateMinutes)||45)*60000;
}
export const scheduleEndLabel=(task)=>task.kind==='event'?'结束':'本段结束';
export function reminderEvents(tasks, preferences = {}, now = Date.now()) {
  const events=[];
  for(const task of tasks){
    if(task.status!=='pending'||isDaily(task))continue;
    const start=scheduleStart(task),end=scheduleEnd(task),deadline=stamp(task.deadline),session=currentSession(task);
    const add=(kind,time,lead)=>{if(!Number.isFinite(time))return; const key=`${task.id}:${kind==='deadline'?'task':session?.id||'task'}:${kind}:${time}`;events.push({task,kind,time,triggerAt:time-lead*60000,key});};
    if(!task.actualStartAt)add('start',start,Number(preferences.startLead??15));
    add('end',end,Number(preferences.endLead??10));
    if(deadline)add('deadline',new Date(deadline).getTime(),Number(preferences.deadlineLead??Math.max(60,Math.min(Number(task.remainingMinutes)||60,1440))));
  }
  return events.sort((a,b)=>a.triggerAt-b.triggerAt);
}
export function nextScheduleReminder(tasks, seen, now = Date.now(), preferences={}) {
  return reminderEvents(tasks,preferences,now).filter((e)=>!seen.has(e.key)&&e.triggerAt<=now&&e.time>=now-5*60000).map((e)=>({...e,minutes:(e.time-now)/60000}))[0]||null;
}
export function reminderTitle(kind) {return kind==='start'?'日程即将开始':kind==='deadline'?'任务即将截止':'本段时间即将结束';}
