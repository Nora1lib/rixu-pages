import { temporalFields, summarizeTitle } from './planner.js';
import { uid, stamp, normalizeTask, setSession, localDay } from './schedule-domain.js';
export function prepareDraft(raw, journeys = [], now = new Date()) {
  const source = raw.sourceText || raw.title || '', fields = temporalFields(source, now);
  const hasClock = /点|[:：]/.test(source);
  const duration = Math.max(10, Math.min(Number(raw.duration) || 45, 480));
  const recurring = raw.recurrence === 'daily' || /每天|每日/.test(source) || raw.questType === 'daily';
  const name = journeys.find((j)=> source.includes(j.title) || /求职|工作/.test(j.title)&&/面试|求职|作品集|简历/.test(source) || /学习/.test(j.title)&&/学习|论文|复习/.test(source) || /财务/.test(j.title)&&/预算|账单|财务/.test(source));
  const journeyKind = name?.kind || (['main','side'].includes(raw.questType)?raw.questType:null);
  const deadlineTime = fields.deadlineTime || raw.deadlineTime || (!hasClock && /截止|前交|前完成/.test(source) ? raw.time : '') || '';
  const startTime = fields.startTime || raw.startTime || (raw.kind==='event' ? raw.time : '') || '';
  const urgent = deadlineTime && localDay(deadlineTime)===localDay(now) && /必须|紧急|尽快|马上|截止|前/.test(source);
  return {...raw,id:raw.id||uid(),title:summarizeTitle(raw.title||source),sourceText:source,kind:raw.kind==='event'?'event':'task',
    startTime,endTime:fields.endTime||raw.endTime||'',deadlineTime,time:raw.kind==='event'?startTime:deadlineTime,
    duration,recurrence:recurring?'daily':'once',urgency:urgent?'urgent':'normal',journeyKind,journeyId:name?.id||null,
    journeyName:name?.title||raw.journeyName||'',journeySuggested:Boolean(name),
    questType:recurring?'daily':journeyKind|| (urgent?'adventure':'normal'),priority:raw.priority||'auto',
    recordState:raw.recordState||'future',needsTimeConfirmation:fields.needsTimeConfirmation||raw.needsTimeConfirmation,inferred:raw.inferred};
}
export function taskFromDraft(draft, journeyId = null, now = new Date()) {
  if(!draft.title?.trim()||draft.title==='补充具体事项')throw new Error('请填写具体要做的事，或删除这条草稿。');
  const start=stamp(draft.startTime),end=stamp(draft.endTime),deadline=stamp(draft.deadlineTime),minutes=Number(draft.duration);
  if(!Number.isFinite(minutes)||minutes<10||minutes>480)throw new Error('预计总耗时须为10–480分钟。');
  for(const key of ['startTime','endTime','deadlineTime'])if(draft[key]&&!stamp(draft[key]))throw new Error('请检查开始、结束和截止时间。');
  if(draft.needsTimeConfirmation && deadline && !draft.timeConfirmed) throw new Error('原文没有明确截止钟点，请核对后勾选确认，或清空截止时间。');
  if(draft.kind==='event'&&!start)throw new Error('固定事项需要确认开始时间。');
  if(end&&(!start||new Date(end)<=new Date(start)))throw new Error('执行结束必须晚于开始。');
  if(draft.recordState==='future'&&start&&new Date(start).getTime()<now.getTime()-60000)throw new Error('开始时间已过去，请选择进行中或已结束补录，或明确改期。');
  if(draft.recordState==='completed'&&(!start||!end))throw new Error('补录已结束事项时，请填写实际开始和结束。');
  if(draft.recordState==='ongoing'&&start&&new Date(start)>now)throw new Error('正在进行事项的实际开始不能在未来。');
  const duration=start&&end?(new Date(end)-new Date(start))/60000:Math.min(minutes,draft.kind==='event'?480:90);
  const task=normalizeTask({id:draft.id,title:draft.title.trim(),sourceText:draft.sourceText,kind:draft.kind,status:draft.recordState==='completed'?'done':'pending',
    estimateMinutes:minutes,remainingMinutes:draft.recordState==='completed'?0:minutes,plannedMinutes:duration,createdAt:now.toISOString(),deadline,
    fixedAt:draft.kind==='event'?start:null,manualAt:draft.kind==='task'?start:null,scheduledAt:start,scheduledEndAt:end,
    questType:draft.recurrence==='daily'?'daily':draft.journeyKind|| (draft.urgency==='urgent'?'adventure':'normal'),journeyId:journeyId||draft.journeyId,
    journeyKind:draft.journeyKind,urgency:draft.urgency,recurrence:draft.recurrence,priority:draft.priority,
    actualStartAt:draft.recordState==='ongoing'||draft.recordState==='completed'?start||now.toISOString():null,
    actualEndAt:draft.recordState==='completed'?end:null,completedAt:draft.recordState==='completed'?now.toISOString():null,
    locked:false,sessions:[],dailyHistory:[]},now);
  if(start){setSession(task,start,duration);const s=task.sessions.at(-1);s.status=draft.recordState==='completed'?'completed':draft.recordState==='ongoing'?'ongoing':'planned';s.actualStart=task.actualStartAt;s.actualEnd=task.actualEndAt;s.confirmedAt=task.completedAt;}
  if(draft.recordState==='ongoing'&&!start){setSession(task,now,duration);task.sessions.at(-1).status='ongoing';}
  return task;
}
