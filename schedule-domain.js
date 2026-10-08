// Shared task/session model. Legacy display aliases remain for existing views.
export const SCHEMA = 3;
export const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const copy = (value) => JSON.parse(JSON.stringify(value));
export const stamp = (value) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
export const localDay = (value = new Date()) => {
  const d = new Date(value), pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const DEFAULT_PREFS = { windows: [[9, 12], [13, 18], [19, 21]], maxMinutes: 240, bufferMinutes: 15, startLead: 15, endLead: 10, deadlineLead: 60 };
export function currentSession(task) { return (task.sessions || []).find((s) => ['planned', 'ongoing'].includes(s.status)) || null; }
export function isDaily(task) { return task.recurrence === 'daily' || task.questType === 'daily'; }
export function isUrgent(task, now = new Date()) {
  return task.status === 'pending' && !isDaily(task) && task.deadline && localDay(task.deadline) === localDay(now) && (task.urgency === 'urgent' || task.questType === 'adventure');
}
export function isProtected(task) { return task.kind === 'event' || task.locked || Boolean(task.actualStartAt) || currentSession(task)?.status === 'ongoing'; }
export function normalizeTask(raw, now = new Date()) {
  if (!raw || typeof raw.id !== 'string' || typeof raw.title !== 'string' || !['task', 'event'].includes(raw.kind) || !['pending', 'done', 'cancelled', 'archived'].includes(raw.status)) return null;
  const task = copy(raw);
  task.title = task.title.slice(0, 180);
  task.estimateMinutes = Math.max(10, Math.min(Number(task.estimateMinutes) || 45, 480));
  task.remainingMinutes = task.status === 'done' ? 0 : Math.max(0, Number.isFinite(Number(task.remainingMinutes)) && task.remainingMinutes !== null ? Number(task.remainingMinutes) : task.estimateMinutes);
  task.plannedMinutes = Math.max(10, Number(task.plannedMinutes) || (task.kind === 'event' ? task.estimateMinutes : Math.min(task.remainingMinutes || task.estimateMinutes, 90)));
  for (const key of ['deadline', 'fixedAt', 'scheduledAt', 'scheduledEndAt', 'manualAt', 'notBefore', 'actualStartAt', 'actualEndAt', 'completedAt']) task[key] = stamp(task[key]);
  task.createdAt = stamp(task.createdAt) || now.toISOString();
  task.priority = ['auto', 'high', 'medium', 'low'].includes(task.priority) ? task.priority : 'auto';
  task.questType = ['main', 'side', 'daily', 'normal', 'adventure'].includes(task.questType) ? task.questType : 'normal';
  task.recurrence = task.recurrence || (task.questType === 'daily' ? 'daily' : 'once');
  task.urgency = task.urgency || (task.questType === 'adventure' ? 'urgent' : 'normal');
  task.journeyKind = task.journeyKind || (['main', 'side'].includes(task.questType) ? task.questType : null);
  task.journeyId = typeof task.journeyId === 'string' ? task.journeyId : null;
  task.locked = Boolean(task.locked);
  task.dailyHistory = [...new Set((task.dailyHistory || (task.dailyLastCompleted ? [task.dailyLastCompleted] : [])).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))];
  task.sessions = Array.isArray(task.sessions) ? task.sessions.filter((s) => s && typeof s.id === 'string' && (s.status === 'completed' || stamp(s.plannedStart) && stamp(s.plannedEnd) && new Date(s.plannedEnd) > new Date(s.plannedStart))).map((s) => ({ ...s, plannedStart: stamp(s.plannedStart), plannedEnd: stamp(s.plannedEnd) })) : [];
  if (!task.sessions.length && (task.scheduledAt || task.fixedAt)) {
    const start = task.scheduledAt || task.fixedAt;
    const end = task.scheduledEndAt || new Date(new Date(start).getTime() + task.plannedMinutes * 60000).toISOString();
    task.sessions.push({ id: `legacy-${task.id}`, plannedStart: start, plannedEnd: end,
      status: task.status === 'done' ? 'completed' : task.actualStartAt ? 'ongoing' : 'planned', actualStart: task.actualStartAt,
      actualEnd: task.actualEndAt, confirmedAt: task.completedAt, legacy: true });
  }
  if (isDaily(task) && task.status === 'done') {
    if (task.completedAt && !task.dailyHistory.includes(localDay(task.completedAt))) task.dailyHistory.push(localDay(task.completedAt));
    task.status = 'pending'; task.remainingMinutes = task.estimateMinutes;
  }
  return task;
}
export function setSession(task, start, minutes, id = null) {
  const active = currentSession(task);
  const session = { ...(active || {}), id: id || active?.id || uid(), plannedStart: stamp(start),
    plannedEnd: new Date(new Date(start).getTime() + minutes * 60000).toISOString(), status: active?.status === 'ongoing' ? 'ongoing' : 'planned', locked: task.locked };
  if(active && (active.plannedStart !== session.plannedStart || active.plannedEnd !== session.plannedEnd)) session.planHistory = [...(active.planHistory || []), { start: active.plannedStart, end: active.plannedEnd, revisedAt: new Date().toISOString() }];
  task.sessions = (task.sessions || []).filter((s) => s.id !== session.id);
  task.sessions.push(session);
  task.scheduledAt = session.plannedStart; task.scheduledEndAt = session.plannedEnd; task.plannedMinutes = minutes;
  return task;
}
export function clearSession(task) {
  task.sessions = (task.sessions || []).map((s) => s.status === 'planned' ? { ...s, status: 'superseded', revisedAt: new Date().toISOString() } : s);
  task.scheduledAt = null; task.scheduledEndAt = null;
}
export function completeTaskModel(raw, { mode = 'segment', minutes, remaining, now = new Date() } = {}) {
  const task = normalizeTask(raw, now);
  if (!task || task.status !== 'pending') return task;
  if (isDaily(task)) {
    const day = localDay(now);
    task.dailyHistory = [...new Set([...task.dailyHistory, day])]; task.dailyLastCompleted = day; task.dailyLastSkipped = null;
    task.sessions.push({ id: uid(), instance: day, status: 'completed', plannedStart: now.toISOString(), plannedEnd: new Date(now.getTime() + task.estimateMinutes * 60000).toISOString(), actualStart: null, actualEnd: null, confirmedAt: now.toISOString() });
    return task;
  }
  const session = currentSession(task);
  const work = Math.max(0, Number(minutes ?? task.plannedMinutes ?? task.estimateMinutes));
  const left = mode === 'all' || task.kind === 'event' ? 0 : Math.max(0, remaining === undefined ? task.remainingMinutes - work : Number(remaining));
  if (session) Object.assign(session, { status: 'completed', confirmedAt: now.toISOString(), actualStart: task.actualStartAt || session.actualStart || null,
    actualEnd: task.actualStartAt ? now.toISOString() : null, confirmedWorkMinutes: work });
  else task.sessions.push({ id: uid(), status: 'completed', plannedStart: null, plannedEnd: null, actualStart: null, actualEnd: null, confirmedAt: now.toISOString(), confirmedWorkMinutes: work });
  task.remainingMinutes = left;
  task.actualStartAt = null; task.actualEndAt = null; task.manualAt = null;
  if (!left) { task.status = 'done'; task.completedAt = now.toISOString(); }
  else {
    task.progressStatus = 'partial'; task.scheduledAt = null; task.scheduledEndAt = null;
    task.notBefore = new Date(now.getTime() + 15 * 60000).toISOString(); task.unplannedReason = '本段已完成，请确认下一段的安排';
  }
  return task;
}
export function startTaskModel(raw, now = new Date()) {
  const task = normalizeTask(raw, now);
  if (!task || task.status !== 'pending' || task.actualStartAt) return task;
  task.actualStartAt = now.toISOString();
  if (!currentSession(task)) setSession(task, now, task.plannedMinutes);
  Object.assign(currentSession(task), { status: 'ongoing', actualStart: task.actualStartAt });
  return task;
}
export function questText(task, journeys = [], now = new Date()) {
  const journey = journeys.find((j) => j.id === task.journeyId);
  const parts = [];
  if (journey) parts.push(`${journey.kind === 'main' ? '主线' : '支线'} · ${journey.title}`);
  else if (task.journeyKind) parts.push(task.journeyKind === 'main' ? '主线' : '支线');
  if (isDaily(task)) parts.push('每日任务');
  if (isUrgent(task, now)) parts.push('奇遇任务');
  if (task.kind === 'event') parts.push('固定事项');
  return parts.join(' · ') || '短期任务';
}
export function chooseNext(tasks, now = new Date()) {
  const today = localDay(now), time = now.getTime();
  const eligible = tasks.filter((t) => t.status === 'pending' && (!isDaily(t) || !(t.dailyHistory || []).includes(today) && t.dailyLastSkipped !== today));
  const rank = (t) => {
    const start = new Date(t.scheduledAt || t.fixedAt || 0).getTime(), end = new Date(t.scheduledEndAt || 0).getTime();
    const cutoff = t.deadline ? new Date(t.deadline).getTime() : Infinity;
    const group = t.actualStartAt ? 0 : t.kind === 'event' && start <= time + 3600000 && end >= time ? 1 : cutoff <= time + 3 * 3600000 ? 2 : 3;
    return [group, cutoff, Number.isFinite(t.manualOrder) ? t.manualOrder : Infinity, ({high:0,medium:1,auto:2,low:3})[t.priority] ?? 2, start || Infinity, t.createdAt];
  };
  return eligible.filter((t) => t.kind !== 'event' || new Date(t.scheduledEndAt || t.fixedAt).getTime() >= time).sort((a,b) => {
    const x=rank(a),y=rank(b); for(let i=0;i<x.length;i++){ if(x[i]===y[i])continue; if(typeof x[i]==='string')return x[i].localeCompare(y[i]); return x[i]<y[i]?-1:1; } return 0;
  })[0] || null;
}
export function normalizeState(raw, now = new Date()) {
  if (Number(raw?.schemaVersion) > SCHEMA) throw new Error('数据来自更新版本，请先更新时序再导入。');
  if (raw && !Array.isArray(raw.tasks)) throw new Error('备份中的事项格式无效');
  const state = { ...(raw || {}), schemaVersion: SCHEMA, revision: Number(raw?.revision) || 0,
    tasks: (raw?.tasks || []).map((t) => normalizeTask(t, now)), journeys: raw?.journeys || [], captures: raw?.captures || [], deferredCaptures: raw?.deferredCaptures || [],
    reminders: raw?.reminders || {}, preferences: { ...DEFAULT_PREFS, ...(raw?.preferences || {}) }, quietReminders: raw?.quietReminders !== false,
    reminderMode: raw?.reminderMode === 'sound' ? 'sound' : 'visual', cloudAnalysis: raw?.cloudAnalysis !== false };
  if (!Array.isArray(state.preferences.windows) || !state.preferences.windows.length || state.preferences.windows.some(w => !Array.isArray(w) || w.length!==2 || !Number.isFinite(w[0]) || !Number.isFinite(w[1]) || w[0]<0 || w[1]>24 || w[1]<=w[0])) throw new Error('可用时段格式无效，请使用有效备份恢复。');
  for(const [key,min,max] of [['maxMinutes',30,1440],['bufferMinutes',0,120],['startLead',0,1440],['endLead',0,1440],['deadlineLead',0,10080]]) {
    if(!Number.isFinite(state.preferences[key])||state.preferences[key]<min||state.preferences[key]>max)throw new Error('规划偏好格式无效，请使用有效备份恢复。');
  }
  const windows=[...state.preferences.windows].sort((a,b)=>a[0]-b[0]);
  if(windows.some((w,i)=>i&&w[0]<windows[i-1][1]))throw new Error('可用时段不能重叠。');
  if (state.tasks.some((t) => !t)) throw new Error('备份含无效事项，请使用原备份恢复');
  if (!Array.isArray(state.journeys) || !Array.isArray(state.captures) || !Array.isArray(state.deferredCaptures)) throw new Error('备份格式无效');
  const seen = new Set(); state.tasks = state.tasks.filter((t) => !seen.has(t.id) && seen.add(t.id));
  for(const task of state.tasks) {
    if (!task.journeyId && task.journeyKind) {
      const title = /求职|面试|作品集|简历/.test(task.title) ? '找到合适的下一份工作' : task.title;
      let journey = state.journeys.find((j)=>j.title===title && j.kind===task.journeyKind);
      if (!journey) {journey={id:`legacy-journey-${task.id}`,title,kind:task.journeyKind,createdAt:task.createdAt};state.journeys.push(journey);}
      task.journeyId=journey.id;
    }
  }
  return state;
}
