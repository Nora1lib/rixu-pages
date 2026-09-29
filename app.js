import { parseCapture, summarizeTitle, planTasks, previewScheduleChange, formatDateTime, dayKey, timeLabel } from "./planner.js";
import { scheduleEnd, scheduleEndLabel, nextScheduleReminder } from "./schedule-lifecycle.js";
import { recognizeWithDeepSeek } from "./deepseek.js?v=24";
import { createScheduleController } from "./schedule-controls.js?v=24";

const $ = (selector) => document.querySelector(selector);
const KEY = "rixu.web.v1";
const clone = (value) => JSON.parse(JSON.stringify(value));
const newId = () => crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random();
const defaults = () => ({ tasks: [], journeys: [], captures: [], deferredCaptures: [], quietReminders: true, reminderMode: "visual" });
const dateValue = (value) => value && !Number.isNaN(new Date(value).getTime()) ? value : null;
const make = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
};
const questLabels = { main: "主线", side: "支线", daily: "每日", normal: "短期任务", adventure: "奇遇任务" };
const journeyHints = [
  ["工作", /求职|面试|简历|作品集|投递|招聘/], ["求职", /求职|面试|简历|作品集|投递|招聘/],
  ["财务", /财务|预算|账单|存钱|储蓄|理财/],
  ["学习", /学习|课程|复习|考试|论文|作业/], ["健康", /健康|运动|健身|跑步|体检/]
];
function relatedJourney(title) {
  const clean = title.replace(/[，。\s·｜|]/g, "");
  return state.journeys.map((journey) => {
    const name = journey.title.replace(/[，。\s·｜|]/g, "");
    const words = name.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    const direct = name.length >= 2 && (clean.includes(name) || words.some((word) => word.length >= 2 && clean.includes(word)));
    const thematic = journeyHints.some(([hint, pattern]) => name.includes(hint) && pattern.test(clean));
    return { journey, score: direct ? 2 : thematic ? 1 : 0 };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score)[0]?.journey || null;
}
function inferredQuest(title, kind, time = "", duration = 45, now = new Date()) {
  if (kind === "event") return "normal";
  if (/每天|每日|散步|运动|冥想|打卡/.test(title)) return "daily";
  if (/求职|作品集|面试准备|论文|考试准备|转行|学习计划/.test(title)) return "main";
  if (/财务|预算|储蓄|副业|整理房间|阅读计划/.test(title)) return "side";
  if (/长期|接下来几个月|未来几个月|半年|一年内|长期推进|持续推进/.test(title)) return "main";
  if (time && dayKey(new Date(time)) === dayKey(now) && (/紧急|尽快|马上|今晚|今天|必须/.test(title) || Number(duration) <= 60)) return "adventure";
  return "normal";
}
function isExpiredAdventure(task) { return task.kind === "task" && task.questType === "adventure" && task.status === "pending" && task.deadline && new Date(task.deadline).getTime() < Date.now(); }
function isAdventure(task) {
  const deadline = task.deadline && new Date(task.deadline).getTime();
  return task.kind === "task" && task.questType === "adventure" && task.status === "pending" && deadline && deadline >= Date.now();
}
function priorityOf(task) {
  if (task.priority && task.priority !== "auto") return ({ high: "高优先级", medium: "中优先级", low: "低优先级" })[task.priority];
  return isAdventure(task) || task.questType === "main" ? "高优先级" : task.questType === "side" ? "中优先级" : "常规优先级";
}
function questOf(task) {
  if (task.kind === "event") return "固定事项";
  const journey = state.journeys.find((item) => item.id === task.journeyId);
  return journey ? questLabels[journey.kind] + " · " + journey.title : (questLabels[task.questType] || questLabels.normal);
}
function isDailyDone(task) { return task.questType === "daily" && (task.dailyHistory?.includes(dayKey(new Date())) || task.dailyLastCompleted === dayKey(new Date())); }
function isDailySkipped(task) { return task.questType === "daily" && task.dailyLastSkipped === dayKey(new Date()); }
function inferredJourneyTitle(title, kind) {
  if (kind === "main" && /求职|面试|作品集|投递|简历/.test(title)) return "找到合适的下一份工作";
  if (kind === "side" && /财务|预算|储蓄/.test(title)) return "整理个人财务";
  return title;
}
function setTheme() {
  const pref = localStorage.getItem("rixu.theme") || "auto";
  const hour = new Date().getHours();
  const theme = pref === "auto" ? (hour >= 6 && hour < 18 ? "day" : "night") : pref;
  document.body.dataset.theme = theme;
  $("#dateSkyIcon").textContent = theme === "day" ? "☀️" : "🌙";
  $("#themeSelect").value = pref;
}
function normalize(item) {
  if (!item || typeof item.id !== "string" || typeof item.title !== "string" ||
      !["task", "event"].includes(item.kind) || !["pending", "done"].includes(item.status)) return null;
  const minutes = Math.max(10, Math.min(Number(item.estimateMinutes) || 45, 480));
  return {
    id: item.id, title: item.title.slice(0, 180), kind: item.kind, status: item.status,
    estimateMinutes: minutes, remainingMinutes: Math.max(0, Number(item.remainingMinutes) || minutes),
    plannedMinutes: Math.max(10, Math.min(Number(item.plannedMinutes) || minutes, 90)),
    createdAt: dateValue(item.createdAt) || new Date().toISOString(),
    deadline: dateValue(item.deadline), fixedAt: dateValue(item.fixedAt),
    actualStartAt: dateValue(item.actualStartAt), completedAt: dateValue(item.completedAt),
    notBefore: dateValue(item.notBefore), scheduledAt: dateValue(item.scheduledAt),
    manualAt: dateValue(item.manualAt), manualOrder: Number.isFinite(item.manualOrder) ? item.manualOrder : null,
    questType: ["main", "side", "daily", "normal", "adventure"].includes(item.questType) ? item.questType : inferredQuest(item.title, item.kind),
    journeyId: typeof item.journeyId === "string" ? item.journeyId : null,
    priority: ["auto", "high", "medium", "low"].includes(item.priority) ? item.priority : "auto",
    dailyLastCompleted: /^\d{4}-\d{2}-\d{2}$/.test(item.dailyLastCompleted || "") ? item.dailyLastCompleted : null,
    dailyHistory: Array.isArray(item.dailyHistory) ? [...new Set(item.dailyHistory.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))].slice(-365) : item.dailyLastCompleted ? [item.dailyLastCompleted] : [],
    dailyLastSkipped: /^\d{4}-\d{2}-\d{2}$/.test(item.dailyLastSkipped || "") ? item.dailyLastSkipped : null
  };
}
function normalizeJourney(item) {
  if (!item || typeof item.id !== "string" || typeof item.title !== "string" || !["main", "side"].includes(item.kind)) return null;
  return { id: item.id, title: item.title.slice(0, 80), kind: item.kind, createdAt: dateValue(item.createdAt) || new Date().toISOString() };
}
function normalizeCapture(item) {
  if (!item || typeof item.text !== "string" || !item.text.trim()) return null;
  return { id: typeof item.id === "string" ? item.id : String(newId()),
    text: item.text.slice(0, 4000), createdAt: dateValue(item.createdAt) || new Date().toISOString() };
}
function ensureLegacyJourneys(data) {
  for (const task of data.tasks) {
    if (task.questType === "daily" && task.status === "done") { task.status = "pending"; task.dailyLastCompleted ||= dayKey(new Date()); }
    if (!["main", "side"].includes(task.questType) || task.journeyId) continue;
    const title = inferredJourneyTitle(task.title, task.questType);
    let journey = data.journeys.find((item) => item.kind === task.questType && item.title === title);
    if (!journey) { journey = { id: "legacy-" + task.id, title, kind: task.questType, createdAt: task.createdAt }; data.journeys.push(journey); }
    task.journeyId = journey.id;
  }
  return data;
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw || !Array.isArray(raw.tasks)) return defaults();
    const tasks = raw.tasks.map(normalize).filter(Boolean);
    const journeys = Array.isArray(raw.journeys) ? raw.journeys.map(normalizeJourney).filter(Boolean) : [];
    return ensureLegacyJourneys({ tasks, journeys,
      captures: Array.isArray(raw.captures) ? raw.captures.map(normalizeCapture).filter(Boolean).slice(-200) : [],
      deferredCaptures: Array.isArray(raw.deferredCaptures) ? raw.deferredCaptures.map(normalizeCapture).filter(Boolean).slice(-100) : [],
      quietReminders: raw.quietReminders !== false, reminderMode: raw.reminderMode === "sound" ? "sound" : "visual" });
  } catch { return defaults(); }
}
let state = load();
let drafts = [];
let undo = null;
let proposed = null;
let captureText = "";
let captureDeferredId = null;
let captureBusy = false;
let toastTimer;
let activeEditId = null;
let activeMilestoneJourneyId = null;
let focusTaskId = null;
let focusSeconds = 0;
let focusEndAt = null;
let focusTimer = null;
const reminded = new Set();
const scheduleControls = createScheduleController({
  getTasks: () => state.tasks,
  saveTasks: (tasks, message) => commit({ ...state, tasks }, message, true),
  onComplete: completeTask
});
function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  if (window.webkit?.messageHandlers?.rixu) window.webkit.messageHandlers.rixu.postMessage({ action: "dataChanged" });
}
function toast(message) {
  const node = $("#toast");
  node.textContent = message; node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.hidden = true, 4200);
}
function commit(next, message, preservePlan = false) {
  undo = clone(state);
  state = { tasks: preservePlan ? next.tasks : planTasks(next.tasks), journeys: next.journeys || [], captures: next.captures || [],
    deferredCaptures: next.deferredCaptures || [], quietReminders: next.quietReminders, reminderMode: next.reminderMode || "visual" };
  save(); render(); toast(message);
}
function findOrCreateJourney(next, title, kind) {
  const clean = title.trim().slice(0, 80);
  let journey = next.journeys.find((item) => item.title === clean && item.kind === kind);
  if (!journey) {
    journey = { id: String(newId()), title: clean, kind, createdAt: new Date().toISOString() };
    next.journeys.push(journey);
  }
  return journey;
}
function button(text, action, taskId) {
  const node = make("button", "", text);
  node.type = "button";
  node.addEventListener("click", () => action(taskId));
  return node;
}
function activeTasks() { return state.tasks.filter((task) => task.status === "pending" && !isExpiredAdventure(task) && !isDailyDone(task) && !isDailySkipped(task)); }
function nextScore(task) {
  const scheduled = task.scheduledAt || task.fixedAt ? new Date(task.scheduledAt || task.fixedAt).getTime() : Infinity;
  const deadline = task.deadline ? new Date(task.deadline).getTime() : Infinity;
  let score = task.priority === "high" ? 65 : task.priority === "medium" ? 30 : task.priority === "low" ? -20 : task.questType === "main" ? 30 : 0;
  if (deadline >= Date.now() && deadline - Date.now() <= 36 * 3600000) score += 70;
  if (deadline >= Date.now() && deadline - Date.now() <= 3 * 3600000) score += 45;
  if (task.questType === "adventure") score += 20;
  if (scheduled <= Date.now() + 2 * 3600000) score += 45;
  else if (scheduled <= Date.now() + 24 * 3600000) score += 20;
  if (task.questType === "daily") score += 6;
  if (task.kind === "event") score += scheduled <= Date.now() + 60 * 60000 && scheduled + task.estimateMinutes * 60000 >= Date.now() ? 130 : scheduled <= Date.now() + 3 * 3600000 ? 75 : 0;
  return score;
}
function renderNext() {
  const task = activeTasks().filter((item) => item.kind === "task" || item.fixedAt && new Date(item.fixedAt).getTime() + item.estimateMinutes * 60000 >= Date.now())
    .sort((a, b) => nextScore(b) - nextScore(a) || (a.scheduledAt || a.fixedAt || "").localeCompare(b.scheduledAt || b.fixedAt || ""))[0];
  const content = $("#nextStep"), actions = $("#nextActions");
  content.replaceChildren(); actions.replaceChildren();
  if (!task) {
    const title = make("h1", "", "从一件小事开始"); title.id = "nextTitle";
    content.append(title, make("p", "", "写下想处理的事，时序会帮你找到下一步。"));
    actions.hidden = true; return;
  }
  const title = make("h1", "", task.title); title.id = "nextTitle";
  content.append(title);
  content.append(make("p", "next-meta", "归属：" + questOf(task) + " · " + priorityOf(task) + " · " + task.plannedMinutes + " 分钟"));
  content.append(make("p", "next-why", "排序依据：" + (task.kind === "event" ? "固定时间临近" : task.priority !== "auto" ? "你设为" + priorityOf(task) : task.deadline && new Date(task.deadline).getTime() - Date.now() < 3 * 3600000 ? "临近截止" : task.questType === "main" ? "主线推进" : task.scheduledAt ? "接近安排时间" : "可开始的下一步")));
  const reason = task.kind === "event" ? "这是一项固定时间的日程，时序会保护原定时间。" : isAdventure(task) ? "截止时间临近，先为它留出这一段。" :
    task.questType === "main" ? "这是主线旅程的下一步。" :
    task.questType === "daily" ? "完成今天的小行动，就能继续向前。" :
    task.scheduledAt ? "安排在 " + formatDateTime(task.scheduledAt) : "先从一个可完成的小步骤开始。";
  content.append(make("p", "next-explain", reason));
  if (task.kind === "event") actions.append(button("查看日程 ›", () => setView("schedule"), task.id));
  else {
    actions.append(button("开始这一段 ›", openFocus, task.id));
    actions.append(button(task.questType === "daily" ? "今天先略过" : "稍后再做", task.questType === "daily" ? skipDaily : deferTask, task.id));
  }
  actions.hidden = false;
}
function renderSchedule() {
  const fullView = document.body.dataset.view === "schedule";
  const horizon = Date.now() + (fullView ? 7 * 24 : 72) * 3600000;
  const items = state.tasks.filter((task) => task.status === "pending" && task.scheduledAt && !isExpiredAdventure(task) &&
    task.questType !== "daily" && new Date(task.scheduledAt).getTime() <= horizon)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  if (!fullView) items.splice(3);
  const host = $("#scheduleList");
  host.replaceChildren();
  if (!items.length) {
    host.append(make("div", "empty-state", "近期还没有安排。固定事项和可调整任务会显示在这里。"));
  }
  let currentDay = "";
  let group;
  for (const task of items) {
    const key = dayKey(task.scheduledAt);
    if (key !== currentDay) {
      currentDay = key;
      group = make("div", "schedule-day");
      const date = new Date(key + "T12:00:00");
      group.append(make("div", "day-label", new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(date)));
      host.append(group);
    }
    const row = make("div", "schedule-item " + (task.kind === "event" ? "event" : isAdventure(task) ? "adventure" : "flexible"));
    const info = make("div");
    info.append(make("div", "schedule-title", task.title));
    const end = scheduleEnd(task);
    const detail = task.kind === "event" ? "已保护的固定时间" : questOf(task) + " · 预计 " + task.plannedMinutes + " 分钟" + (Number.isFinite(task.manualOrder) ? " · 手动排序" : "");
    info.append(make("div", "schedule-detail", detail + (end ? " · " + scheduleEndLabel(task) + " " + formatDateTime(end) : "")));
    const pill = make("span", "status-pill " + (task.kind === "event" ? "event" : isAdventure(task) ? "adventure" : "flexible"),
      task.kind === "event" ? "▣ 固定事项" : isAdventure(task) ? "✦ 奇遇 · " + timeLabel(task.deadline) + " 前" : "⇄ 可调整");
    row.append(make("span", "schedule-time", "开始 " + timeLabel(task.scheduledAt) + (task.kind === "event" && end ? "\n结束 " + timeLabel(end) : "")), info, pill);
    scheduleControls.decorate(row, task);
    group.append(row);
  }
  const todayKey = dayKey(new Date());
  const workMinutes = state.tasks.filter((task) => task.status === "pending" && task.scheduledAt && dayKey(task.scheduledAt) === todayKey && task.questType !== "daily" && !/聚餐|散步|休息|娱乐|旅行/.test(task.title))
    .reduce((sum, task) => sum + task.plannedMinutes, 0);
  const hours = workMinutes ? (Math.ceil(workMinutes / 30) / 2).toString() : "0";
  const urgent = state.tasks.filter((task) => isAdventure(task) && task.deadline && new Date(task.deadline).getTime() <= Date.now() + 24 * 3600000).length;
  const level = workMinutes || urgent ? Math.max(1, Math.min(5, Math.ceil(workMinutes / 75) + (urgent ? 1 : 0))) : 0;
  const summary = $("#workSummary"); summary.replaceChildren();
  summary.append(make("span", "", level ? "预计工作 " + hours + " 小时" : "今日空闲"));
  if (level) {
    const mangoes = make("span", "mango-strip level-" + level);
    mangoes.setAttribute("role", "img"); mangoes.setAttribute("aria-label", "忙碌度 " + level + "/5");
    for (let i = 0; i < level; i++) {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", "#i-mango"); icon.append(use); mangoes.append(icon);
    }
    summary.append(mangoes);
  }
  $("#busyExplanation").textContent = level ? "今天预计工作约 " + hours + " 小时，临近截止的奇遇任务 " + urgent + " 件，忙碌度为 " + level + "/5。建议保留任务之间的缓冲时间；忙碌时可把支线顺延。" : "今天还没有已安排的工作或临近截止任务。忙碌度暂不评级。";
  const daily = $("#dailyList"); daily.replaceChildren();
  for (const task of state.tasks.filter((item) => item.status === "pending" && item.questType === "daily")) {
    const row = make("label", "daily-item" + (isDailySkipped(task) ? " skipped" : ""));
    const check = make("input"); check.type = "checkbox"; check.checked = isDailyDone(task); check.addEventListener("change", () => toggleDaily(task.id));
    row.append(check, make("span", "", "每日 · " + task.title + (isDailySkipped(task) ? "（今天先略过）" : ""))); daily.append(row);
  }
}
function renderJourneys() {
  const host = $("#journeyList"); host.replaceChildren();
  if (!state.journeys.length) { host.append(make("div", "journey-empty", "这里会放你的主线和支线。新建旅程后，就能逐个添加可完成的路标。")); return; }
  for (const type of ["main", "side"]) for (const journey of (document.body.dataset.view === "today" ? state.journeys.filter((item) => item.kind === type).slice(0, 1) : state.journeys.filter((item) => item.kind === type))) {
    const tasks = state.tasks.filter((task) => task.journeyId === journey.id);
    const done = tasks.filter((task) => task.status === "done").length;
    const pending = tasks.find((task) => task.status === "pending" && !isExpiredAdventure(task));
    const card = make("article", "journey-card " + type);
    const icon = type === "main" ? make("img", "journey-icon") : document.createElementNS("http://www.w3.org/2000/svg", "svg");
    if (type === "main") { icon.src = "./assets/quest-mountain-flag.png"; icon.alt = ""; }
    else { const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", "#i-sprout"); icon.append(use); }
    const info = make("div");
    info.append(make("h3", "", questLabels[type] + "｜" + journey.title));
    const percent = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    info.append(make("p", "quest-label", done + " / " + tasks.length + " 个路标"));
    const progress = make("div", "journey-progress"); const fill = make("span"); fill.style.width = percent + "%"; progress.append(fill); info.append(progress);
    info.append(make("p", "journey-next", pending ? "下一路标：" + pending.title : tasks.length ? "当前路标已完成" : "还没有路标"));
    const actions = make("div", "journey-actions");
    actions.append(button("＋ 添加路标", openMilestone, journey.id), button("修改旅程", openJourneyEditor, journey.id), button("删除旅程", deleteJourney, journey.id));
    info.append(actions);
    const milestones = make("div", "milestone-list");
    for (const task of tasks) {
      const row = make("label", "milestone-row");
      const check = make("input"); check.type = "checkbox"; check.checked = task.status === "done"; check.disabled = task.status === "done";
      check.addEventListener("change", () => completeTask(task.id));
      row.append(check, make("span", "", task.title)); milestones.append(row);
    }
    info.append(milestones);
    card.append(icon, info); host.append(card);
  }
}
function renderTasks() {
  const pending = state.tasks.filter((task) => task.status === "pending" && !isExpiredAdventure(task));
  const expired = state.tasks.filter(isExpiredAdventure);
  const completed = state.tasks.filter((task) => task.status === "done");
  $("#taskCount").textContent = pending.filter((task) => !isDailyDone(task) && !isDailySkipped(task)).length + " 待处理" + (expired.length ? " · " + expired.length + " 待回顾" : "");
  $("#restoreButton").hidden = !undo;
  const host = $("#taskList"); host.replaceChildren();
  if (!pending.length) host.append(make("div", "empty-state", "当前没有待处理事项。"));
  for (const task of pending) appendTaskRow(host, task);
  const expiredHost = $("#expiredList"); expiredHost.replaceChildren();
  if (!expired.length) expiredHost.append(make("p", "subsection-empty", "暂无过时奇遇。"));
  for (const task of expired) appendTaskRow(expiredHost, task, true);
  const completedHost = $("#completedList"); completedHost.replaceChildren();
  if (!completed.length) completedHost.append(make("p", "subsection-empty", "还没有已完成事项。"));
  for (const task of completed) completedHost.append(make("p", "completed-item", "✓ " + task.title));
  const deferredHost = $("#deferredList"); deferredHost.replaceChildren();
  if (!state.deferredCaptures.length) deferredHost.append(make("p", "subsection-empty", "没有等待整理的输入。"));
  for (const capture of [...state.deferredCaptures].reverse()) {
    const row = make("div", "deferred-row");
    const info = make("div"); info.append(make("p", "", capture.text), make("small", "", formatDateTime(capture.createdAt)));
    const actions = make("div", "deferred-actions");
    actions.append(button("继续整理", resumeDeferred, capture.id), button("彻底删除", deleteDeferred, capture.id));
    row.append(info, actions); deferredHost.append(row);
  }
}
function appendTaskRow(host, task, expired = false) {
    const row = make("div", "task-row");
    const check = make("input", "task-check");
    check.type = "checkbox"; check.checked = isDailyDone(task);
    check.setAttribute("aria-label", (task.remainingMinutes > task.plannedMinutes ? "完成这一段 " : "完成 ") + task.title);
    check.addEventListener("change", () => task.questType === "daily" ? toggleDaily(task.id) : completeTask(task.id));
    const main = make("div", "task-main");
    main.append(make("div", "task-title", task.title));
    let meta = questOf(task) + " · " + (expired ? "原截止 " + formatDateTime(task.deadline) + "，已移入回顾" : task.questType === "daily" ? isDailyDone(task) ? "今日已完成，明天重新出现" : isDailySkipped(task) ? "今天先略过，明天重新出现" : "今天可完成" : task.scheduledAt ? "安排在 " + formatDateTime(task.scheduledAt) : "待安排");
    if (task.deadline && !task.scheduledAt && !expired && task.questType !== "daily") meta += " · 截止前时间不足，请调整";
    if (task.questType === "daily" && task.dailyHistory?.length) meta += " · 累计完成 " + task.dailyHistory.length + " 天";
    if (task.remainingMinutes > task.plannedMinutes && task.questType !== "daily") meta += " · 还需约 " + task.remainingMinutes + " 分钟";
    main.append(make("div", "task-meta", meta));
    const actions = make("div", "task-actions");
    actions.append(button(expired ? "重新安排" : "修改", editTask, task.id));
    if (!expired && task.questType !== "daily") actions.append(button("顺延", deferTask, task.id));
    actions.append(button("删除", deleteTask, task.id));
    row.append(check, main, actions); host.append(row);
}
function renderHistory() {
  const host = $("#captureHistory"); host.replaceChildren();
  if (!state.captures.length) { host.append(make("p", "field-note", "还没有确认过的原文记录。")); return; }
  for (const capture of [...state.captures].reverse().slice(0, 20)) {
    const item = make("div", "capture-history-item");
    item.append(make("time", "", formatDateTime(capture.createdAt)));
    item.append(make("p", "", capture.text));
    host.append(item);
  }
}
function setView(view, updateHash = true) {
  const selected = ["today", "journey", "schedule", "inbox"].includes(view) ? view : "today";
  document.body.dataset.view = selected;
  document.querySelectorAll(".bottom-nav a").forEach((link) => link.classList.toggle("active", link.dataset.nav === selected));
  $("#scheduleTitle").textContent = selected === "schedule" ? "近期日程" : "今天与未来 72 小时";
  if (updateHash) history.replaceState(null, "", "#" + selected);
  renderSchedule(); renderJourneys();
  window.scrollTo({ top: 0, behavior: "auto" });
}
function render() {
  const now = new Date();
  $("#monthNumber").textContent = now.getMonth() + 1;
  $("#dayNumber").textContent = now.getDate();
  $("#weekdayLabel").textContent = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(now).replace("星期", "周");
  try {
    const lunar = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric" }).format(now);
    const chineseMonth = (value) => {
      const names = ["", "正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
      return names[Number(value)] || value;
    };
    $("#lunarLabel").textContent = "农历" + lunar.replace(/(\d{1,2})月/g, (_, value) => chineseMonth(value) + "月").replace(/(\d{1,2})日?/g, (_, raw) => {
      const day = Number(raw);
      const digits = "一二三四五六七八九";
      const name = day <= 10 ? "初" + (day === 10 ? "十" : digits[day - 1])
        : day < 20 ? "十" + digits[day - 11]
        : day === 20 ? "二十" : day < 30 ? "廿" + digits[day - 21] : "三十";
      return name;
    });
  }
  catch { $("#lunarLabel").textContent = ""; }
  const weekday = now.getDay();
  $("#weekendLabel").textContent = weekday === 0 || weekday === 6 ? "周末进行中" : "距周末还有 " + (6 - weekday) + " 天";
  $("#reminderToggle").checked = state.quietReminders;
  $("#reminderMode").value = state.reminderMode || "visual";
  setTheme(); renderNext(); renderSchedule(); renderJourneys(); renderTasks(); renderHistory();
}
function addField(card, label, type, value, onChange) {
  const wrap = make("label");
  wrap.append(make("span", "", label));
  const isSelect = type === "select" || type === "quest-select" || type === "priority-select";
  const input = make(isSelect ? "select" : "input");
  if (isSelect) {
    const options = type === "quest-select" ? [["adventure", "奇遇任务"], ["normal", "短期任务"], ["main", "主线"], ["side", "支线"], ["daily", "每日任务"]] :
      type === "priority-select" ? [["auto", "自动判断"], ["high", "高"], ["medium", "中"], ["low", "低"]] : [["task", "可调整任务"], ["event", "固定事项"]];
    for (const [key, title] of options) {
      const option = make("option", "", title);
      option.value = key; input.append(option);
    }
    input.value = value;
  } else {
    input.type = type; input.value = value || "";
    if (type === "number") { input.min = "10"; input.max = "480"; input.step = "5"; }
    if (type === "text") input.maxLength = 180;
  }
  input.addEventListener("input", () => onChange(input.value));
  if (["select", "quest-select", "datetime-local", "number"].includes(type)) input.addEventListener("change", renderDrafts);
  wrap.append(input); card.append(wrap);
}
function renderDrafts() {
  const host = $("#draftList"); host.replaceChildren();
  drafts.forEach((draft, index) => {
    const card = make("div", "draft-item");
    addField(card, "事项", "text", draft.title, (value) => draft.title = value);
    addField(card, "安排方式", "select", draft.kind, (value) => draft.kind = value);
    addField(card, "任务归属", "quest-select", draft.questType, (value) => draft.questType = value);
    addField(card, "旅程名称", "text", draft.journeyName, (value) => draft.journeyName = value);
    addField(card, "优先级", "priority-select", draft.priority, (value) => draft.priority = value);
    addField(card, draft.kind === "event" ? "开始时间" : "截止时间", "datetime-local", draft.time, (value) => draft.time = value);
    addField(card, "预计分钟", "number", draft.duration, (value) => draft.duration = value);
    if (draft.kind === "event") card.append(make("small", "field-note", "结束时间由开始时间＋预计分钟计算，开始前与结束前会分别提醒。"));
    const stateLabel = make("label"); stateLabel.append(make("span", "", "记录状态"));
    const statusSelect = make("select");
    for (const [key, label] of [["future", "待进行"], ["ongoing", "正在进行·补录"], ["completed", "已经结束·补录"]]) {
      const option = make("option", "", label); option.value = key; statusSelect.append(option);
    }
    statusSelect.value = draft.recordState || "future";
    statusSelect.addEventListener("change", () => draft.recordState = statusSelect.value);
    stateLabel.append(statusSelect); card.append(stateLabel);
    const remove = button("移除", () => { drafts.splice(index, 1); renderDrafts(); });
    remove.className = "remove-draft";
    card.append(remove);
    if (draft.inferred || draft.journeySuggested) card.append(make("p", "draft-note", [draft.title === "补充具体事项" ? "原文没有说明具体行动，请先填写事项名称。" : draft.inferred ? "部分时间或时长是初步推测，请核对。" : "", draft.journeySuggested ? "已识别与「" + draft.journeyName + "」相关，确认后加入该旅程。" : ""].filter(Boolean).join(" ")));
    host.append(card);
  });
  $("#confirmDraftButton").disabled = drafts.length === 0;
  const totalMinutes = drafts.reduce((sum, item) => sum + Math.max(10, Number(item.duration) || 45), 0);
  const adventure = drafts.find((item) => item.questType === "adventure");
  const summaryParts = ["提炼出 " + drafts.length + " 件事项"];
  const fixedCount = drafts.filter((item) => item.kind === "event").length;
  const journeyCount = drafts.filter((item) => ["main", "side"].includes(item.questType)).length;
  if (fixedCount) summaryParts.push(fixedCount + " 件固定日程");
  if (journeyCount) summaryParts.push(journeyCount + " 件关联长期旅程");
  if (adventure) summaryParts.push("含临期奇遇");
  summaryParts.push("预计共 " + totalMinutes + " 分钟");
  $("#captureSummary").textContent = summaryParts.join(" · ");
  $("#reviewTitle").textContent = adventure ? "奇遇任务出现了" : "任务已整理好";
  $("#reviewSection").classList.toggle("has-adventure", Boolean(adventure));
  $("#reviewFootnote").textContent = adventure ? "过时后从当前地图移入回顾，不会悄悄删除。" : "先放一放会移入收纳箱，之后可以继续整理。";
  $("#questSuggestion").textContent = adventure ? "为这件事留出约 " + adventure.duration + " 分钟。确认后，时序会重新安排可调整任务；固定事项不会移动。" :
    "这次共整理出 " + drafts.length + " 件事，预计约 " + totalMinutes + " 分钟。请核对时间、时长和任务归属。";
  const preview = $("#questPlan"); preview.replaceChildren(); preview.hidden = !adventure;
  if (adventure) {
    const cutoff = adventure.time ? new Date(adventure.time) : null;
    const oldPlan = planTasks(state.tasks);
    const provisional = { id: "preview-adventure", title: adventure.title, kind: "task", status: "pending", questType: "adventure", priority: "high",
      estimateMinutes: Number(adventure.duration) || 45, remainingMinutes: Number(adventure.duration) || 45, plannedMinutes: Math.min(Number(adventure.duration) || 45, 90),
      createdAt: new Date().toISOString(), deadline: cutoff?.toISOString() || null, fixedAt: null, notBefore: null, scheduledAt: null };
    const newPlan = planTasks(state.tasks.concat(provisional));
    const suggested = newPlan.find((item) => item.id === provisional.id);
    const summary = make("p", "plan-preview-title", suggested?.scheduledAt ? "建议安排 · " + formatDateTime(suggested.scheduledAt) : "当前时间窗口不足，请调整截止时间或时长");
    preview.append(summary);
    const changed = oldPlan.map((old) => ({ old, next: newPlan.find((item) => item.id === old.id) })).filter(({ old, next }) => old.scheduledAt !== next?.scheduledAt).slice(0, 2);
    for (const { old, next } of changed) {
      const row = make("div", "plan-preview-row");
      row.append(make("span", "", old.scheduledAt ? timeLabel(old.scheduledAt) : "待安排"), make("span", "", old.title), make("span", "", "→"), make("strong", "", next?.scheduledAt ? timeLabel(next.scheduledAt) : "待安排"));
      preview.append(row);
    }
    if (!changed.length) preview.append(make("p", "plan-preview-empty", "现有安排无需移动。"));
  }
  const lead = $("#questLead"); lead.replaceChildren();
  const first = adventure || drafts[0];
  if (first) {
    const icon = make("span", "quest-lead-icon", first.kind === "event" ? "▣" : /回复|邮件/.test(first.title) ? "✉" : "✦");
    const info = make("div"); info.append(make("strong", "", first.title));
    info.append(make("p", "", drafts.length > 1 ? "同时整理了另外 " + (drafts.length - 1) + " 件事。请在下方逐项核对。" : adventure ? "先花 " + first.duration + " 分钟完成关键一步。" : "先确认关键信息，再决定是否加入计划。"));
    lead.append(icon, info);
    const when = first.time ? new Date(first.time) : null;
    $("#questTiming").textContent = when && !Number.isNaN(when.getTime()) ? "◷ " + (first.kind === "event" ? "固定时间 · " : "截止前 · ") + formatDateTime(when) : "✦ 等待确认";
  } else $("#questTiming").textContent = "";
}
async function startCapture(text = $("#captureInput").value) {
  if (!text.trim()) { $("#captureMessage").textContent = "先写下一件想处理的事。"; $("#captureInput").focus(); return 0; }
  if (captureBusy) return 0;
  captureBusy = true; $("#organizeButton").disabled = true;
  captureText = text.trim();
  let modelUsed = false;
  try {
    $("#captureMessage").textContent = "正在智能识别，请稍候…";
    try { drafts = await recognizeWithDeepSeek(text); modelUsed = true; }
    catch { toast("智能识别暂不可用，已改用本地识别；请核对草稿。"); }
    if (!modelUsed) {
      $("#captureMessage").textContent = "正在提炼事项、时间和任务归属…";
      await new Promise((resolve) => requestAnimationFrame(resolve));
      drafts = parseCapture(text).map((draft) => {
        const questType = inferredQuest(draft.sourceText || draft.title, draft.kind, draft.time, draft.duration);
        return { ...draft, questType, priority: "auto", journeyName: ["main", "side"].includes(questType) ? inferredJourneyTitle(draft.title, questType) : "" };
      });
    }
    drafts = drafts.map((draft) => {
      const title = summarizeTitle(draft.title);
      const source = draft.sourceText || draft.title;
      const journey = relatedJourney(title);
      const related = journey && draft.kind === "task" && draft.questType !== "daily";
      const recordState = draft.recordState || (/已经|已完成|结束了|刚才.*(?:完成|结束)|补录.*(?:完成|结束)/.test(source) ? "completed" : /正在|进行中|开始了/.test(source) ? "ongoing" : "future");
      return { ...draft, title, sourceText: source, inferred: draft.inferred || title === "补充具体事项", questType: related ? journey.kind : recordState === "completed" && draft.questType === "adventure" ? "normal" : draft.questType,
        journeyName: related ? journey.title : draft.journeyName || "", journeySuggested: Boolean(related), recordState };
    });
  } finally { captureBusy = false; $("#organizeButton").disabled = false; }
  renderDrafts();
  if (!$("#reviewSection").open) $("#reviewSection").showModal();
  $("#captureMessage").textContent = (modelUsed ? "智能" : "本地") + "整理出 " + drafts.length + " 件事。请核对关键时间，再加入计划。";
  return drafts.length;
}
function applyProposal() {
  if (!proposed) return;
  const count = drafts.length;
  const next = { ...proposed, captures: proposed.captures.concat({ id: String(newId()), text: captureText, createdAt: new Date().toISOString() }).slice(-200),
    deferredCaptures: proposed.deferredCaptures.filter((item) => item.id !== captureDeferredId) };
  commit(next, "已加入 " + count + " 件事。你可以随时撤销。");
  drafts = []; proposed = null; captureText = ""; captureDeferredId = null;
  if ($("#reviewSection").open) $("#reviewSection").close();
  $("#captureInput").value = "";
  $("#captureMessage").textContent = "内容只保存在当前设备。安排前，你可以逐项确认。";
  if ($("#changesDialog").open) $("#changesDialog").close();
}
function confirmDrafts() {
  const additions = [];
  const next = clone(state);
  for (const draft of drafts) {
    if (!draft.title.trim() || draft.title.trim() === "补充具体事项") { toast("请先补充具体要做的事，或移除这条草稿。"); return; }
    if (draft.kind === "event" && !draft.time) { toast("固定事项需要确认日期和时间。"); return; }
    const parsed = draft.time ? new Date(draft.time) : null;
    if (parsed && Number.isNaN(parsed.getTime())) { toast("请检查日期和时间。"); return; }
    if (draft.recordState === "future" && parsed < new Date(Date.now() - 60000)) { toast("过去的时间请选择‘正在进行’或‘已经结束’补录，或修改为未来时间。"); return; }
    const minutes = Math.max(10, Math.min(Number(draft.duration) || 45, 480));
    const time = parsed ? parsed.toISOString() : null;
    const questType = draft.kind === "event" ? "normal" : draft.questType;
    const journey = ["main", "side"].includes(questType) ? findOrCreateJourney(next, (draft.journeyName || "").trim() || inferredJourneyTitle(draft.title, questType), questType) : null;
    additions.push({ id: String(newId()), title: draft.title.trim().slice(0, 180), kind: draft.kind,
      status: draft.recordState === "completed" ? "done" : "pending", estimateMinutes: minutes, remainingMinutes: minutes,
      plannedMinutes: Math.min(minutes, 90), createdAt: new Date().toISOString(),
      deadline: draft.kind === "task" && questType !== "daily" ? time : null, fixedAt: draft.kind === "event" ? time : null,
      notBefore: null, scheduledAt: null, questType, journeyId: journey?.id || null, priority: draft.priority || "auto",
      actualStartAt: draft.recordState === "ongoing" ? time || new Date().toISOString() : null,
      completedAt: draft.recordState === "completed" ? time || new Date().toISOString() : null,
      dailyLastCompleted: null, dailyHistory: [], dailyLastSkipped: null });
    if (draft.recordState === "ongoing" && additions.at(-1).kind === "task") additions.at(-1).deadline = null;
  }
  if (!additions.length) return;
  const fixed = state.tasks.filter((task) => task.status === "pending" && task.kind === "event" && new Date(task.fixedAt).getTime() + task.estimateMinutes * 60000 > Date.now()).concat(additions.filter((task) => task.status === "pending" && task.kind === "event" && new Date(task.fixedAt).getTime() + task.estimateMinutes * 60000 > Date.now()));
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i], b = fixed[j];
      const aStart = new Date(a.fixedAt).getTime(), bStart = new Date(b.fixedAt).getTime();
      if (aStart < bStart + b.estimateMinutes * 60000 && bStart < aStart + a.estimateMinutes * 60000) {
        toast("固定事项时间冲突，请修改其中一项后再加入。");
        return;
      }
    }
  }
  const planned = previewScheduleChange(state.tasks, next.tasks.concat(additions));
  if (planned.error) { toast(planned.error); return; }
  proposed = { ...next, tasks: planned.tasks };
  const changes = state.tasks.filter((task) => task.status === "pending").map((old) => {
    const updated = proposed.tasks.find((task) => task.id === old.id);
    if (!updated || old.scheduledAt === updated.scheduledAt) return null;
    return old.title + "：" + (old.scheduledAt ? formatDateTime(old.scheduledAt) : "待安排") +
      " → " + (updated.scheduledAt ? formatDateTime(updated.scheduledAt) : "待安排");
  }).filter(Boolean);
  if (!changes.length) { applyProposal(); return; }
  const host = $("#changesList"); host.replaceChildren();
  changes.slice(0, 5).forEach((change) => host.append(make("li", "", change)));
  if (changes.length > 5) host.append(make("li", "", "另外还有 " + (changes.length - 5) + " 项变化"));
  $("#changesDialog").showModal();
}
function completeTask(taskId) {
  const next = clone(state), task = next.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== "pending") return;
  if (task.questType === "daily") { toggleDaily(taskId); return; }
  if (task.kind === "task" && task.remainingMinutes > task.plannedMinutes) {
    task.remainingMinutes -= task.plannedMinutes;
    task.notBefore = new Date(Date.now() + 15 * 60000).toISOString();
    commit(next, "完成一段，还剩约 " + task.remainingMinutes + " 分钟。");
  } else { task.status = "done"; task.completedAt = new Date().toISOString(); commit(next, "已确认完成。今天已经向前走了一步。"); }
}
function toggleDaily(taskId) {
  const next = clone(state), task = next.tasks.find((item) => item.id === taskId);
  if (!task || task.questType !== "daily") return;
  const today = dayKey(new Date());
  task.dailyHistory = Array.isArray(task.dailyHistory) ? task.dailyHistory : [];
  task.dailyHistory = isDailyDone(task) ? task.dailyHistory.filter((value) => value !== today) : [...new Set(task.dailyHistory.concat(today))].slice(-365);
  task.dailyLastCompleted = task.dailyHistory.includes(today) ? today : null;
  task.dailyLastSkipped = null;
  commit(next, task.dailyLastCompleted ? "今天的每日任务已完成，明天会重新出现。" : "已撤销今天的完成记录。");
}
function skipDaily(taskId) {
  const next = clone(state), task = next.tasks.find((item) => item.id === taskId);
  if (!task || task.questType !== "daily") return;
  task.dailyLastSkipped = dayKey(new Date());
  commit(next, "今天先略过，明天会重新出现。");
}
function deferTask(taskId) {
  const next = clone(state), task = next.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== "pending") return;
  if (task.kind === "event") { toast("固定事项需要手动确认新时间。"); return; }
  if (isExpiredAdventure(task) || (task.deadline && new Date(task.deadline).getTime() < Date.now() + 24 * 3600000)) {
    toast("截止时间不会自动延长，请先确认新的截止时间。"); editTask(taskId); return;
  }
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
  task.notBefore = tomorrow.toISOString();
  commit(next, "已尝试顺延到明天；如时间不足，会显示为待安排。");
}
function editTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  activeEditId = taskId;
  $("#editTitle").value = task.title;
  $("#editKind").value = task.kind;
  $("#editQuestType").value = task.questType;
  $("#editPriority").value = task.priority || "auto";
  $("#editJourneyName").value = state.journeys.find((item) => item.id === task.journeyId)?.title || "";
  $("#editMinutes").value = task.estimateMinutes;
  const current = task.kind === "event" ? task.fixedAt : task.deadline;
  $("#editTime").value = current ? new Date(new Date(current).getTime() - new Date(current).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  const options = $("#journeyOptions"); options.replaceChildren();
  state.journeys.forEach((item) => { const option = make("option"); option.value = item.title; options.append(option); });
  $("#taskEditDialog").showModal();
}
function saveTaskEdit(event) {
  event.preventDefault();
  const next = clone(state), task = next.tasks.find((item) => item.id === activeEditId);
  if (!task) return;
  const title = $("#editTitle").value.trim();
  const kind = $("#editKind").value;
  const questType = kind === "event" ? "normal" : $("#editQuestType").value;
  const minutes = Math.max(10, Math.min(480, Number($("#editMinutes").value) || 45));
  const timeInput = $("#editTime").value;
  const parsed = timeInput ? new Date(timeInput) : null;
  if (!title || (timeInput && Number.isNaN(parsed.getTime()))) { toast("请检查名称和时间。"); return; }
  if (kind === "event" && !parsed) { toast("固定事项需要准确时间。"); return; }
  if (kind === "event" && parsed.getTime() + minutes * 60000 < Date.now()) {
    task.status = "done"; task.completedAt = new Date(parsed.getTime() + minutes * 60000).toISOString();
  }
  if (kind === "event" && next.tasks.some((other) => other.id !== task.id && other.status === "pending" && other.kind === "event" &&
    parsed.getTime() < new Date(other.fixedAt).getTime() + other.estimateMinutes * 60000 &&
    new Date(other.fixedAt).getTime() < parsed.getTime() + minutes * 60000)) { toast("固定事项时间冲突，修改未保存。"); return; }
  const alreadyDone = Math.max(0, task.estimateMinutes - task.remainingMinutes);
  task.title = title; task.kind = kind; task.questType = questType; task.priority = $("#editPriority").value;
  task.estimateMinutes = minutes; task.remainingMinutes = Math.max(10, minutes - alreadyDone);
  task.fixedAt = kind === "event" ? parsed.toISOString() : null;
  task.deadline = kind === "task" && questType !== "daily" && parsed ? parsed.toISOString() : null;
  task.notBefore = null;
  if (["main", "side"].includes(questType)) {
    const name = $("#editJourneyName").value.trim() || inferredJourneyTitle(title, questType);
    task.journeyId = findOrCreateJourney(next, name, questType).id;
  } else task.journeyId = null;
  if (questType !== "daily") { task.dailyLastCompleted = null; task.dailyHistory = []; task.dailyLastSkipped = null; }
  commit(next, "事项已更新。");
  $("#taskEditDialog").close(); activeEditId = null;
}
function resumeDeferred(captureId) {
  const item = state.deferredCaptures.find((capture) => capture.id === captureId);
  if (!item) return;
  captureDeferredId = captureId;
  setView("today");
  $("#captureInput").value = item.text;
  startCapture(item.text);
}
function deleteDeferred(captureId) {
  const item = state.deferredCaptures.find((capture) => capture.id === captureId);
  if (!item || !confirm("彻底删除这条未敲定的输入？")) return;
  const next = clone(state);
  next.deferredCaptures = next.deferredCaptures.filter((capture) => capture.id !== captureId);
  commit(next, "已删除暂存输入，可在本次页面中撤销。");
}
function openJourneyEditor(journeyId = null) {
  activeEditId = journeyId;
  const journey = state.journeys.find((item) => item.id === journeyId);
  $("#journeyDialogTitle").textContent = journey ? "修改长期旅程" : "新建长期旅程";
  $("#journeyNameInput").value = journey?.title || "";
  $("#journeyKindInput").value = journey?.kind || "main";
  $("#journeyFirstMilestone").value = "";
  $("#journeyFirstMilestone").closest("label").hidden = !!journey;
  $("#journeyDialog").showModal();
}
function saveJourney(event) {
  event.preventDefault();
  const title = $("#journeyNameInput").value.trim();
  const kind = $("#journeyKindInput").value;
  if (!title) return;
  const next = clone(state);
  let journey = next.journeys.find((item) => item.id === activeEditId);
  if (journey) {
    journey.title = title; journey.kind = kind;
    next.tasks.filter((task) => task.journeyId === journey.id).forEach((task) => task.questType = kind);
  } else {
    journey = { id: String(newId()), title, kind, createdAt: new Date().toISOString() };
    next.journeys.push(journey);
    const first = $("#journeyFirstMilestone").value.trim();
    if (first) next.tasks.push(makeMilestone(journey, first, 45));
  }
  commit(next, activeEditId ? "旅程已更新。" : "旅程已建立，可以继续添加路标。");
  $("#journeyDialog").close(); activeEditId = null;
  setView("journey");
}
function deleteJourney(journeyId) {
  const journey = state.journeys.find((item) => item.id === journeyId);
  if (!journey || !confirm("删除旅程“" + journey.title + "”？关联路标会留在收纳箱，变成普通任务。")) return;
  const next = clone(state);
  next.journeys = next.journeys.filter((item) => item.id !== journeyId);
  next.tasks.filter((task) => task.journeyId === journeyId).forEach((task) => { task.journeyId = null; task.questType = "normal"; });
  commit(next, "旅程已删除，路标仍保留在收纳箱。可撤销。");
}
function makeMilestone(journey, title, minutes) {
  return { id: String(newId()), title, kind: "task", status: "pending", questType: journey.kind, journeyId: journey.id,
    priority: journey.kind === "main" ? "high" : "medium", estimateMinutes: minutes, remainingMinutes: minutes,
    plannedMinutes: Math.min(90, minutes), createdAt: new Date().toISOString(), deadline: null, fixedAt: null,
    notBefore: null, scheduledAt: null, dailyLastCompleted: null, dailyLastSkipped: null };
}
function openMilestone(journeyId) {
  activeMilestoneJourneyId = journeyId;
  $("#milestoneTitle").value = ""; $("#milestoneMinutes").value = 45;
  $("#milestoneDialog").showModal();
}
function saveMilestone(event) {
  event.preventDefault();
  const journey = state.journeys.find((item) => item.id === activeMilestoneJourneyId);
  const title = $("#milestoneTitle").value.trim();
  if (!journey || !title) return;
  const minutes = Math.max(10, Math.min(480, Number($("#milestoneMinutes").value) || 45));
  const next = clone(state); next.tasks.push(makeMilestone(journey, title, minutes));
  commit(next, "新路标已加入旅程和待处理事项。");
  $("#milestoneDialog").close(); activeMilestoneJourneyId = null;
}
function openFocus(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  if (focusTaskId !== taskId) { focusTaskId = taskId; focusSeconds = task.plannedMinutes * 60; focusEndAt = null; clearInterval(focusTimer); }
  $("#focusTaskTitle").textContent = task.title;
  updateFocusClock();
  $("#focusDialog").showModal();
}
function updateFocusClock() {
  if (focusEndAt) focusSeconds = Math.max(0, Math.ceil((focusEndAt - Date.now()) / 1000));
  $("#focusClock").textContent = String(Math.floor(focusSeconds / 60)).padStart(2, "0") + ":" + String(focusSeconds % 60).padStart(2, "0");
  $("#focusToggleButton").textContent = focusEndAt ? "暂停计时" : focusSeconds ? "开始计时" : "重新计时";
  if (!focusSeconds && focusEndAt) { focusEndAt = null; clearInterval(focusTimer); toast("这一段的预计时间到了，可以记录进度。"); }
}
function toggleFocusTimer() {
  if (focusEndAt) { focusSeconds = Math.max(0, Math.ceil((focusEndAt - Date.now()) / 1000)); focusEndAt = null; clearInterval(focusTimer); }
  else {
    if (!focusSeconds) focusSeconds = (state.tasks.find((task) => task.id === focusTaskId)?.plannedMinutes || 25) * 60;
    focusEndAt = Date.now() + focusSeconds * 1000;
    focusTimer = setInterval(updateFocusClock, 1000);
  }
  updateFocusClock();
}
function deleteTask(taskId) {
  const next = clone(state); next.tasks = next.tasks.filter((task) => task.id !== taskId);
  commit(next, "事项已删除，可撤销。");
}
function checkReminders() {
  if (!state.quietReminders || document.visibilityState !== "visible") return;
  const due = nextScheduleReminder(state.tasks, reminded);
  if (!due) return;
  const { task, minutes, kind, key } = due;
  reminded.add(key);
  $("#reminderTitle").textContent = (kind === "start" ? "日程即将开始" : task.kind === "event" ? "日程即将结束" : task.deadline ? "任务即将截止" : "本段时间即将结束") + " · " + task.title;
  $("#reminderDetail").textContent = questOf(task) + " · " + priorityOf(task) + " · " + (minutes <= 0 ? "时间已到，请确认完成" : `约 ${Math.ceil(minutes)} 分钟后${kind === "start" ? "开始" : scheduleEndLabel(task)}`);
  $("#reminderComplete").hidden = kind !== "end";
  $("#reminderComplete").textContent = task.kind === "task" && task.remainingMinutes > task.plannedMinutes ? "完成这一段" : "确认完成";
  $("#reminderComplete").onclick = () => { completeTask(task.id); $("#reminderBanner").hidden = true; };
  $("#reminderBanner").hidden = false;
  if (state.reminderMode === "sound") playReminderTone();
}
let reminderAudio;
function playReminderTone() {
  try {
    reminderAudio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (reminderAudio.state !== "running") return;
    const now = reminderAudio.currentTime;
    for (const [offset, frequency] of [[0, 523], [0.24, 659]]) {
      const oscillator = reminderAudio.createOscillator(), gain = reminderAudio.createGain();
      oscillator.type = "sine"; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.035, now + offset + 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.55);
      oscillator.connect(gain).connect(reminderAudio.destination);
      oscillator.start(now + offset); oscillator.stop(now + offset + 0.56);
    }
  } catch { /* Visual reminder remains available. */ }
}
function deferCurrentCapture() {
  if (!captureText.trim()) return;
  if (!captureDeferredId) {
    const next = clone(state);
    next.deferredCaptures.push({ id: String(newId()), text: captureText, createdAt: new Date().toISOString() });
    next.deferredCaptures = next.deferredCaptures.slice(-100);
    commit(next, "已放入收纳箱，之后可以继续整理。");
  }
  drafts = []; proposed = null; captureText = ""; captureDeferredId = null;
  $("#captureInput").value = "";
  $("#captureMessage").textContent = "已放入收纳箱，可以稍后继续整理。";
}
function deleteCurrentCapture() {
  if (!confirm("删除这次尚未敲定的输入？已编辑的草稿也会一起丢弃。")) return;
  if (captureDeferredId) {
    const next = clone(state);
    next.deferredCaptures = next.deferredCaptures.filter((capture) => capture.id !== captureDeferredId);
    commit(next, "已删除未敲定的输入，可在本次页面中撤销。");
  }
  drafts = []; proposed = null; captureText = ""; captureDeferredId = null;
  $("#captureInput").value = "";
  $("#captureMessage").textContent = "这次输入已删除，可以重新记录。";
  $("#reviewSection").close();
}
$("#organizeButton").addEventListener("click", () => startCapture());
$("#discardDraftButton").addEventListener("click", () => { deferCurrentCapture(); $("#reviewSection").close(); });
$("#deleteCaptureButton").addEventListener("click", deleteCurrentCapture);
$("#reviewSection").addEventListener("close", () => { if (drafts.length) deferCurrentCapture(); });
$("#confirmDraftButton").addEventListener("click", confirmDrafts);
$("#changesConfirmButton").addEventListener("click", applyProposal);
$("#changesCancelButton").addEventListener("click", () => { proposed = null; $("#changesDialog").close(); });
$("#settingsButton").addEventListener("click", () => $("#settingsDialog").showModal());
$("#themeSelect").addEventListener("change", (event) => { localStorage.setItem("rixu.theme", event.target.value); setTheme(); });
$("#scheduleMoreButton").addEventListener("click", () => setView("schedule"));
$("#journeyShortcut").addEventListener("click", () => setView("journey"));
$("#reminderDismiss").addEventListener("click", () => $("#reminderBanner").hidden = true);
$("#workSummary").addEventListener("click", () => $("#busyDialog").showModal());
$("#newJourneyButton").addEventListener("click", () => openJourneyEditor());
$("#journeyForm").addEventListener("submit", saveJourney);
$("#milestoneForm").addEventListener("submit", saveMilestone);
$("#taskEditForm").addEventListener("submit", saveTaskEdit);
$("#focusToggleButton").addEventListener("click", toggleFocusTimer);
$("#focusCompleteButton").addEventListener("click", () => {
  if (focusTaskId) completeTask(focusTaskId);
  focusTaskId = null; focusEndAt = null; clearInterval(focusTimer); $("#focusDialog").close();
});
$("#focusDialog").addEventListener("close", () => { if (focusEndAt) toggleFocusTimer(); });
for (const close of document.querySelectorAll(".dialog-close")) close.addEventListener("click", () => close.closest("dialog").close());
for (const item of document.querySelectorAll(".bottom-nav a")) item.addEventListener("click", (event) => { event.preventDefault(); setView(item.dataset.nav); });
window.addEventListener("hashchange", () => setView(location.hash.slice(1), false));
$("#reminderToggle").addEventListener("change", (event) => {
  state.quietReminders = event.target.checked; save();
  toast(event.target.checked ? "已开启安静提醒。" : "已关闭提醒。");
});
$("#reminderMode").addEventListener("change", (event) => {
  state.reminderMode = event.target.value === "sound" ? "sound" : "visual";
  if (state.reminderMode === "sound") {
    try { reminderAudio ||= new (window.AudioContext || window.webkitAudioContext)(); reminderAudio.resume(); } catch {}
  }
  save(); toast(state.reminderMode === "sound" ? "已尝试开启轻音提醒。" : "已改为安静的渐入提示。");
});
$("#restoreButton").addEventListener("click", () => {
  if (!undo) return;
  state = undo; undo = null; save(); render(); toast("已撤销上一步。");
});
$("#exportButton").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ version: 2, ...state }, null, 2)], { type: "application/json" });
  const link = make("a"); link.href = URL.createObjectURL(blob);
  link.download = "时序备份-" + dayKey(new Date()) + ".json"; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
