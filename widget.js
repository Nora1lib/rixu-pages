import { parseCapture, summarizeTitle, planTasks, dayKey } from "./planner.js";
import { recognizeWithDeepSeek } from "./deepseek.js";
import { renderScheduleView } from "./schedule-view.js";

const KEY = "rixu.web.v1";
const $ = (selector) => document.querySelector(selector);
const native = Boolean(window.webkit?.messageHandlers?.rixu);
const labels = { main: "主线", side: "支线", daily: "每日任务", normal: "短期任务", adventure: "奇遇任务" };
const newId = () => String(crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random());
let drafts = [];
let captureText = "";
let busy = false;

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.tasks)) return {
      ...data, tasks: data.tasks, journeys: Array.isArray(data.journeys) ? data.journeys : [],
      captures: Array.isArray(data.captures) ? data.captures : [],
      deferredCaptures: Array.isArray(data.deferredCaptures) ? data.deferredCaptures : []
    };
  } catch { /* Start with an empty device plan. */ }
  return { tasks: [], journeys: [], captures: [], deferredCaptures: [], quietReminders: true, reminderMode: "visual" };
}

function active(task, now) {
  if (!task || task.status !== "pending") return false;
  const today = dayKey(now);
  if (task.questType === "daily" && (task.dailyHistory?.includes(today) || task.dailyLastCompleted === today || task.dailyLastSkipped === today)) return false;
  if (task.questType === "adventure" && task.deadline && new Date(task.deadline) < now) return false;
  if (task.kind === "event" && task.fixedAt && new Date(task.fixedAt).getTime() + (Number(task.estimateMinutes) || 45) * 60000 < now.getTime()) return false;
  return true;
}

