import { normalizeTask, setSession, clearSession, isProtected, isDaily, DEFAULT_PREFS } from './schedule-domain.js';
const DAY = 24 * 60 * 60 * 1000;
const weekdays = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const chineseNumbers = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const fixedWords = /面试|开会|会议|上课|考试|预约|聚餐|电话|看医生|复诊|高铁|航班|约见|见面/;

function numberOf(value) {
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value === '半') return 0.5;
  if (value.includes('十')) {
    const [tens, ones] = value.split('十');
    return (chineseNumbers[tens] || 1) * 10 + (chineseNumbers[ones] || 0);
  }
  return chineseNumbers[value] || 0;
}

function localDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function at(date, hours, minutes = 0) {
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function dateFromWords(text, now) {
  const date = at(now, 0);
  const absolute = text.match(/(\d{1,2})月(\d{1,2})[日号]?/);
  if (absolute) {
    const month = Number(absolute[1]) - 1;
    const day = Number(absolute[2]);
    const candidate = new Date(now.getFullYear(), month, day);
    if (candidate.getMonth() !== month || candidate.getDate() !== day) return null;
    if (candidate.getTime() < date.getTime() - DAY && !/刚才|之前|已经|过去|补录|正在|开始了|结束了|已完成/.test(text)) candidate.setFullYear(candidate.getFullYear() + 1);
    return candidate;
  }
  if (text.includes('大后天')) date.setDate(date.getDate() + 3);
  else if (text.includes('后天')) date.setDate(date.getDate() + 2);
  else if (text.includes('明天')) date.setDate(date.getDate() + 1);
  else if (/今天|今晚|今早|今晨|今夜|今下午|今上午|今中午/.test(text)) return date;
  else {
    const match = text.match(/(下周|本周|这周|周|星期)([一二三四五六日天])/);
    if (!match) return null;
    const current = (date.getDay() + 6) % 7 + 1;
    const target = weekdays[match[2]];
    let shift = target - current;
    if (match[1] === '下周') shift += 7;
    else if (['本周', '这周', '周', '星期'].includes(match[1])) {
      if (shift < 0) shift += 7;
    }
    date.setDate(date.getDate() + shift);
  }
  return date;
}

function timeFromWords(text) {
  const match = text.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2}|[一二两三四五六七八九十]+)(?:点|:|：)(半|\d{1,2})?/);
  if (!match) return null;
  let hour = numberOf(match[2]);
  let minute = match[3] === '半' ? 30 : Number(match[3] || 0);
  if (hour > 23 || minute > 59) return null;
  if (/下午|傍晚|晚上/.test(match[1] || '') && hour < 12) hour += 12;
  if (/凌晨|早上|上午/.test(match[1] || '') && hour === 12) hour = 0;
  if (match[1] === '中午' && hour < 11) hour += 12;
  return { hour, minute };
}

function durationFromWords(text) {
  const range = text.match(/(?:从)?(?:上午|下午|晚上|早上|凌晨)?\s*(\d{1,2})(?:点|:|：)(\d{1,2})?\s*(?:到|至|—|－|-)\s*(?:上午|下午|晚上|早上|凌晨)?\s*(\d{1,2})(?:点|:|：)(\d{1,2})?/);
  if (range) {
    const start = Number(range[1]) * 60 + Number(range[2] || 0);
    let end = Number(range[3]) * 60 + Number(range[4] || 0);
    if (end < start) end += 24 * 60;
    return Math.max(10, Math.min(end - start, 480));
  }
  const hour = text.match(/(?:(?:预计|持续|需要|大概|大约|约|花|用时|时长)\s*)?(\d+(?:\.\d+)?|[一二两三四五六七八九十]+|半)个?小时/);
  const minute = text.match(/(?:(?:预计|持续|需要|大概|大约|约|花|用时|时长)\s*)?(\d+|[一二两三四五六七八九十]+)分(?:钟)?(?!\d)/);
  if (!hour && !minute) return null;
  const value = (hour ? numberOf(hour[1]) * 60 : 0) + (minute ? numberOf(minute[1]) : 0);
  return Math.max(10, Math.min(value, 480));
}