$("#importInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.tasks) || data.tasks.some((task) => !normalize(task))) throw new Error("invalid");
    if (!confirm("将用备份中的 " + data.tasks.length + " 项事项替换本机数据，继续吗？")) return;
    commit(ensureLegacyJourneys({ tasks: data.tasks.map(normalize), journeys: Array.isArray(data.journeys) ? data.journeys.map(normalizeJourney).filter(Boolean) : [],
      captures: Array.isArray(data.captures) ? data.captures.map(normalizeCapture).filter(Boolean).slice(-200) : [],
      deferredCaptures: Array.isArray(data.deferredCaptures) ? data.deferredCaptures.map(normalizeCapture).filter(Boolean).slice(-100) : [],
      quietReminders: data.quietReminders !== false, reminderMode: data.reminderMode === "sound" ? "sound" : "visual" }), "备份已导入。");
    $("#settingsDialog").close();
  } catch { toast("无法读取备份文件。"); }
  event.target.value = "";
});
$("#clearButton").addEventListener("click", () => {
  if (!confirm("确定清空本机所有时序事项吗？")) return;
  commit(defaults(), "本机数据已清空，可在本次会话中撤销。");
  $("#settingsDialog").close();
});
let activeRecognition = null;
function voiceState(listening, message) {
  const control = $("#voiceButton");
  control.classList.toggle("listening", listening);
  control.setAttribute("aria-pressed", String(listening));
  control.setAttribute("aria-label", listening ? "结束语音输入" : "开始语音输入");
  control.textContent = listening ? "■" : "🎙";
  $("#captureMessage").textContent = message;
}
$("#voiceButton").addEventListener("click", async () => {
  if (activeRecognition) { activeRecognition.stop(); return; }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!window.isSecureContext || !SpeechRecognition) {
    voiceState(false, "此浏览器无法直接转写。可点输入框，用手机键盘上的麦克风口述。");
    $("#captureInput").focus();
    return;
  }
  const recognition = new SpeechRecognition();
  activeRecognition = recognition;
  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  let finalText = "", interimText = "", error = "";
  let watchdog;
  recognition.onresult = (event) => {
    finalText = ""; interimText = "";
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      const words = result[0]?.transcript || "";
      if (result.isFinal) finalText += words;
      else interimText += words;
    }
    voiceState(true, finalText ? "已听到：" + finalText.trim() : "正在识别：" + interimText.trim());
  };
  recognition.onerror = (event) => {
    error = ({ "not-allowed": "麦克风权限被拒绝，请在浏览器设置中允许后重试。", "service-not-allowed": "浏览器语音服务不可用，可用手机键盘麦克风口述。", network: "语音服务连接失败，可用手机键盘麦克风口述。", "no-speech": "没有听清，请靠近麦克风再试一次。", "audio-capture": "未找到可用麦克风，请检查设备。" })[event.error] || "语音识别中断，可重试或改用键盘麦克风。";
  };
  recognition.onend = () => {
    clearTimeout(watchdog);
    if (activeRecognition !== recognition) return;
    activeRecognition = null;
    const spoken = (finalText || interimText).trim();
    if (spoken) {
      $("#captureInput").value = [$("#captureInput").value.trim(), spoken].filter(Boolean).join("；");
      if (finalText.trim()) { voiceState(false, "识别完成，请核对内容后确认安排。"); startCapture($("#captureInput").value); }
      else voiceState(false, "识别提前结束，已保留听到的文字。请核对后点“整理并确认”。");
    } else voiceState(false, error || "没有识别到内容，请再试一次，或用手机键盘麦克风口述。");
  };
  try {
    voiceState(true, "正在请求麦克风权限…");
    if (navigator.mediaDevices?.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    }
    voiceState(true, "正在听，请一次说完整件事；再次点按钮可结束。");
    recognition.start();
    watchdog = setTimeout(() => { if (activeRecognition === recognition) recognition.stop(); }, 30000);
  } catch (cause) {
    clearTimeout(watchdog);
    activeRecognition = null;
    voiceState(false, cause?.name === "NotAllowedError" ? "麦克风权限未获允许。请在手机浏览器的网站权限中打开麦克风，再点一次。" : "无法启动语音识别。可点输入框使用手机键盘麦克风口述。");
  }
});
function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const definitions = [
    { name: "start_task_capture", title: "整理事项草稿", description: "拆分用户输入并展示待确认草稿，不直接加入计划。",
      inputSchema: { type: "object", properties: { text: { type: "string", minLength: 1 } }, required: ["text"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) { if (!input || typeof input.text !== "string" || !input.text.trim()) throw new Error("请输入事项文本"); $("#captureInput").value = input.text; return { status: "awaiting_confirmation", draftCount: await startCapture(input.text) }; } },
    { name: "read_near_term_plan", title: "查看近期计划", description: "读取已确认的近期安排。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute() { return { tasks: state.tasks.filter((task) => task.status === "pending").map((task) => ({ title: task.title, scheduledAt: task.scheduledAt, deadline: task.deadline })) }; } }
  ];
  for (const definition of definitions) Promise.resolve(context.registerTool(definition)).catch(() => {});
}
setView(location.hash.slice(1) || "today", false);
render(); checkReminders(); setInterval(() => { render(); checkReminders(); }, 60000); registerWebMcp();
function refreshFromWidget() { state = load(); render(); }
window.addEventListener("storage", (event) => { if (event.key === KEY) refreshFromWidget(); });
window.addEventListener("rixu:data-changed", refreshFromWidget);
const incomingCapture = new URL(location.href).searchParams.get("capture");
if (incomingCapture?.trim()) {
  history.replaceState(null, "", location.pathname + location.hash);
  $("#captureInput").value = incomingCapture.slice(0, 500);
  startCapture($("#captureInput").value);
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