function score(task, now) {
  const time = task.scheduledAt || task.fixedAt ? new Date(task.scheduledAt || task.fixedAt).getTime() : Infinity;
  const deadline = task.deadline ? new Date(task.deadline).getTime() : Infinity;
  let value = task.priority === "high" ? 65 : task.priority === "medium" ? 30 : task.priority === "low" ? -20 : task.questType === "main" ? 30 : 0;
  if (deadline >= now && deadline - now <= 36 * 3600000) value += 70;
  if (deadline >= now && deadline - now <= 3 * 3600000) value += 45;
  if (task.questType === "adventure") value += 20;
  if (time <= now + 2 * 3600000) value += 45;
  else if (time <= now + 24 * 3600000) value += 20;
  if (task.questType === "daily") value += 6;
  if (task.kind === "event") value += time <= now + 3600000 && time + (Number(task.estimateMinutes) || 45) * 60000 >= now ? 130 : time <= now + 3 * 3600000 ? 75 : 0;
  return value;
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
  const day = now.getHours() >= 6 && now.getHours() < 18;
  document.body.dataset.theme = day ? "day" : "night";
  $("#skyIcon").textContent = day ? "☀️" : "🌙";
  $("#dateLabel").textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(now).replace("星期", "周")}`;
  const data = load();
  const tasks = data.tasks.filter((task) => active(task, now));
  const current = tasks.filter((task) => task.kind === "task" || task.fixedAt && new Date(task.fixedAt).getTime() + task.estimateMinutes * 60000 >= now.getTime())
    .sort((a, b) => score(b, now.getTime()) - score(a, now.getTime()))[0];
  $("#currentHeading").textContent = current?.title || "从一件小事开始";
  $("#currentMeta").textContent = current ? `${current.kind === "event" ? "固定事项" : labels[current.questType] || "短期任务"} · ${current.priority === "high" ? "高优先级" : current.priority === "medium" ? "中优先级" : "下一步"} · ${Number(current.plannedMinutes) || Number(current.estimateMinutes) || 45} 分钟` : "写下一件想推进的事。";
  const { explanation } = renderScheduleView({
    tasks: data.tasks, journeys: data.journeys,
    list: $("#scheduleList"), dailyList: $("#dailyList"), workSummary: $("#workSummary"),
    fullView: true, onDailyToggle: toggleDaily, now
  });
  $("#busyExplanation").textContent = explanation;
}

function toggleDaily(taskId) {
  const data = load();
  const task = data.tasks.find((item) => item.id === taskId && item.questType === "daily");
  if (!task) return;
  const today = dayKey(new Date());
  task.dailyHistory = Array.isArray(task.dailyHistory) ? task.dailyHistory : [];
  const done = task.dailyHistory.includes(today) || task.dailyLastCompleted === today;
  task.dailyHistory = done ? task.dailyHistory.filter((value) => value !== today) : [...new Set(task.dailyHistory.concat(today))].slice(-365);
  task.dailyLastCompleted = task.dailyHistory.includes(today) ? today : null;
  task.dailyLastSkipped = null;
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch { $("#captureMessage").textContent = "本机存储失败，请稍后再试。"; render(); return; }
  if (native) window.webkit.messageHandlers.rixu.postMessage({ action: "dataChanged" });
  render();
}

function inferQuest(text, kind, time, duration) {
  if (kind === "event") return "normal";
  if (/每天|每日|散步|打卡/.test(text)) return "daily";
  if (/长期|半年|一年内|求职|作品集|论文|考试准备/.test(text)) return "main";
  if (/财务|预算|储蓄|阅读计划/.test(text)) return "side";
  if (time && dayKey(new Date(time)) === dayKey(new Date()) && (/紧急|今晚|今天|尽快|马上|必须/.test(text) || Number(duration) <= 60)) return "adventure";
  return "normal";
}

function relatedJourney(title, journeys) {
  const clean = title.replace(/[，。\s·｜|]/g, "");
  return journeys.find((journey) => {
    const name = journey.title.replace(/[，。\s·｜|]/g, "");
    return name.length >= 2 && (clean.includes(name) || name.includes(clean));
  }) || null;
}

function normalizeDraft(draft, journeys) {
  const title = summarizeTitle(draft.title || draft.sourceText || "");
  const source = draft.sourceText || draft.title || "";
  const journey = relatedJourney(title, journeys);
  const questType = journey && draft.kind !== "event" && draft.questType !== "daily" ? journey.kind : draft.questType || inferQuest(source, draft.kind, draft.time, draft.duration);
  return { ...draft, title, sourceText: source, kind: draft.kind === "event" ? "event" : "task", questType,
    journeyName: journey?.title || draft.journeyName || (questType === "main" || questType === "side" ? title : ""),
    duration: Math.max(10, Math.min(Number(draft.duration) || 45, 480)), priority: draft.priority || "auto",
    recordState: draft.recordState || "future" };
}

async function organize(event) {
  event.preventDefault();
  const text = $("#quickInput").value.trim();
  if (!text || busy) return;
  busy = true; captureText = text; $("#organizeButton").disabled = true;
  $("#captureMessage").textContent = "正在识别时间、时长和任务归属…";
  let source = "智能";
  try { drafts = await recognizeWithDeepSeek(text); }
  catch {
    source = "本地";
    drafts = parseCapture(text).map((item) => ({ ...item, questType: inferQuest(item.sourceText || item.title, item.kind, item.time, item.duration), priority: "auto" }));
  } finally { busy = false; $("#organizeButton").disabled = false; }
  drafts = drafts.map((draft) => normalizeDraft(draft, load().journeys));
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
  $("#reviewHeading").textContent = drafts.some((item) => item.questType === "adventure") ? "奇遇任务出现了" : "任务已整理好";
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
    field(grid, "类型", draft.kind, "select", (value) => draft.kind = value, [["task", "可调整任务"], ["event", "固定事项"]]);
    field(grid, "归属", draft.questType, "select", (value) => draft.questType = value, [["adventure", "奇遇"], ["normal", "短期"], ["main", "主线"], ["side", "支线"], ["daily", "每日"]]);
    field(grid, "时间", draft.time, "datetime-local", (value) => draft.time = value);
    field(grid, "预计分钟", draft.duration, "number", (value) => draft.duration = value);
    field(grid, "优先级", draft.priority, "select", (value) => draft.priority = value, [["auto", "自动"], ["high", "高"], ["medium", "中"], ["low", "低"]]);
    field(grid, "状态", draft.recordState, "select", (value) => draft.recordState = value, [["future", "待进行"], ["ongoing", "正在进行"], ["completed", "已经结束"]]);
    field(grid, "旅程", draft.journeyName, "text", (value) => draft.journeyName = value);
    card.append(grid);
    if (draft.inferred) { const note = document.createElement("p"); note.className = "draft-note"; note.textContent = "部分信息是推测，请重点核对时间和时长。"; card.append(note); }
    host.append(card);
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

function proposal() {
  const data = load();
  const before = planTasks(data.tasks);
  const additions = [];
  for (const draft of drafts) {
    if (!draft.title?.trim() || draft.title.trim() === "补充具体事项") return { error: "请填写具体事项，或移除空白草稿。" };
    if (draft.kind === "event" && !draft.time) return { error: "固定事项需要填写日期和时间。" };
    const date = draft.time ? new Date(draft.time) : null;
    if (date && Number.isNaN(date.getTime())) return { error: "请检查日期和时间。" };
    if (draft.recordState === "future" && date && date.getTime() < Date.now() - 60000) return { error: "过去的时间请选“正在进行”或“已经结束”补录。" };
    const minutes = Math.max(10, Math.min(Number(draft.duration) || 45, 480));
    const kind = draft.kind === "event" ? "event" : "task";
    const questType = kind === "event" ? "normal" : draft.questType;
    const journey = ["main", "side"].includes(questType) ? findOrCreateJourney(data, draft.journeyName || draft.title, questType) : null;
    const time = date?.toISOString() || null;
    const recordState = draft.recordState || "future";
    additions.push({ id: newId(), title: draft.title.trim().slice(0, 180), kind,
      status: recordState === "completed" ? "done" : "pending", estimateMinutes: minutes, remainingMinutes: minutes,
      plannedMinutes: Math.min(minutes, 90), createdAt: new Date().toISOString(),
      deadline: kind === "task" && questType !== "daily" && recordState !== "ongoing" ? time : null,
      fixedAt: kind === "event" ? time : null, notBefore: null, scheduledAt: null,
      questType, journeyId: journey?.id || null, priority: draft.priority || "auto",
      actualStartAt: recordState === "ongoing" ? time || new Date().toISOString() : null,
      completedAt: recordState === "completed" ? time || new Date().toISOString() : null,
      dailyLastCompleted: null, dailyHistory: [], dailyLastSkipped: null });
  }
  const fixed = data.tasks.concat(additions).filter((item) => item.status === "pending" && item.kind === "event" && item.fixedAt && new Date(item.fixedAt).getTime() + item.estimateMinutes * 60000 > Date.now());
  for (let i = 0; i < fixed.length; i++) for (let j = i + 1; j < fixed.length; j++) {
    const a = fixed[i], b = fixed[j], at = new Date(a.fixedAt).getTime(), bt = new Date(b.fixedAt).getTime();
    if (at < bt + b.estimateMinutes * 60000 && bt < at + a.estimateMinutes * 60000) return { error: "固定事项时间冲突，请修改后再确认。" };
  }
  data.tasks = planTasks(data.tasks.concat(additions));
  const changes = before.map((old) => ({ old, next: data.tasks.find((item) => item.id === old.id) }))
    .filter(({ old, next }) => old.scheduledAt !== next?.scheduledAt);
  return { data, additions, changes };
}

function renderPreview() {
  const host = $("#planPreview"); host.replaceChildren();
  if (!drafts.length) { host.textContent = "没有待确认事项。"; return; }
  const result = proposal();
  if (result.error) { host.textContent = result.error; return; }
  for (const task of result.additions.slice(0, 3)) {
    const planned = result.data.tasks.find((item) => item.id === task.id);
    const row = document.createElement("p"); row.textContent = `${task.title}：${planned?.scheduledAt ? shortTime(planned.scheduledAt) : task.status === "done" ? "已完成补录" : "待安排（不会出现在时间轴）"}`;
    host.append(row);
  }
  for (const { old, next } of result.changes.slice(0, 2)) {
    const row = document.createElement("p"); row.className = "plan-change";
    row.textContent = `${old.title}：${old.scheduledAt ? shortTime(old.scheduledAt) : "待安排"} → ${next?.scheduledAt ? shortTime(next.scheduledAt) : "待安排"}`;
    host.append(row);
  }
  if (result.changes.length > 2) { const more = document.createElement("p"); more.textContent = `另有 ${result.changes.length - 2} 项安排调整`; host.append(more); }
}

function confirm() {
  const result = proposal();
  if (result.error) { $("#reviewMessage").textContent = result.error; return; }
  result.data.captures = result.data.captures.concat({ id: newId(), text: captureText, createdAt: new Date().toISOString() }).slice(-200);
  try { localStorage.setItem(KEY, JSON.stringify(result.data)); }
  catch { $("#reviewMessage").textContent = "本机存储失败，请保留输入并稍后再试。"; return; }
  drafts = []; captureText = ""; $("#quickInput").value = "";
  $("#reviewDialog").close();
  const unplanned = result.additions.filter((item) => item.status === "pending" && !result.data.tasks.find((task) => task.id === item.id)?.scheduledAt).length;
  $("#captureMessage").textContent = unplanned
    ? `已加入 ${result.additions.length} 件事，其中 ${unplanned} 件尚未排定时段；可在完整页面调整。`
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
$("#workSummary").addEventListener("click", () => { $("#busyExplanation").hidden = !$("#busyExplanation").hidden; });
window.addEventListener("storage", (event) => { if (event.key === KEY) render(); });
window.addEventListener("rixu:data-changed", render);
window.addEventListener("focus", render);
render(); setInterval(render, 30000);
