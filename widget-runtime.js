import { parseCapture, summarizeTitle, planTasks, previewScheduleChange, dayKey } from "./planner.js";
import { recognizeWithDeepSeek } from "./deepseek.js?v=30";
import { createScheduleController } from "./schedule-controls.js?v=30";
import { scheduleEnd, scheduleEndLabel } from "./schedule-lifecycle.js";

import { readPlan, writePlan, notifyNative, KEY } from './plan-store.js';
import { normalizeState, isDaily, questText, chooseNext, copy } from './schedule-domain.js';
import { prepareDraft, taskFromDraft } from './capture-flow.js';
import { createCompletionController, busySummary, appendMangoes, foldDraftFields } from './schedule-ui.js';
import { createReminderController } from './reminder-controller.js';
import { installPlanSettings } from './plan-settings.js';
const $ = (selector) => document.querySelector(selector);
const native = Boolean(window.webkit?.messageHandlers?.rixu);
const labels = { main: "主线", side: "支线", daily: "每日任务", normal: "短期任务", adventure: "奇遇任务" };
const newId = () => String(crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random());
let drafts = [];
let reviewedProposal = null;
let captureText = "";
let busy = false;
let captureId = null; let currentData = null; let undo = null; let storageError = "";
const scheduleControls = createScheduleController({
  getTasks: () => load().tasks,
  onComplete: completeWidgetTask,
  getData: () => load(),
  saveTasks: (tasks, message) => {const data=load();data.tasks=tasks;return saveData(data,message);}

});

function load() {
  try{const data=readPlan();storageError='';currentData=data;return data;}
  catch(error){storageError='本机数据读取失败，原数据已保留。请在完整页面导出恢复副本。';return normalizeState(null);}
}
function active(task, now) {
  if (!task || task.status !== "pending") return false;
  const today = dayKey(now);
  if (task.questType === "daily" && (task.dailyHistory?.includes(today) || task.dailyLastCompleted === today || task.dailyLastSkipped === today)) return false;
  if (task.questType === "adventure" && task.deadline && new Date(task.deadline) < now) return false;
  return true;
}


function shortTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "待安排";
  const today = dayKey(new Date());
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const prefix = dayKey(date) === today ? "今天" : dayKey(date) === dayKey(tomorrow) ? "明天" : `${date.getMonth() + 1}/${date.getDate()}`;
  return `${prefix} ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)}`;
}

