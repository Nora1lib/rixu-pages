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
    notBefore: dateValue(item.notBefore), scheduledAt: dateValue(item.scheduledAt)
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
    const title = make("h2", "", "先从一件小事开始"); title.id = "nextTitle";
    content.append(title, make("p", "", "写下你最近要处理的事，日序会帮你理出可执行的第一步。"));
    actions.hidden = true; return;
  }
  content.append(make("p", "next-meta", task.scheduledAt ? "建议从这里开始" : "需要你决定"));
  const title = make("h2", "", task.title); title.id = "nextTitle";
  content.append(title);
  content.append(make("p", "", task.scheduledAt ? formatDateTime(task.scheduledAt) + " · " + task.plannedMinutes + " 分钟" : "暂时没有合适时段，请调整截止时间或现有安排"));
  actions.append(button(task.remainingMinutes > task.plannedMinutes ? "完成这一段" : "完成这件事", completeTask, task.id));
  actions.append(button("明天再做", deferTask, task.id));
  actions.hidden = false;
}
function renderSchedule() {
  const items = state.tasks.filter((task) => task.status === "pending" && task.scheduledAt &&
    new Date(task.scheduledAt).getTime() <= Date.now() + 72 * 3600000)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  $("#planCount").textContent = items.length + " 项";
  const host = $("#scheduleList");
  host.replaceChildren();
  if (!items.length) {
    host.append(make("div", "empty-state", "还没有安排。写下一件事，计划就从这里展开。"));
    return;
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
    const detail = task.kind === "event" ? "固定事项" : "先做 " + task.plannedMinutes + " 分钟";
    info.append(make("div", "schedule-detail", detail + (task.deadline ? " · 截止 " + formatDateTime(task.deadline) : "")));
    row.append(make("span", "schedule-time", timeLabel(task.scheduledAt)), info);
    group.append(row);
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
    let meta = task.scheduledAt ? "安排在 " + formatDateTime(task.scheduledAt) : "待安排";
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
  $("#todayLabel").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  $("#reminderToggle").checked = state.quietReminders;
  renderNext(); renderSchedule(); renderTasks(); renderHistory();
}
function addField(card, label, type, value, onChange) {
  const wrap = make("label");
  wrap.append(make("span", "", label));
  const input = make(type === "select" ? "select" : "input");
  if (type === "select") {
    for (const [key, title] of [["task", "可调整任务"], ["event", "固定事项"]]) {
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
    addField(card, "截止或固定时间", "datetime-local", draft.time, (value) => draft.time = value);
    addField(card, "预计分钟", "number", draft.duration, (value) => draft.duration = value);
    const remove = button("移除", () => { drafts.splice(index, 1); renderDrafts(); });
    remove.className = "remove-draft";
    card.append(remove);
    if (draft.inferred) card.append(make("p", "draft-note", "部分时间或时长是初步推测，请核对。"));
    host.append(card);
  });
  $("#confirmDraftButton").disabled = drafts.length === 0;
}
function startCapture(text = $("#captureInput").value) {
  if (!text.trim()) { $("#captureMessage").textContent = "先写下一件想处理的事。"; $("#captureInput").focus(); return 0; }
  captureText = text.trim();
  drafts = parseCapture(text);
  renderDrafts();
  $("#reviewSection").hidden = false;
  $("#captureMessage").textContent = "整理出 " + drafts.length + " 件事。请检查关键时间，再加入计划。";
  $("#reviewSection").scrollIntoView({ behavior: "smooth", block: "start" });
  return drafts.length;
}
function applyProposal() {
  if (!proposed) return;
  const count = drafts.length;
  const next = { ...proposed, captures: proposed.captures.concat({ id: String(newId()), text: captureText, createdAt: new Date().toISOString() }).slice(-200) };
  commit(next, "已加入 " + count + " 件事。你可以随时撤销。");
  drafts = []; proposed = null; captureText = "";
  $("#reviewSection").hidden = true;
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
      notBefore: null, scheduledAt: null });
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
$("#discardDraftButton").addEventListener("click", () => { drafts = []; $("#reviewSection").hidden = true; });
$("#confirmDraftButton").addEventListener("click", confirmDrafts);
$("#changesConfirmButton").addEventListener("click", applyProposal);
$("#changesCancelButton").addEventListener("click", () => { proposed = null; $("#changesDialog").close(); });
$("#settingsButton").addEventListener("click", () => $("#settingsDialog").showModal());
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
    $("#captureMessage").textContent = "已转成文字。请检查后点击“整理并安排”。";
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
render(); checkReminders(); setInterval(checkReminders, 60000); registerWebMcp();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
