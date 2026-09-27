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
  title = title.replace(/^(?:嗯|呃|那个|就是|然后|另外|还有|对了|顺便|我想|我还|我|记得|提醒我|帮我|麻烦|请)+[，,\s]*/g, '');
  title = title.replace(/(?:预计|大概|大约|约|需要|持续|用时|花费?)?\s*(?:\d+(?:\.\d+)?|[一二两三四五六七八九十半两]+)个?小时(?:\s*(?:\d+|[一二两三四五六七八九十]+)分(?:钟)?)?/g, '');
  title = title.replace(/(?:预计|大概|大约|约|需要|持续|用时|花费?)\s*(?:\d+|[一二两三四五六七八九十]+)分(?:钟)?/g, '');
  title = title.replace(/(?:从)?(?:今天|明天|后天|大后天|今晚|今早|今夜|本周|这周|下周|星期[一二三四五六日天]|周[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]?)?\s*(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*\d{1,2}(?:点|:|：)\d{0,2}(?:分|半)?\s*(?:到|至|—|－|-)\s*(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*\d{1,2}(?:点|:|：)\d{0,2}(?:分|半)?/g, '');
  title = title.replace(/(?:今天|明天|后天|大后天|今晚|今早|今夜|本周|这周|下周|星期[一二三四五六日天]|周[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]?)/g, '');
  title = title.replace(/(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(?:\d{1,2}|[一二两三四五六七八九十]+)(?:点|:|：)(?:半|\d{1,2})?(?:分)?(?:之前|以前|前|左右)?/g, '');
  title = title.replace(/^(?:凌晨|早上|上午|中午|下午|傍晚|晚上|之前|以前|前|左右)+/g, '');
  title = title.replace(/^(?:要|得|需要|必须|打算|准备去|去|把|将|给我|帮我|记得|提醒我)+/g, '');
  title = title.replace(/(?:还有个事|还有一件事|有个事|有一件事|这件事|这件事情)$/g, '');
  title = title.replace(/^[，,。；;、\s]+|[，,。；;、\s]+$/g, '').replace(/\s{2,}/g, ' ');
  return !title || /^(?:个事|件事|有事|事|安排)$/.test(title) ? '补充具体事项' : title;
}

export function parseCapture(raw, now = new Date()) {
  const prepared = raw.replace(/[，,](?=\s*(?:预计|大概|约)\s*(?:\d|[一二两三四五六七八九十半]))/g, ' ');
  const fragments = prepared.split(/[\n。；;]+/).flatMap((part) =>
    part.split(/[，,](?=\s*(?:另外|然后|还要|还得|还需要|明天|后天|今天|今晚|下周|本周|周[一二三四五六日天]))/)
  ).map((item) => item.trim()).filter(Boolean).slice(0, 12);
  const actionable = fragments.filter((item) => !/^(我)?(好焦虑|有点焦虑|很乱|不知道怎么办|压力好大|好烦|害怕|有点不知道先做哪个)$/.test(item));
  if (!actionable.length) return [{ title: '写下一件最担心的具体事项', kind: 'task', time: '', duration: 10, inferred: true }];
  return actionable.map((fragment) => {
    const date = dateFromWords(fragment, now);
    const time = timeFromWords(fragment);
    const fixed = fixedWords.test(fragment) && Boolean(date || time) && !/回复|邮件|准备|整理|记录|复盘|修改|写|做|完成/.test(fragment);
    let when = date;
    if (!when && time) {
      when = at(now, 0);
      if (at(when, time.hour, time.minute) < now && !/刚才|之前|已经|过去|补录|正在|开始了|结束了/.test(fragment)) when.setDate(when.getDate() + 1);
    }
    if (when) {
      const defaultHour = fixed ? 9 : 18;
      when = at(when, time?.hour ?? defaultHour, time?.minute ?? 0);
    }
    const duration = durationFromWords(fragment);
    const title = summarizeTitle(fragment);
    return {
      title,
      sourceText: fragment,
      kind: fixed ? 'event' : 'task',
      time: when ? `${localDate(when)}T${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}` : '',
      duration: duration || (fixed ? 60 : 45),
      inferred: !date || !duration || (!time && fixed) || title === '补充具体事项',
    };
  });
}

function windowsFor(day) {
  return [[9, 0, 12, 0], [13, 0, 18, 0], [19, 0, 21, 0]].map(([h1, m1, h2, m2]) => [at(day, h1, m1), at(day, h2, m2)]);
}

function overlap(start, end, busyStart, busyEnd) {
  return start < busyEnd && end > busyStart;
}

export function planTasks(input, now = new Date()) {
  const tasks = input.map((item) => ({ ...item }));
  const horizon = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  const busy = [];
  for (const task of tasks) {
    if (task.status !== 'pending' || task.questType === 'daily' || (task.kind === 'task' && task.deadline && new Date(task.deadline) < now)) {
      task.scheduledAt = null; continue;
    }
    if (task.kind === 'event' && task.fixedAt) {
      task.scheduledAt = task.fixedAt;
      task.plannedMinutes = task.estimateMinutes;
      const start = new Date(task.fixedAt);
      busy.push([start, new Date(start.getTime() + task.estimateMinutes * 60000)]);
    } else {
      task.scheduledAt = null;
      task.plannedMinutes = Math.min(task.remainingMinutes || task.estimateMinutes, 90);
    }
  }
  const flexible = tasks.filter((item) => item.status === 'pending' && item.kind === 'task' && item.questType !== 'daily' && (!item.deadline || new Date(item.deadline) >= now));
  flexible.sort((a, b) => {
    const aa = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const bb = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    const priority = (task) => task.priority === 'high' ? 0 : task.priority === 'medium' ? 1 : task.priority === 'low' ? 3 : task.questType === 'main' ? 0 : task.questType === 'side' ? 1 : 2;
    return aa - bb || priority(a) - priority(b) || a.createdAt.localeCompare(b.createdAt);
  });
  const dailyMinutes = new Map();
  for (const task of flexible) {
    const minutes = task.plannedMinutes;
    for (let offset = 0; offset < 4 && !task.scheduledAt; offset++) {
      const day = at(now, 0); day.setDate(day.getDate() + offset);
      const key = localDate(day);
      if ((dailyMinutes.get(key) || 0) + minutes > 240) continue;
      for (const [windowStart, windowEnd] of windowsFor(day)) {
        let cursor = new Date(Math.max(windowStart.getTime(), now.getTime(), task.notBefore ? new Date(task.notBefore).getTime() : 0));
        cursor = new Date(Math.ceil(cursor.getTime() / 900000) * 900000);
        while (cursor.getTime() + minutes * 60000 <= windowEnd.getTime()) {
          const end = new Date(cursor.getTime() + minutes * 60000);
          if (end > horizon || (task.deadline && end > new Date(task.deadline))) break;
          const conflict = busy.find(([from, to]) => overlap(cursor, end, from, to));
          if (!conflict) {
            task.scheduledAt = cursor.toISOString();
            dailyMinutes.set(key, (dailyMinutes.get(key) || 0) + minutes);
            busy.push([cursor, new Date(end.getTime() + 15 * 60000)]);
            break;
          }
          cursor = new Date(Math.ceil(conflict[1].getTime() / 900000) * 900000);
        }
        if (task.scheduledAt) break;
      }
    }
  }
  return tasks;
}

export function formatDateTime(value, options = {}) {
  if (!value) return '尚未指定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未指定';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, ...options }).format(date);
}

export function dayKey(value) { return localDate(new Date(value)); }
export function timeLabel(value) { return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)); }
