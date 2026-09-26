import { parseCapture, planTasks, formatDateTime, dayKey, timeLabel } from "./planner.js";

const $ = (selector) => document.querySelector(selector);
const KEY = "rixu.web.v1";
const clone = (value) => JSON.parse(JSON.stringify(value));
const newId = () => crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random();
const defaults = () => ({ tasks: [], journeys: [], captures: [], deferredCaptures: [], quietReminders: true });
const dateValue = (value) => value && !Number.isNaN(new Date(value).getTime()) ? value : null;
const make = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
};
const questLabels = { main: "主线", side: "支线", daily: "每日", normal: "短期任务" };
function inferredQuest(title, kind) {
  if (kind === "event") return "normal";
  if (/每天|每日|散步|运动|冥想|打卡/.test(title)) return "daily";
  if (/求职|作品集|面试准备|论文|考试准备|转行|学习计划/.test(title)) return "main";
  if (/财务|预算|储蓄|副业|整理房间|阅读计划/.test(title)) return "side";
  return "normal";
}
function isExpiredAdventure(task) { return task.kind === "task" && task.questType !== "daily" && task.status === "pending" && task.deadline && new Date(task.deadline).getTime() < Date.now(); }
function isAdventure(task) {
  const deadline = task.deadline && new Date(task.deadline).getTime();
  return task.kind === "task" && task.questType !== "daily" && task.status === "pending" && deadline && deadline >= Date.now() && deadline <= Date.now() + 36 * 3600000;
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
  document.body.dataset.theme = pref === "auto" ? (hour >= 6 && hour < 18 ? "day" : "night") : pref;
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
    notBefore: dateValue(item.notBefore), scheduledAt: dateValue(item.scheduledAt),
    questType: ["main", "side", "daily", "normal"].includes(item.questType) ? item.questType : inferredQuest(item.title, item.kind),
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
      quietReminders: raw.quietReminders !== false });
  } catch { return defaults(); }
}
let state = load();
let drafts = [];
let undo = null;
let proposed = null;
let captureText = "";
let captureDeferredId = null;
let toastTimer;
let activeEditId = null;
let activeMilestoneJourneyId = null;
let focusTaskId = null;
let focusSeconds = 0;
let focusEndAt = null;
let focusTimer = null;
const reminded = new Set();
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
function toast(message) {
  const node = $("#toast");
  node.textContent = message; node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.hidden = true, 4200);
}
function commit(next, message) {
  undo = clone(state);
  state = { tasks: planTasks(next.tasks), journeys: next.journeys || [], captures: next.captures || [],
    deferredCaptures: next.deferredCaptures || [], quietReminders: next.quietReminders };
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
  const scheduled = task.scheduledAt ? new Date(task.scheduledAt).getTime() : Infinity;
  const deadline = task.deadline ? new Date(task.deadline).getTime() : Infinity;
  let score = task.priority === "high" ? 65 : task.priority === "medium" ? 30 : task.priority === "low" ? -20 : task.questType === "main" ? 30 : 0;
  if (deadline - Date.now() <= 36 * 3600000) score += 70;
  if (task.questType === "adventure") score += 20;
  if (scheduled <= Date.now() + 2 * 3600000) score += 45;
  else if (scheduled <= Date.now() + 24 * 3600000) score += 20;
  if (task.questType === "daily") score += 6;
  return score;
}
function renderNext() {
  const task = activeTasks().filter((item) => item.kind === "task")
    .sort((a, b) => nextScore(b) - nextScore(a) || (a.scheduledAt || "").localeCompare(b.scheduledAt || ""))[0] ||
    activeTasks().filter((item) => item.kind === "event").sort((a, b) => new Date(a.fixedAt) - new Date(b.fixedAt))[0];
  const content = $("#nextStep"), actions = $("#nextActions");
  content.replaceChildren(); actions.replaceChildren();
  if (!task) {
    const title = make("h1", "", "从一件小事开始"); title.id = "nextTitle";
    content.append(title, make("p", "", "写下想处理的事，日序会帮你找到下一步。"));
    actions.hidden = true; return;
  }
  const title = make("h1", "", task.title); title.id = "nextTitle";
  content.append(title);
  content.append(make("p", "next-meta", "归属：" + questOf(task) + " · " + priorityOf(task) + " · " + task.plannedMinutes + " 分钟"));
  const reason = task.kind === "event" ? "这是一项固定时间的日程，日序会保护原定时间。" : isAdventure(task) ? "截止时间临近，先为它留出这一段。" :
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
  const horizon = Date.now() + (document.body.dataset.view === "schedule" ? 7 * 24 : 72) * 3600000;
  const items = state.tasks.filter((task) => task.status === "pending" && task.scheduledAt && !isExpiredAdventure(task) &&
    task.questType !== "daily" && new Date(task.scheduledAt).getTime() <= horizon)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
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
    const detail = task.kind === "event" ? "已保护的固定时间" : questOf(task) + " · 预计 " + task.plannedMinutes + " 分钟";
    info.append(make("div", "schedule-detail", detail + (task.deadline ? " · 截止 " + formatDateTime(task.deadline) : "")));
    const pill = make("span", "status-pill " + (task.kind === "event" ? "event" : isAdventure(task) ? "adventure" : "flexible"),
      task.kind === "event" ? "▣ 固定事项" : isAdventure(task) ? "✦ 奇遇 · " + timeLabel(task.deadline) + " 前" : "⇄ 可调整");
    row.append(make("span", "schedule-time", timeLabel(task.scheduledAt)), info, pill);
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
    row.append(info, button("继续整理", resumeDeferred, capture.id)); deferredHost.append(row);
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
  $("#todayLabel").textContent = (now.getMonth() + 1) + "月" + now.getDate() + "日";
  $("#weekdayLabel").textContent = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(now).replace("星期", "周");
  try {
    const lunar = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric" }).format(now);
    $("#lunarLabel").textContent = "农历" + lunar.replace(/(\d{1,2})日/, (_, raw) => {
      const day = Number(raw);
      const digits = "一二三四五六七八九";
      const name = day <= 10 ? "初" + (day === 10 ? "十" : digits[day - 1])
        : day < 20 ? "十" + digits[day - 11]
        : day === 20 ? "二十" : day < 30 ? "廿" + digits[day - 21] : "三十";
      return name + "日";
    });
  }
  catch { $("#lunarLabel").textContent = ""; }
  const weekday = now.getDay();
  $("#weekendLabel").textContent = weekday === 0 || weekday === 6 ? "周末进行中" : "距周末还有 " + (6 - weekday) + " 天";
  $("#reminderToggle").checked = state.quietReminders;
  setTheme(); renderNext(); renderSchedule(); renderJourneys(); renderTasks(); renderHistory();
}
function addField(card, label, type, value, onChange) {
  const wrap = make("label");
  wrap.append(make("span", "", label));
  const isSelect = type === "select" || type === "quest-select" || type === "priority-select";
  const input = make(isSelect ? "select" : "input");
  if (isSelect) {
    const options = type === "quest-select" ? [["normal", "短期任务"], ["main", "主线"], ["side", "支线"], ["daily", "每日任务"]] :
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
    addField(card, "截止或固定时间", "datetime-local", draft.time, (value) => draft.time = value);
    addField(card, "预计分钟", "number", draft.duration, (value) => draft.duration = value);
    const remove = button("移除", () => { drafts.splice(index, 1); renderDrafts(); });
    remove.className = "remove-draft";
    card.append(remove);
    if (draft.inferred) card.append(make("p", "draft-note", "部分时间或时长是初步推测，请核对。"));
    host.append(card);
  });
  $("#confirmDraftButton").disabled = drafts.length === 0;
  const totalMinutes = drafts.reduce((sum, item) => sum + Math.max(10, Number(item.duration) || 45), 0);
  $("#questSuggestion").textContent = "这次共整理出 " + drafts.length + " 件事，预计约 " + totalMinutes + " 分钟。请核对固定时间与截止时间；确认后会按已有安排重新排程，并为任务之间留出缓冲。";
  const lead = $("#questLead"); lead.replaceChildren();
  const first = drafts[0];
  if (first) {
    const icon = make("span", "quest-lead-icon", first.kind === "event" ? "▣" : "✉");
    const info = make("div"); info.append(make("strong", "", first.title));
    info.append(make("p", "", drafts.length > 1 ? "同时整理了另外 " + (drafts.length - 1) + " 件事。请在下方逐项核对。" : "先确认关键信息，再决定是否加入计划。"));
    lead.append(icon, info);
    const when = first.time ? new Date(first.time) : null;
    $("#questTiming").textContent = when && !Number.isNaN(when.getTime()) ? "◷ " + (first.kind === "event" ? "固定时间 · " : "截止前 · ") + formatDateTime(when) : "✦ 等待确认";
  } else $("#questTiming").textContent = "";
}
function startCapture(text = $("#captureInput").value) {
  if (!text.trim()) { $("#captureMessage").textContent = "先写下一件想处理的事。"; $("#captureInput").focus(); return 0; }
  captureText = text.trim();
  drafts = parseCapture(text).map((draft) => {
    const questType = inferredQuest(draft.title, draft.kind);
    return { ...draft, questType, priority: "auto", journeyName: ["main", "side"].includes(questType) ? inferredJourneyTitle(draft.title, questType) : "" };
  });
  renderDrafts();
  if (!$("#reviewSection").open) $("#reviewSection").showModal();
  $("#captureMessage").textContent = "整理出 " + drafts.length + " 件事。请检查关键时间，再加入计划。";
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
    if (!draft.title.trim()) { toast("有事项还没有名称，请补充或移除。"); return; }
    if (draft.kind === "event" && !draft.time) { toast("固定事项需要确认日期和时间。"); return; }
    const parsed = draft.time ? new Date(draft.time) : null;
    if (parsed && Number.isNaN(parsed.getTime())) { toast("请检查日期和时间。"); return; }
    if (draft.kind === "event" && parsed < new Date(Date.now() - 60000)) { toast("固定事项不能安排在过去。"); return; }
    const minutes = Math.max(10, Math.min(Number(draft.duration) || 45, 480));
    const time = parsed ? parsed.toISOString() : null;
    const questType = draft.kind === "event" ? "normal" : draft.questType;
    const journey = ["main", "side"].includes(questType) ? findOrCreateJourney(next, (draft.journeyName || "").trim() || inferredJourneyTitle(draft.title, questType), questType) : null;
    additions.push({ id: String(newId()), title: draft.title.trim().slice(0, 180), kind: draft.kind,
      status: "pending", estimateMinutes: minutes, remainingMinutes: minutes,
      plannedMinutes: Math.min(minutes, 90), createdAt: new Date().toISOString(),
      deadline: draft.kind === "task" && questType !== "daily" ? time : null, fixedAt: draft.kind === "event" ? time : null,
      notBefore: null, scheduledAt: null, questType, journeyId: journey?.id || null, priority: draft.priority || "auto", dailyLastCompleted: null, dailyHistory: [], dailyLastSkipped: null });
  }
  if (!additions.length) return;
  const fixed = state.tasks.filter((task) => task.status === "pending" && task.kind === "event").concat(additions.filter((task) => task.kind === "event"));
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
  proposed = { ...next, tasks: planTasks(next.tasks.concat(additions)) };
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
  } else { task.status = "done"; commit(next, "已完成。今天已经向前走了一步。"); }
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
  if (kind === "event" && (!parsed || parsed < new Date(Date.now() - 60000))) { toast("固定事项需要将来的准确时间。"); return; }
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
  const now = Date.now();
  for (const task of state.tasks) {
    if (task.status !== "pending" || !task.scheduledAt || isExpiredAdventure(task) || reminded.has(task.id)) continue;
    const minutes = new Date(task.scheduledAt).getTime() - now;
    if (minutes >= 0 && minutes <= 15 * 60000) {
      reminded.add(task.id);
      toast("快到时间了：" + task.title + "。可以按自己的节奏开始。");
      break;
    }
  }
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
$("#organizeButton").addEventListener("click", () => startCapture());
$("#discardDraftButton").addEventListener("click", () => { deferCurrentCapture(); $("#reviewSection").close(); });
$("#reviewSection").addEventListener("close", () => { if (drafts.length) deferCurrentCapture(); });
$("#confirmDraftButton").addEventListener("click", confirmDrafts);
$("#changesConfirmButton").addEventListener("click", applyProposal);
$("#changesCancelButton").addEventListener("click", () => { proposed = null; $("#changesDialog").close(); });
$("#settingsButton").addEventListener("click", () => $("#settingsDialog").showModal());
$("#themeSelect").addEventListener("change", (event) => { localStorage.setItem("rixu.theme", event.target.value); setTheme(); });
$("#scheduleMoreButton").addEventListener("click", () => setView("schedule"));
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
$("#restoreButton").addEventListener("click", () => {
  if (!undo) return;
  state = undo; undo = null; save(); render(); toast("已撤销上一步。");
});
$("#exportButton").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ version: 2, ...state }, null, 2)], { type: "application/json" });
  const link = make("a"); link.href = URL.createObjectURL(blob);
  link.download = "日序备份-" + dayKey(new Date()) + ".json"; link.click();
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
      quietReminders: data.quietReminders !== false }), "备份已导入。");
    $("#settingsDialog").close();
  } catch { toast("无法读取备份文件。"); }
  event.target.value = "";
});
$("#clearButton").addEventListener("click", () => {
  if (!confirm("确定清空本机所有日序事项吗？")) return;
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
  recognition.continuous = false;
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
    if (typeof SpeechRecognition.available === "function") {
      const status = await SpeechRecognition.available({ langs: ["zh-CN"], processLocally: true }).catch(() => "unavailable");
      if (status === "available") recognition.processLocally = true;
    }
    voiceState(true, "正在听，请说出要处理的事情；再次点按钮可结束。");
    recognition.start();
    watchdog = setTimeout(() => { if (activeRecognition === recognition) recognition.stop(); }, 20000);
  } catch {
    clearTimeout(watchdog);
    activeRecognition = null;
    voiceState(false, "无法启动语音识别，可用手机键盘麦克风口述。");
  }
});
function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const definitions = [
    { name: "start_task_capture", title: "整理事项草稿", description: "拆分用户输入并展示待确认草稿，不直接加入计划。",
      inputSchema: { type: "object", properties: { text: { type: "string", minLength: 1 } }, required: ["text"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute(input) { if (!input || typeof input.text !== "string" || !input.text.trim()) throw new Error("请输入事项文本"); $("#captureInput").value = input.text; return { status: "awaiting_confirmation", draftCount: startCapture(input.text) }; } },
    { name: "read_near_term_plan", title: "查看近期计划", description: "读取已确认的近期安排。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute() { return { tasks: state.tasks.filter((task) => task.status === "pending").map((task) => ({ title: task.title, scheduledAt: task.scheduledAt, deadline: task.deadline })) }; } }
  ];
  for (const definition of definitions) Promise.resolve(context.registerTool(definition)).catch(() => {});
}
setView(location.hash.slice(1) || "today", false);
render(); checkReminders(); setInterval(() => { render(); checkReminders(); }, 60000); registerWebMcp();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