export function summarizeTitle(fragment) {
  let title = String(fragment || '').trim();
  title = title.replace(/(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(?:\d{1,2}|[一二两三四五六七八九十]+)(?:点|[:：])(?:半|\d{1,2})?\s*(?:到|至|—|－|-)\s*(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(?:\d{1,2}|[一二两三四五六七八九十]+)(?:点|[:：])(?:半|\d{1,2})?/g, '');
  title = title.replace(/^(?:嗯|呃|那个|就是|然后|另外|还有|对了|顺便|我想|我还|我|记得|提醒我|帮我|麻烦|请)+[，,\s]*/g, '');
  title = title.replace(/(?:预计|大概|大约|约|需要|持续|用时|花费?)?\s*(?:\d+(?:\.\d+)?|[一二两三四五六七八九十半两]+)个?小时(?:\s*(?:\d+|[一二两三四五六七八九十]+)分(?:钟)?)?/g, '');
  title = title.replace(/(?:预计|大概|大约|约|需要|持续|用时|花费?)\s*(?:\d+|[一二两三四五六七八九十]+)分(?:钟)?/g, '');
  title = title.replace(/(?:从)?(?:今天|明天|后天|大后天|今晚|今早|今夜|本周|这周|下周|星期[一二三四五六日天]|周[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]?)?\s*(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*\d{1,2}(?:点|:|：)\d{0,2}(?:分|半)?\s*(?:到|至|—|－|-)\s*(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*\d{1,2}(?:点|:|：)\d{0,2}(?:分|半)?/g, '');
  title = title.replace(/(?:今天|明天|后天|大后天|今晚|今早|今夜|本周|这周|下周|星期[一二三四五六日天]|周[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]?)/g, '');
  title = title.replace(/(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(?:\d{1,2}|[一二两三四五六七八九十]+)(?:点|:|：)(?:半|\d{1,2})?(?:分)?(?:之前|以前|前|左右)?/g, '');
  title = title.replace(/^(?:凌晨|早上|上午|中午|下午|傍晚|晚上|之前|以前|前|左右)+/g, '');
  title = title.replace(/^(?:要|得|需要|必须|打算|准备去|去|把|将|给我|帮我|记得|提醒我)+/g, '');
  title = title.replace(/(?:还有个事|还有一件事|有个事|有一件事|这件事|这件事情)$/g, '');
  title = title.replace(/[，,]\s*(?:前)?(?:交稿|交付|提交|完成)(?:即可|就行|就好)?$/, '');
  title = title.replace(/^[，,。；;、\s]+|[，,。；;、\s]+$/g, '').replace(/\s{2,}/g, ' ');
  return !title || /^(?:个事|件事|有事|事|安排)$/.test(title) ? '补充具体事项' : title;
}

export function temporalFields(text, now = new Date()) {
  const range = text.match(/((?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(?:\d{1,2}|[一二两三四五六七八九十]+)(?:点|[:：])(?:半|\d{1,2})?)\s*(?:到|至|—|－|-)\s*((?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(?:\d{1,2}|[一二两三四五六七八九十]+)(?:点|[:：])(?:半|\d{1,2})?)/);
  const deadlineClause = text.match(/((?:(?:今天|今晚|明天|后天|本周|下周|周|星期)[一二三四五六日天]?|\d{1,2}月\d{1,2}[日号]?)[^，,。；;]*?(?:前|截止|交付|交稿))/)?.[0] || (/(?:点|[:：])[^，,。；;]*?(?:前|截止)/.test(text) ? text : '');
  const input = range ? text.slice(0,text.indexOf(range[0])+range[0].length) : deadlineClause ? text.replace(deadlineClause,'') : text;
  const toTime = (part, fallbackDate = null) => {
    const date = dateFromWords(part, now) || fallbackDate || at(now,0), clock = timeFromWords(part);
    if (!clock && !dateFromWords(part,now)) return '';
    const d=at(date,clock?.hour ?? 18,clock?.minute ?? 0);
    return `${localDate(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  let startTime='',endTime='',deadlineTime='',needsTimeConfirmation=false;
  if (range) {
    const date=dateFromWords(input,now)||at(now,0);
    startTime=toTime(range[1],date);
    const period=range[1].match(/凌晨|早上|上午|中午|下午|傍晚|晚上/)?.[0] || '';
    const endText=/凌晨|早上|上午|中午|下午|傍晚|晚上/.test(range[2])?range[2]:period+range[2];
    endTime=toTime(endText,date);
    if(new Date(endTime)<=new Date(startTime)){const d=new Date(endTime);d.setDate(d.getDate()+1);endTime=`${localDate(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
  } else if (timeFromWords(input)) startTime=toTime(input);
  if(deadlineClause){deadlineTime=toTime(deadlineClause);needsTimeConfirmation=!timeFromWords(deadlineClause);}
  if(!startTime&&!deadlineTime&&dateFromWords(text,now)){needsTimeConfirmation=true;}
  return {startTime,endTime,deadlineTime,needsTimeConfirmation,rangeText:range?.[0]||''};
}

export function parseCapture(raw, now = new Date()) {
  const prepared = String(raw).replace(/[，,](?=\s*(?:预计|大概|约)\s*(?:\d|[一二两三四五六七八九十半]))/g, ' ');
  const fragments = prepared.split(/[\n。；;]+/).flatMap((part) => part.split(/[，,](?=\s*(?:另外|然后|还要|还得|还需要))/)).map((x)=>x.trim()).filter(Boolean).slice(0,12);
  return fragments.map((fragment)=>{
    if(/不对|改到|改成/.test(fragment)) fragment=fragment.replace(/^.*?(?:不对[，,]?\s*|改到|改成)/,'');
    const fields=temporalFields(fragment,now);
    const fixed=fixedWords.test(fragment)&&Boolean(fields.startTime)&&! /回复|邮件|准备|整理|记录|复盘|修改|写|做|完成/.test(fragment);
    const rangeMinutes=fields.startTime&&fields.endTime?(new Date(fields.endTime)-new Date(fields.startTime))/60000:null;
    const explicitDuration=durationFromWords(fragment.replace(fields.rangeText,''));
    return {title:summarizeTitle(fragment),sourceText:fragment,kind:fixed?'event':'task',...fields,
      time:fixed?fields.startTime:fields.deadlineTime||fields.startTime,
      duration:explicitDuration||rangeMinutes||(fixed?60:45),
      inferred:!rangeMinutes&&!explicitDuration||fields.needsTimeConfirmation,
      recordState:/已经|已完成|结束了|刚才.*(?:完成|结束)/.test(fragment)?'completed':/正在|进行中|开始了/.test(fragment)?'ongoing':'future'};
  });
}
function windowsFor(day, prefs) { return prefs.windows.map(([from,to])=>[at(day,Math.floor(from),(from%1)*60),at(day,Math.floor(to),(to%1)*60)]); }
const overlap=(a,b,c,d)=>a<d&&c<b;
export function planTasks(input, now = new Date(), options = {}) {
  const prefs={...DEFAULT_PREFS,...options.preferences};
  const tasks=input.map((t)=>normalizeTask(t,now)).filter(Boolean),busy=[],dailyMinutes=new Map(),queue=[];
  const horizon=now.getTime()+72*3600000,replan=new Set(options.replanIds||[]);
  const addBusy=(t,start,end)=>{
    busy.push([start,end + (t.kind==='event'?0:prefs.bufferMinutes*60000)]);
    const day=new Date(start);day.setHours(0,0,0,0);
    while(day.getTime()<end){const next=new Date(day);next.setDate(next.getDate()+1);const minutes=Math.max(0,(Math.min(end,next.getTime())-Math.max(start,day.getTime()))/60000);const key=localDate(day);dailyMinutes.set(key,(dailyMinutes.get(key)||0)+minutes);day.setDate(day.getDate()+1);}
  };
  // Hard constraints are inserted before flexible confirmed slots.
  for(const task of tasks){
    if(task.status!=='pending'||isDaily(task))continue;
    const minutes=task.plannedMinutes||task.estimateMinutes;
    const anchor=task.kind==='event'?task.fixedAt:task.manualAt||task.scheduledAt;
    if(isProtected(task)||task.manualAt){
      if(anchor){setSession(task,anchor,minutes);addBusy(task,new Date(anchor).getTime(),new Date(task.scheduledEndAt).getTime());}
      else task.unplannedReason='请确认正在执行事项的时间';
    }
  }
  for(const task of tasks){
    if(task.status!=='pending'||isDaily(task)||isProtected(task)||task.manualAt)continue;
    if(task.deadline&&new Date(task.deadline)<now){task.unplannedReason='已超过截止，请补录完成、调整截止或取消';continue;}
    if(task.scheduledAt&&!replan.has(task.id)){
      const a=new Date(task.scheduledAt).getTime(),b=new Date(task.scheduledEndAt||a+task.plannedMinutes*60000).getTime();
      if(b<=now.getTime()||!busy.some(([c,d])=>overlap(a,b,c,d))){addBusy(task,a,b);continue;}
    }
    clearSession(task);task.plannedMinutes=Math.min(task.remainingMinutes||task.estimateMinutes,90);queue.push(task);
  }
  queue.sort((a,b)=>{
    const x=Number.isFinite(a.manualOrder)?a.manualOrder:Infinity,y=Number.isFinite(b.manualOrder)?b.manualOrder:Infinity;
    if(x!==y)return x<y?-1:1;
    const ad=a.deadline?new Date(a.deadline).getTime():Infinity,bd=b.deadline?new Date(b.deadline).getTime():Infinity;
    if(ad!==bd)return ad<bd?-1:1;
    return ({high:0,medium:1,auto:2,low:3})[a.priority]-({high:0,medium:1,auto:2,low:3})[b.priority]||a.createdAt.localeCompare(b.createdAt);
  });
  for(const task of queue){
    const minutes=task.plannedMinutes;
    for(let offset=0;offset<4&&!task.scheduledAt;offset++){
      const day=at(now,0);day.setDate(day.getDate()+offset);
      if((dailyMinutes.get(localDate(day))||0)+minutes>prefs.maxMinutes)continue;
      for(const [from,to]of windowsFor(day,prefs)){
        let cursor=Math.ceil(Math.max(from.getTime(),now.getTime(),task.notBefore?new Date(task.notBefore).getTime():0)/900000)*900000;
        while(cursor+minutes*60000<=to.getTime()){
          const end=cursor+minutes*60000;if(end>horizon||task.deadline&&end>new Date(task.deadline).getTime())break;
          const conflicts=busy.filter(([a,b])=>overlap(cursor,end,a,b));
          if(!conflicts.length){setSession(task,new Date(cursor),minutes);addBusy(task,cursor,end);task.unplannedReason=null;break;}
          cursor=Math.ceil(Math.max(...conflicts.map((x)=>x[1]))/900000)*900000;
        }
        if(task.scheduledAt)break;
      }
    }
    if(!task.scheduledAt)task.unplannedReason='未来72小时内容量不足或无法满足截止，请调整时间或工作量';
  }
  return tasks;
}
export function previewScheduleChange(before, proposed, now = new Date(), options={}) {
  const original=new Map(before.map((t)=>[t.id,t])),changed=[];
  for(const t of proposed){const old=original.get(t.id);if(!old)continue;
    if(isProtected(old)&&(t.manualAt!==old.manualAt||t.scheduledAt!==old.scheduledAt||t.scheduledEndAt!==old.scheduledEndAt||t.estimateMinutes!==old.estimateMinutes||t.fixedAt!==old.fixedAt)&&!options.allowProtectedIds?.includes(t.id))return {error:`“${old.title}”正在执行、固定或已锁定，需要先确认解除约束。`};
    if(t.manualOrder!==old.manualOrder||t.notBefore!==old.notBefore||t.deadline!==old.deadline||t.estimateMinutes!==old.estimateMinutes)changed.push(t.id);
  }
  const tasks=planTasks(proposed,now,{...options,replanIds:options.replanIds||changed});
  const occupied=tasks.filter((t)=>t.status==='pending'&&t.scheduledAt&&(isProtected(t)||t.manualAt)).map((t)=>({t,a:new Date(t.scheduledAt).getTime(),b:new Date(t.scheduledEndAt).getTime()})).filter((x)=>x.b>now.getTime());
  for(let i=0;i<occupied.length;i++)for(let j=i+1;j<occupied.length;j++)if(overlap(occupied[i].a,occupied[i].b,occupied[j].a,occupied[j].b))return {error:`“${occupied[i].t.title}”与“${occupied[j].t.title}”时间冲突，请调整其中一项。`};
  for(const x of occupied)if(x.t.deadline&&x.b>new Date(x.t.deadline).getTime())return {error:`“${x.t.title}”的执行结束超过硬截止。`};
  const changes=tasks.filter((t)=>{const old=original.get(t.id);return old&&(old.scheduledAt!==t.scheduledAt||old.scheduledEndAt!==t.scheduledEndAt||old.plannedMinutes!==t.plannedMinutes);}).map((task)=>({task,from:original.get(task.id).scheduledAt,to:task.scheduledAt,fromEnd:original.get(task.id).scheduledEndAt,toEnd:task.scheduledEndAt}));
  return {tasks,changes};
}

export function formatDateTime(value, options = {}) {
  if (!value) return '尚未指定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未指定';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, ...options }).format(date);
}

export function dayKey(value) { return localDate(new Date(value)); }
export function timeLabel(value) { return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)); }