function render() {
  const now = new Date();
  const theme = localStorage.getItem("rixu.theme") || "auto";
  const day = theme === "day" || (theme !== "night" && now.getHours() >= 6 && now.getHours() < 18);
  document.body.dataset.theme = day ? "day" : "night";
  $("#skyIcon").textContent = day ? "☀️" : "🌙";
  $("#dateLabel").textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(now).replace("星期", "周")}`;
  const data = load();
  const tasks = data.tasks.filter((task) => active(task, now));
  const current = chooseNext(tasks,now);
  $("#currentHeading").textContent = current?.title || "从一件小事开始";
  $("#currentMeta").textContent = current ? `${questText(current,data.journeys)} · ${current.priority === "high" ? "高优先级" : current.priority === "medium" ? "中优先级" : "下一步"} · ${Number(current.plannedMinutes) || Number(current.estimateMinutes) || 45} 分钟` : "写下一件想推进的事。";
  $('#widgetCurrentStart').hidden=!current || Boolean(current.actualStartAt); $('#widgetCurrentComplete').hidden=!current;
  $('#widgetCurrentStart').onclick=()=>current&&completion.start(current.id); $('#widgetCurrentComplete').onclick=()=>current&&completeWidgetTask(current.id);
  const scheduleView = document.body.dataset.view === "schedule";
  const upcoming = tasks.filter((task) => task.scheduledAt && task.questType !== "daily" && new Date(task.scheduledAt).getTime() >= now.getTime() - 24 * 3600000 && new Date(task.scheduledAt).getTime() <= now.getTime() + (scheduleView ? 7 * 24 : 72) * 3600000)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const expanded = scheduleView || $('#widgetExpand72h').checked;
  if(!expanded){for(let i=upcoming.length-1;i>=0;i--)if(dayKey(upcoming[i].scheduledAt)!==dayKey(now))upcoming.splice(i,1);upcoming.splice(3);}
  $('#timelineHeading').textContent = scheduleView ? '未来七天已记录日程' : expanded ? '未来72小时' : '今天的近期安排';
  const from=new Date();from.setHours(0,0,0,0);appendMangoes($('#widgetWorkSummary'),busySummary(data.tasks,data.preferences,from.getTime(),expanded?Date.now()+72*3600000:from.getTime()+86400000));
  $("#timelineCount").textContent = `${upcoming.length} 项`;
  const list = $("#timelineList"); list.replaceChildren();
  if (!upcoming.length) {
    const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "近期还没有已安排的事项。"; list.append(empty);
  }
  for (const task of upcoming) {
    const row = document.createElement("div"); row.className = "timeline-row";
    const end = scheduleEnd(task);
    const time = document.createElement("span"); time.className = "timeline-time";
    time.textContent = shortTime(task.scheduledAt) + (end ? `\n至 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(end))}` : "");
    const detail = document.createElement("div");
    const title = document.createElement("div"); title.className = "timeline-title"; title.textContent = task.title;
    const meta = document.createElement("div"); meta.className = "timeline-meta"; meta.textContent = questText(task,data.journeys) + (task.remainingMinutes>task.plannedMinutes ? ` · 本段后仍需约 ${task.remainingMinutes-task.plannedMinutes} 分钟` : "") + (Number.isFinite(task.manualOrder) ? " · 手动排序" : "") + (task.deadline ? ` · 硬截止 ${shortTime(task.deadline)}` : "") + (task.actualStartAt ? " · 进行中" : task.locked ? " · 已锁定" : "");
    detail.append(title, meta); row.append(time, detail);
    scheduleControls.decorate(row, task);
    list.append(row);
  }
  if (document.body.dataset.view === "journey") renderJourneys(data);
  if (document.body.dataset.view === "inbox") renderInbox(data);
  if (document.body.dataset.view === "settings") renderSettings(data);
}

function saveData(data, message = '已保存。') {
  if(storageError){$('#captureMessage').textContent=storageError;return false;}
  try {const base=readPlan();const next=writePlan(data,data.revision);undo={data:base,revision:next.revision};currentData=next;notifyNative(next);render();$('#captureMessage').textContent=message;return true;}
  catch(error){$('#captureMessage').textContent=error.message || '保存失败，请保留输入。';return false;}
}
const completion=createCompletionController({getData:load,saveData});
function completeWidgetTask(id){completion.open(id);}
const reminders=createReminderController({getData:load,complete:completeWidgetTask,start:id=>completion.start(id),onError:message=>$('#captureMessage').textContent=message,
  show:due=>{
    $('#widgetReminderTitle').textContent=due.title+' · '+due.task.title;
    $('#widgetReminderText').textContent=due.recovered?'错过的提醒已合并，请查看进度。':due.minutes<=0?'时间已到，请确认状态。':`约 ${Math.ceil(due.minutes)} 分钟后${due.kind==='start'?'开始':due.kind==='deadline'?'截止':'本段结束'}`;
    const button=$('#widgetReminderComplete');button.hidden=false;button.textContent=due.kind==='start'?'开始':'确认进度';button.onclick=()=>{due.kind==='start'?reminders.start():reminders.complete();$('#widgetReminder').hidden=true;};
    $('#widgetReminder').hidden=false;
  }
});
function checkWidgetReminders(){reminders.tick();}
function miniButton(label, action) {
  const button = document.createElement("button"); button.type = "button"; button.textContent = label;
  button.addEventListener("click", action); return button;
}

function askDelete(message, action) {
  $("#widgetDeleteText").textContent = message;
  const confirm = $("#widgetDeleteConfirm");
  confirm.onclick = () => { $("#widgetDeleteDialog").close(); action(); };
  $("#widgetDeleteDialog").showModal();
}

function renderJourneys(data) {
  const host = $("#widgetJourneys"); host.replaceChildren();
  if (!data.journeys.length) host.textContent = "还没有长期旅程。可以在下方新建主线或支线。";
  for (const journey of data.journeys) {
    const tasks = data.tasks.filter((task) => task.journeyId === journey.id);
    const done = tasks.filter((task) => task.status === "done").length;
    const article = document.createElement("article");
    const title = document.createElement("strong"); title.textContent = `${journey.kind === "main" ? "⛰ 主线" : "🌱 支线"}｜${journey.title}`;
    const progress = document.createElement("p"); progress.textContent = `${done} / ${tasks.length} 个路标`;
    article.append(title, progress);
    for (const task of tasks) {
      const row = document.createElement("label"); row.className = "widget-milestone";
      const check = document.createElement("input"); check.type = "checkbox"; check.checked = task.status === "done";
      check.disabled=task.status==="done";check.addEventListener("change",()=>{check.checked=false;completeWidgetTask(task.id);});
      const text = document.createElement("span"); text.textContent = task.title; row.append(check, text); article.append(row);
    }
    const form = document.createElement("form"); form.className = "widget-inline-form";
    const input = document.createElement("input"); input.placeholder = "添加路标"; input.maxLength = 180; input.required = true;
    const submit = document.createElement("button"); submit.textContent = "添加"; form.append(input, submit);
    form.addEventListener("submit", (event) => { event.preventDefault(); const name = input.value.trim(); if (!name) return; const next = load(); const minutes = 45; next.tasks.push({ id: newId(), title: name, kind: "task", status: "pending", questType: journey.kind, journeyId: journey.id, priority: "auto", estimateMinutes: minutes, remainingMinutes: minutes, plannedMinutes: minutes, createdAt: new Date().toISOString(), deadline: null, fixedAt: null, notBefore: null, scheduledAt: null }); next.tasks = planTasks(next.tasks,new Date(),{preferences:next.preferences}); saveData(next); });
    article.append(form); host.append(article);
  }
}

function renderInbox(data) {
  const host = $("#widgetInbox"); host.replaceChildren();
  const pending = data.tasks.filter((task) => task.status === "pending");
  const deferred = data.deferredCaptures || [];
  if (!pending.length && !deferred.length) host.textContent = "收纳箱里暂时没有事项。";
  for (const task of pending) {
    const row = document.createElement("div"); row.className = "widget-inbox-row";
    const title = document.createElement("strong"); title.textContent = task.title;
    const info = document.createElement("small"); info.textContent = `${questText(task,data.journeys)} · ${task.scheduledAt ? shortTime(task.scheduledAt) : task.unplannedReason || "待安排"}`;
    row.append(title, info);
    row.append(miniButton("确认进度",()=>completeWidgetTask(task.id)));
    row.append(miniButton("调整", () => scheduleControls.openEdit(task.id)));
    row.append(miniButton("删除", () => askDelete(`删除“${task.title}”？`, () => { const next = load(); next.tasks = next.tasks.filter((item) => item.id !== task.id); saveData(next); })));
    host.append(row);
  }
  if (deferred.length) { const heading = document.createElement("h3"); heading.textContent = "稍后整理"; host.append(heading); }
  for (const capture of [...deferred].reverse()) {
    const row = document.createElement("div"); row.className = "widget-inbox-row";
    const text = document.createElement("p"); text.textContent = capture.text; row.append(text);
    row.append(miniButton("继续整理", () => { captureId=capture.id;$("#quickInput").value = capture.text; setView("today"); $("#quickInput").focus(); }));
    row.append(miniButton("删除", () => askDelete("删除这条未整理输入？", () => { const next = load(); next.deferredCaptures = next.deferredCaptures.filter((item) => item.id !== capture.id); saveData(next); })));
    host.append(row);
  }
}

function renderSettings(data) {
  $("#widgetTheme").value = localStorage.getItem("rixu.theme") || "auto";
  $("#widgetReminders").checked = data.quietReminders !== false;
  $("#widgetReminderMode").value = data.reminderMode === "sound" ? "sound" : "visual";
}

function setView(view) {
  document.body.dataset.view = view;
  for (const button of document.querySelectorAll("[data-widget-view]")) {
    if (button.dataset.widgetView === view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  render();
}

function inferQuest(text,kind,time,duration){return /每天|每日/.test(text)?'daily':/长期|半年|一年内/.test(text)?'main':'normal';}

async function organize(event) {
  event.preventDefault();
  const text = $("#quickInput").value.trim();
  if (!text || busy) return;
  drafts=[];
  busy = true; captureText = text; $('#organizeButton').disabled=true;
  if(!captureId){const data=load();captureId=newId();data.deferredCaptures.push({id:captureId,text,createdAt:new Date().toISOString()});if(!saveData(data,'原文已保存。')){busy=false;$('#organizeButton').disabled=false;captureId=null;return;}}
  $("#captureMessage").textContent = "正在识别时间、时长和任务归属…";
  if(captureId){const data=load(),record=data.deferredCaptures.find(c=>c.id===captureId);if(record&&record.text!==text){record.text=text;if(!saveData(data)){busy=false;$("#organizeButton").disabled=false;return;}}}
  let source = "智能";
  try {if(!load().cloudAnalysis)throw new Error("local"); drafts = await recognizeWithDeepSeek(text); }
  catch {
    source = "本地";
    drafts = parseCapture(text).map((item) => ({ ...item, questType: inferQuest(item.sourceText || item.title, item.kind, item.time, item.duration), priority: "auto" }));
  } finally { busy = false; $("#organizeButton").disabled = false; }
  drafts = drafts.map((draft) => prepareDraft(draft, load().journeys));
  if (!drafts.length) { $("#captureMessage").textContent = "没有识别出具体事项，请补充后重试。"; return; }
  $("#captureMessage").textContent = `${source}整理出 ${drafts.length} 件事，请在悬浮窗内确认。`;
  renderDrafts();
  $("#reviewDialog").showModal();
}

function field(grid, labelText, value, type, onChange, options = []) {
  const label = document.createElement("label"); label.textContent = labelText;
  if (type === "text" || type === "datetime-local" || type === "number") {
    const input = document.createElement("input"); input.type = type; input.value = value || "";
    if (type === "text") input.maxLength = labelText === "旅程" ? 80 : 180;
    if (type === "number") { input.min = "10"; input.max = "480"; input.step = "5"; }
    input.addEventListener("input", () => { onChange(input.value); renderPreview(); });
    label.append(input);
  } else {
    const select = document.createElement("select");
    for (const [key, name] of options) {
      const option = document.createElement("option"); option.value = key; option.textContent = name; select.append(option);
    }
    select.value = value;
    select.addEventListener("change", () => { onChange(select.value); renderPreview(); });
    label.append(select);
  }
  if (labelText === "事项" || labelText === "旅程") label.className = "wide";
  grid.append(label);
}

function renderDrafts() {
  const host = $("#draftList"); host.replaceChildren();
  $('#reviewDialog').classList.toggle('has-adventure',drafts.some(d=>d.urgency==='urgent'&&d.deadlineTime));
  $("#reviewHeading").textContent = drafts.some((item) => item.urgency === "urgent" && item.deadlineTime) ? "奇遇任务出现了" : "任务已整理好";
  $("#reviewSummary").textContent = `整理出 ${drafts.length} 件事 · 请核对时间和预计分钟`;
  drafts.forEach((draft, index) => {
    const card = document.createElement("div"); card.className = "draft-card";
    const head = document.createElement("div"); head.className = "draft-head";
    const title = document.createElement("strong"); title.textContent = `事项 ${index + 1}`;
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "移除";
    remove.addEventListener("click", () => { drafts.splice(index, 1); renderDrafts(); });
    head.append(title, remove); card.append(head);
    const grid = document.createElement("div"); grid.className = "draft-grid";
    field(grid, "事项", draft.title, "text", (value) => draft.title = value);
    field(grid, "类型", draft.kind, "select", (value) => { draft.kind = value; renderDrafts(); }, [["task", "可调整任务"], ["event", "固定事项"]]);
    field(grid, "长期归属", draft.journeyKind||'normal', "select", value=>draft.journeyKind=['main','side'].includes(value)?value:null, [['normal','无归属'],['main','主线'],['side','支线']]);
    field(grid,'重复',draft.recurrence,'select',value=>draft.recurrence=value,[['once','一次性'],['daily','每日']]);
    field(grid,'紧急程度',draft.urgency,'select',value=>draft.urgency=value,[['normal','普通'],['urgent','今天内紧急']]);
    field(grid,'执行／实际开始',draft.startTime,'datetime-local',value=>draft.startTime=value);
    field(grid,'执行／实际结束',draft.endTime,'datetime-local',value=>draft.endTime=value);
    field(grid,'硬截止（可空）',draft.deadlineTime,'datetime-local',value=>draft.deadlineTime=value);
    field(grid, "预计分钟", draft.duration, "number", (value) => draft.duration = value);
    field(grid, "优先级", draft.priority, "select", (value) => draft.priority = value, [["auto", "自动"], ["high", "高"], ["medium", "中"], ["low", "低"]]);
    field(grid, "状态", draft.recordState, "select", (value) => draft.recordState = value, [["future", "待进行"], ["ongoing", "正在进行"], ["completed", "已经结束"]]);
    field(grid, "旅程", draft.journeyName, "text", (value) => draft.journeyName = value);
    card.append(grid);
    if (draft.kind === "event") { const note = document.createElement("p"); note.className = "draft-note"; note.textContent = "开始、本段结束与硬截止分别记录。补录已结束事项请填实际起止。"; card.append(note); }
    if (draft.inferred) { const note = document.createElement("p"); note.className = "draft-note"; note.textContent = "部分信息是推测，请重点核对时间和时长。"; card.append(note); }
    foldDraftFields(card,draft);host.append(card);
  });
  $("#confirmButton").disabled = drafts.length === 0;
  renderPreview();
}

function findOrCreateJourney(data, title, kind) {
  const name = title.trim().slice(0, 80);
  let journey = data.journeys.find((item) => item.kind === kind && item.title === name);
  if (!journey) { journey = { id: newId(), title: name, kind, createdAt: new Date().toISOString() }; data.journeys.push(journey); }
  return journey;
}

function proposal(){
  const data=load(),before=data.tasks,additions=[];
  try{for(const draft of drafts){const journey=draft.journeyKind&&draft.journeyName?.trim()?findOrCreateJourney(data,draft.journeyName,draft.journeyKind):null;additions.push(taskFromDraft(draft,journey?.id));}}
  catch(error){return {error:error.message};}
  const result=previewScheduleChange(before,before.concat(additions),new Date(),{preferences:data.preferences});
  if(result.error)return result;data.tasks=result.tasks;return {data,additions,changes:result.changes.map(c=>({old:before.find(t=>t.id===c.task.id),next:c.task}))};
}

function renderPreview() {
  const host = $("#planPreview"); host.replaceChildren(); reviewedProposal=null;
  if (!drafts.length) { host.textContent = "没有待确认事项。"; return; }
  const result = proposal();
  if (result.error) { host.textContent = result.error; return; }
  reviewedProposal=result;
  for (const task of result.additions) {
    const planned = result.data.tasks.find((item) => item.id === task.id);
    const row = document.createElement("p"); row.textContent = `${task.title}：${planned?.scheduledAt ? shortTime(planned.scheduledAt)+"–"+shortTime(planned.scheduledEndAt) : task.status === "done" ? "已完成补录" : "待安排"}`;
    host.append(row);
    if(planned?.remainingMinutes>planned?.plannedMinutes){const note=document.createElement("p");note.textContent=`只安排本段 ${planned.plannedMinutes} 分钟；剩余 ${planned.remainingMinutes-planned.plannedMinutes} 分钟未安排，请核对截止前容量。`;host.append(note);}
  }
  for (const { old, next } of result.changes.filter(c=>c.old)) {
    const row = document.createElement("p"); row.className = "plan-change";
    row.textContent = `${old.title}：${old.scheduledAt ? shortTime(old.scheduledAt) : "待安排"} → ${next?.scheduledAt ? shortTime(next.scheduledAt) : "待安排"}`;
    host.append(row);
  }

}

function confirm() {
  if(!drafts.length)return;
  if(!reviewedProposal){renderPreview();return;}
  if(load().revision!==reviewedProposal.data.revision){renderPreview();$("#reviewMessage").textContent="日程已在其他窗口更新，请核对新的安排后再次确认。";return;}
  const result = reviewedProposal;
  if (result.error) { $("#reviewMessage").textContent = result.error; return; }
  result.data.captures = result.data.captures.concat({ id: captureId, text: captureText, createdAt: new Date().toISOString() });
  result.data.deferredCaptures=result.data.deferredCaptures.filter(c=>c.id!==captureId);
  if(!saveData(result.data,'已确认入列。'))return;
  drafts = []; captureText = ""; captureId=null; $("#quickInput").value = "";
  $("#reviewDialog").close();
  const unplanned = result.additions.filter((item) => item.status === "pending" && !result.data.tasks.find((task) => task.id === item.id)?.scheduledAt).length;
  $("#captureMessage").textContent = unplanned
    ? `已加入 ${result.additions.length} 件事，其中 ${unplanned} 件待安排，可在完整页面调整。`
    : `已加入 ${result.additions.length} 件事，时间轴已更新。`;
  if (native) window.webkit.messageHandlers.rixu.postMessage({ action: "dataChanged" });
  render();
}

function openFull() {
  if (native) window.webkit.messageHandlers.rixu.postMessage({ action: "openFull" });
  else location.href = "./index.html";
}

document.body.dataset.native = String(native);
$("#browserHint").hidden = native;
$("#openFullButton").addEventListener("click", openFull);
$("#collapseButton").addEventListener("click", () => { if (native) window.webkit.messageHandlers.rixu.postMessage({ action: "collapse" }); });
$("#quickForm").addEventListener("submit", organize);
$("#closeReviewButton").addEventListener("click", () => $("#reviewDialog").close());
$("#cancelButton").addEventListener("click", () => $("#reviewDialog").close());
$("#confirmButton").addEventListener("click", confirm);
$("#widgetDeleteCancel").addEventListener("click", () => $("#widgetDeleteDialog").close());
$('#widgetReminderDismiss').addEventListener('click',()=>{reminders.dismiss();$('#widgetReminder').hidden=true;});
$('#widgetReminderSnooze').addEventListener('click',()=>{reminders.snooze();$('#widgetReminder').hidden=true;});
$('#widgetExpand72h').addEventListener('change',render);
$('#widgetUndo').onclick=()=>{const current=load();if(!undo||current.revision!==undo.revision){$('#captureMessage').textContent='已有后续修改，无法安全撤销。';return;}if(saveData({...undo.data,revision:current.revision},'已撤销上一步。'))undo=null;};
$('#widgetDeleteCapture').onclick=()=>askDelete('删除这次未确认输入及草稿？',()=>{const data=load();data.deferredCaptures=data.deferredCaptures.filter(c=>c.id!==captureId);if(saveData(data)){drafts=[];captureText='';captureId=null;$('#quickInput').value='';$('#reviewDialog').close();}});
document.querySelectorAll("[data-widget-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.widgetView)));
$("#widgetJourneyForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.title.value.trim();
  if (!name) return;
  const data = load();
  if (data.journeys.some((item) => item.title === name && item.kind === form.elements.kind.value)) return;
  data.journeys.push({ id: newId(), title: name, kind: form.elements.kind.value, createdAt: new Date().toISOString() });
  form.reset(); saveData(data);
});
$("#widgetTheme").addEventListener("change", (event) => { localStorage.setItem("rixu.theme", event.target.value); if (native) window.webkit.messageHandlers.rixu.postMessage({ action: "dataChanged" }); render(); });
$("#widgetReminders").addEventListener("change", (event) => { const data = load(); data.quietReminders = event.target.checked; saveData(data); });
$("#widgetReminderMode").addEventListener("change", (event) => { const data = load(); data.reminderMode = event.target.value; saveData(data); });
window.addEventListener("storage", (event) => { if (event.key === KEY) render(); });
window.addEventListener("rixu:data-changed", render);
window.addEventListener("focus", () => { render(); checkWidgetReminders(); });
render(); checkWidgetReminders(); setInterval(() => { render(); checkWidgetReminders(); }, 30000);

installPlanSettings({host:$('#settingsView'),getData:load,saveData});
