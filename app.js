import { parseCapture, planTasks, formatDateTime, dayKey, timeLabel } from "./planner.js";

const $ = (selector) => document.querySelector(selector);
const KEY = "rixu.web.v1";
const clone = (value) => JSON.parse(JSON.stringify(value));
const newId = () => crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random();
const defaults = () => ({ tasks: [], captures: [], quietReminders: true });
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
function isAdventure(task) {
  const deadline = task.deadline && new Date(task.deadline).getTime();
  return task.kind === "task" && task.status === "pending" && deadline && deadline >= Date.now() && deadline <= Date.now() + 36 * 3600000;
}
function priorityOf(task) { return isAdventure(task) || task.questType === "main" ? "高优先级" : task.questType === "side" ? "中优先级" : "常规优先级"; }
function questOf(task) { return task.kind === "event" ? "固定事项" : (questLabels[task.questType] || questLabels.normal); }
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
    questType: ["main", "side", "daily", "normal"].includes(item.questType) ? item.questType : inferredQuest(item.title, item.kind)
  };
}
function normalizeCapture(item) {
  if (!item || typeof item.text !== "string" || !item.text.trim()) return null;
  return { id: typeof item.id === "string" ? item.id : String(newId()),
    text: item.text.slice(0, 4000), createdAt: dateValue(item.createdAt) || new Date().toISOString() };
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw || !Array.isArray(raw.tasks)) return defaults();
    return { tasks: raw.tasks.map(normalize).filter(Boolean),
      captures: Array.isArray(raw.captures) ? raw.captures.map(normalizeCapture).filter(Boolean).slice(-200) : [],
      quietReminders: raw.quietReminders !== false };
  } catch { return defaults(); }
}
let state = load();
let drafts = [];
let undo = null;
let proposed = null;
let captureText = "";
let toastTimer;
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
  state = { tasks: planTasks(next.tasks), captures: next.captures || [], quietReminders: next.quietReminders };
  save(); render(); toast(message);
}
function button(text, action, taskId) {
  const node = make("button", "", text);
  node.type = "button";
  node.addEventListener("click", () => action(taskId));
  return node;
}
function renderNext() {
  const pending = state.tasks.filter((task) => task.status === "pending");
  const ordered = pending.filter((task) => task.scheduledAt).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const task = ordered[0] || pending[0];
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
  content.append(make("p", "next-explain", task.scheduledAt ? "安排在 " + formatDateTime(task.scheduledAt) : "暂时没有合适时段，请调整截止时间或现有安排"));
  actions.append(button(task.remainingMinutes > task.plannedMinutes ? "完成这一段" : "完成这件事", completeTask, task.id));
  if (task.kind === "task") actions.append(button("稍后再做", deferTask, task.id));
  actions.hidden = false;
}
function renderSchedule() {
  const items = state.tasks.filter((task) => task.status === "pending" && task.scheduledAt &&
    task.questType !== "daily" && new Date(task.scheduledAt).getTime() <= Date.now() + 72 * 3600000)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const host = $("#scheduleList");
  host.replaceChildren();
  if (!items.length) {
    host.append(make("div", "empty-state", "未来 72 小时还没有安排。"));
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
    const row = make("div", "schedule-item");
    const info = make("div");
    info.append(make("div", "schedule-title", task.title));
    const detail = task.kind === "event" ? "已保护的固定时间" : questOf(task) + " · 预计 " + task.plannedMinutes + " 分钟";
    info.append(make("div", "schedule-detail", detail + (task.deadline ? " · 截止 " + formatDateTime(task.deadline) : "")));
    const pill = make("span", "status-pill " + (task.kind === "event" ? "event" : isAdventure(task) ? "adventure" : "flexible"),
      task.kind === "event" ? "▣ 固定事项" : isAdventure(task) ? "✦ 奇遇 · 临近截止" : "⇄ 可调整");
    row.append(make("span", "schedule-time", timeLabel(task.scheduledAt)), info, pill);
    group.append(row);
  }
  const todayKey = dayKey(new Date());
  const workMinutes = state.tasks.filter((task) => task.status === "pending" && task.scheduledAt && dayKey(task.scheduledAt) === todayKey && task.questType !== "daily" && !/聚餐|散步|休息|娱乐|旅行/.test(task.title))
    .reduce((sum, task) => sum + task.plannedMinutes, 0);
  const hours = workMinutes ? (Math.round(workMinutes / 30) / 2).toString() : "0";
  const level = workMinutes ? Math.max(1, Math.min(5, Math.ceil(workMinutes / 75))) : 0;
  const summary = $("#workSummary"); summary.replaceChildren();
  summary.append(make("span", "", "预计工作 " + hours + " 小时"));
  if (level) {
    const mangoes = make("span", "mango-strip level-" + level);
    mangoes.setAttribute("role", "img"); mangoes.setAttribute("aria-label", "忙碌度 " + level + "/5");
    for (let i = 0; i < level; i++) {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", "#i-mango"); icon.append(use); mangoes.append(icon);
    }
    summary.append(mangoes);
  }
  const daily = $("#dailyList"); daily.replaceChildren();
  for (const task of state.tasks.filter((item) => item.status === "pending" && item.questType === "daily")) {
    const row = make("label", "daily-item");
    const check = make("input"); check.type = "checkbox"; check.addEventListener("change", () => completeTask(task.id));
    row.append(check, make("span", "", "每日 · " + task.title)); daily.append(row);
  }
}
function renderJourneys() {
  const host = $("#journeyList"); host.replaceChildren();
  const tasks = state.tasks.filter((task) => task.kind === "task" && ["main", "side"].includes(task.questType));
  if (!tasks.length) { host.append(make("div", "journey-empty", "长期目标会显示在这里。整理任务时可将它归入主线或支线。")); return; }
  for (const type of ["main", "side"]) for (const task of tasks.filter((item) => item.questType === type)) {
    const card = make("article", "journey-card");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", type === "main" ? "#i-mountain" : "#i-sprout"); icon.append(use);
    const info = make("div");
    info.append(make("h3", "", questLabels[type] + "｜" + task.title));
    const done = task.status === "done" ? task.estimateMinutes : Math.max(0, task.estimateMinutes - task.remainingMinutes);
    const percent = Math.round(done / task.estimateMinutes * 100);
    info.append(make("p", "quest-label", task.status === "done" ? "已完成" : "已推进 " + percent + "%"));
    const progress = make("div", "journey-progress"); const fill = make("span"); fill.style.width = percent + "%"; progress.append(fill); info.append(progress);
    info.append(make("p", "", task.status === "done" ? "这段旅程已经完成" : task.scheduledAt ? "下一步：" + formatDateTime(task.scheduledAt) : "下一步：等待安排"));
    card.append(icon, info); host.append(card);
  }
}
function renderTasks() {
  const pending = state.tasks.filter((task) => task.status === "pending");
  const completed = state.tasks.length - pending.length;
  $("#taskCount").textContent = pending.length + " 待处理" + (completed ? " · " + completed + " 已完成" : "");
  $("#restoreButton").hidden = !undo;
  const host = $("#taskList");
  host.replaceChildren();
  if (!pending.length) {
    host.append(make("div", "empty-state", completed ? "当前事项已处理完。需要时可以继续写下新安排。" : "没有待处理事项。"));
    return;
  }
  for (const task of pending) {
    const row = make("div", "task-row");
    const check = make("input", "task-check");
    check.type = "checkbox";
    check.setAttribute("aria-label", (task.remainingMinutes > task.plannedMinutes ? "完成这一段 " : "完成 ") + task.title);
    check.addEventListener("change", () => completeTask(task.id));
    const main = make("div", "task-main");
    main.append(make("div", "task-title", task.title));
    let meta = questOf(task) + " · " + (task.scheduledAt ? "安排在 " + formatDateTime(task.scheduledAt) : "待安排");
    if (task.deadline && !task.scheduledAt) meta += " · 截止前时间不足，请调整";
    if (task.remainingMinutes > task.plannedMinutes) meta += " · 还需约 " + task.remainingMinutes + " 分钟";
    main.append(make("div", "task-meta", meta));
    const actions = make("div", "task-actions");
    actions.append(button("修改", editTask, task.id), button("顺延", deferTask, task.id), button("删除", deleteTask, task.id));
    row.append(check, main, actions); host.append(row);
  }
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
function render() {
  const now = new Date();
  $("#todayLabel").textContent = (now.getMonth() + 1) + "月" + now.getDate() + "日";
  $("#weekdayLabel").textContent = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(now).replace("星期", "周");
  try { $("#lunarLabel").textContent = "农历" + new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric" }).format(now); }
  catch { $("#lunarLabel").textContent = ""; }
  const weekday = now.getDay();
  $("#weekendLabel").textContent = weekday === 0 || weekday === 6 ? "周末进行中" : "距周末还有 " + (6 - weekday) + " 天";
  $("#reminderToggle").checked = state.quietReminders;
  setTheme(); renderNext(); renderSchedule(); renderJourneys(); renderTasks(); renderHistory();
}
function addField(card, label, type, value, onChange) {
  const wrap = make("label");
  wrap.append(make("span", "", label));
  const isSelect = type === "select" || type === "quest-select";
  const input = make(isSelect ? "select" : "input");
  if (isSelect) {
    const options = type === "quest-select" ? [["normal", "短期任务"], ["main", "主线"], ["side", "支线"], ["daily", "每日任务"]] : [["task", "可调整任务"], ["event", "固定事项"]];
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
    addField(card, "截止或固定时间", "datetime-local", draft.time, (value) => draft.time = value);
    addField(card, "预计分钟", "number", draft.duration, (value) => draft.duration = value);
    const remove = button("移除", () => { drafts.splice(index, 1); renderDrafts(); });
    remove.className = "remove-draft";
    card.append(remove);
    if (draft.inferred) card.append(make("p", "draft-note", "部分时间或时长是初步推测，请核对。"));
    host.append(card);
  });
  $("#confirmDraftButton").disabled = drafts.length === 0;
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
  drafts = parseCapture(text).map((draft) => ({ ...draft, questType: inferredQuest(draft.title, draft.kind) }));
  renderDrafts();
  if (!$("#reviewSection").open) $("#reviewSection").showModal();
  $("#captureMessage").textContent = "整理出 " + drafts.length + " 件事。请检查关键时间，再加入计划。";
  return drafts.length;
}
function applyProposal() {
  if (!proposed) return;
  const count = drafts.length;
  const next = { ...proposed, captures: proposed.captures.concat({ id: String(newId()), text: captureText, createdAt: new Date().toISOString() }).slice(-200) };
  commit(next, "已加入 " + count + " 件事。你可以随时撤销。");
  drafts = []; proposed = null; captureText = "";
  if ($("#reviewSection").open) $("#reviewSection").close();
  $("#captureInput").value = "";
  $("#captureMessage").textContent = "内容只保存在当前设备。安排前，你可以逐项确认。";
  if ($("#changesDialog").open) $("#changesDialog").close();
}
function confirmDrafts() {
  const additions = [];
  for (const draft of drafts) {
    if (!draft.title.trim()) { toast("有事项还没有名称，请补充或移除。"); return; }
    if (draft.kind === "event" && !draft.time) { toast("固定事项需要确认日期和时间。"); return; }
    const parsed = draft.time ? new Date(draft.time) : null;
    if (parsed && Number.isNaN(parsed.getTime())) { toast("请检查日期和时间。"); return; }
    if (draft.kind === "event" && parsed < new Date(Date.now() - 60000)) { toast("固定事项不能安排在过去。"); return; }
    const minutes = Math.max(10, Math.min(Number(draft.duration) || 45, 480));
    const time = parsed ? parsed.toISOString() : null;
    additions.push({ id: String(newId()), title: draft.title.trim().slice(0, 180), kind: draft.kind,
      status: "pending", estimateMinutes: minutes, remainingMinutes: minutes,
      plannedMinutes: Math.min(minutes, 90), createdAt: new Date().toISOString(),
      deadline: draft.kind === "task" ? time : null, fixedAt: draft.kind === "event" ? time : null,
      notBefore: null, scheduledAt: null, questType: draft.kind === "event" ? "normal" : draft.questType });
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
  proposed = { ...state, tasks: planTasks(state.tasks.concat(additions)) };
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
  if (task.kind === "task" && task.remainingMinutes > task.plannedMinutes) {
    task.remainingMinutes -= task.plannedMinutes;
    task.notBefore = new Date(Date.now() + 15 * 60000).toISOString();
    commit(next, "完成一段，还剩约 " + task.remainingMinutes + " 分钟。");
  } else { task.status = "done"; commit(next, "已完成。今天已经向前走了一步。"); }
}
function deferTask(taskId) {
  const next = clone(state), task = next.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== "pending") return;
  if (task.kind === "event") { toast("固定事项需要手动确认新时间。"); return; }
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
  task.notBefore = tomorrow.toISOString();
  commit(next, "已尝试顺延到明天；如时间不足，会显示为待安排。");
}
function editTask(taskId) {
  const next = clone(state), task = next.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const title = prompt("修改事项名称", task.title);
  if (title === null) return;
  if (!title.trim()) { toast("事项名称不能为空。"); return; }
  const current = task.kind === "event" ? task.fixedAt : task.deadline;
  const local = current ? new Date(new Date(current).getTime() - new Date(current).getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace("T", " ") : "";
  const input = prompt(task.kind === "event" ? "固定时间（格式：2026-09-26 15:00）" : "截止时间（可留空，格式：2026-09-26 15:00）", local);
  if (input === null) return;
  const parsed = input.trim() ? new Date(input.trim().replace(" ", "T")) : null;
  if (input.trim() && Number.isNaN(parsed.getTime())) { toast("时间格式不正确，修改未保存。"); return; }
  if (task.kind === "event" && !parsed) { toast("固定事项需要时间。"); return; }
  if (task.kind === "event" && parsed < new Date(Date.now() - 60000)) { toast("固定事项不能安排在过去。"); return; }
  if (task.kind === "event" && next.tasks.some((other) => other.id !== task.id && other.status === "pending" && other.kind === "event" &&
    parsed.getTime() < new Date(other.fixedAt).getTime() + other.estimateMinutes * 60000 &&
    new Date(other.fixedAt).getTime() < parsed.getTime() + task.estimateMinutes * 60000)) {
    toast("固定事项时间冲突，修改未保存。"); return;
  }
  task.title = title.trim().slice(0, 180);
  if (task.kind === "event") task.fixedAt = parsed.toISOString();
  else task.deadline = parsed ? parsed.toISOString() : null;
  commit(next, "事项已更新。");
}
function deleteTask(taskId) {
  const next = clone(state); next.tasks = next.tasks.filter((task) => task.id !== taskId);
  commit(next, "事项已删除，可撤销。");
}
function checkReminders() {
  if (!state.quietReminders || document.visibilityState !== "visible") return;
  const now = Date.now();
  for (const task of state.tasks) {
    if (task.status !== "pending" || !task.scheduledAt || reminded.has(task.id)) continue;
    const minutes = new Date(task.scheduledAt).getTime() - now;
    if (minutes >= 0 && minutes <= 15 * 60000) {
      reminded.add(task.id);
      toast("快到时间了：" + task.title + "。可以按自己的节奏开始。");
      break;
    }
  }
}
$("#organizeButton").addEventListener("click", () => startCapture());
$("#discardDraftButton").addEventListener("click", () => { drafts = []; $("#reviewSection").close(); });
$("#confirmDraftButton").addEventListener("click", confirmDrafts);
$("#changesConfirmButton").addEventListener("click", applyProposal);
$("#changesCancelButton").addEventListener("click", () => { proposed = null; $("#changesDialog").close(); });
$("#settingsButton").addEventListener("click", () => $("#settingsDialog").showModal());
$("#themeSelect").addEventListener("change", (event) => { localStorage.setItem("rixu.theme", event.target.value); setTheme(); });
$("#scheduleMoreButton").addEventListener("click", () => $("#inbox").scrollIntoView({ behavior: "smooth" }));
for (const item of document.querySelectorAll(".bottom-nav a")) item.addEventListener("click", () => {
  document.querySelectorAll(".bottom-nav a").forEach((link) => link.classList.toggle("active", link === item));
});
$("#reminderToggle").addEventListener("change", (event) => {
  state.quietReminders = event.target.checked; save();
  toast(event.target.checked ? "已开启安静提醒。" : "已关闭提醒。");
});
$("#restoreButton").addEventListener("click", () => {
  if (!undo) return;
  state = undo; undo = null; save(); render(); toast("已撤销上一步。");
});
$("#exportButton").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ version: 1, ...state }, null, 2)], { type: "application/json" });
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
    commit({ tasks: data.tasks.map(normalize),
      captures: Array.isArray(data.captures) ? data.captures.map(normalizeCapture).filter(Boolean).slice(-200) : [],
      quietReminders: data.quietReminders !== false }, "备份已导入。");
    $("#settingsDialog").close();
  } catch { toast("无法读取备份文件。"); }
  event.target.value = "";
});
$("#clearButton").addEventListener("click", () => {
  if (!confirm("确定清空本机所有日序事项吗？")) return;
  commit(defaults(), "本机数据已清空，可在本次会话中撤销。");
  $("#settingsDialog").close();
});
$("#voiceButton").addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { $("#captureMessage").textContent = "当前浏览器不支持语音转写，可以直接输入文字。"; return; }
  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN"; recognition.interimResults = false;
  $("#captureMessage").textContent = "正在听，请说出要处理的事情。";
  recognition.onresult = (event) => {
    const spoken = event.results?.[0]?.[0]?.transcript?.trim();
    if (spoken) $("#captureInput").value = [$("#captureInput").value.trim(), spoken].filter(Boolean).join("；");
    if (spoken) startCapture($("#captureInput").value);
  };
  recognition.onerror = () => $("#captureMessage").textContent = "语音输入没有成功，可以重试或直接输入文字。";
  recognition.start();
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
render(); checkReminders(); setInterval(() => { checkReminders(); setTheme(); }, 60000); registerWebMcp();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
