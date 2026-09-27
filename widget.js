const KEY = "rixu.web.v1";
const $ = (selector) => document.querySelector(selector);
const native = Boolean(window.webkit?.messageHandlers?.rixu);
const labels = { main: "主线", side: "支线", daily: "每日任务", normal: "短期任务", adventure: "奇遇任务" };

function openFull(text = "") {
  if (native) window.webkit.messageHandlers.rixu.postMessage({ action: "openFull", text });
  else location.href = "./index.html" + (text ? "?capture=" + encodeURIComponent(text) : "");
}

function active(task, now) {
  if (!task || task.status !== "pending") return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (task.questType === "daily" && (task.dailyHistory?.includes(dayKey) || task.dailyLastCompleted === dayKey || task.dailyLastSkipped === dayKey)) return false;
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

function render() {
  const now = new Date();
  const day = now.getHours() >= 6 && now.getHours() < 18;
  document.body.dataset.theme = day ? "day" : "night";
  $("#skyIcon").textContent = day ? "☀️" : "🌙";
  $("#dateLabel").textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(now).replace("星期", "周")}`;
  $("#dateHint").textContent = day ? "远足中的每一步都有方向" : "在营火旁理清下一步";
  let tasks = [];
  try { tasks = JSON.parse(localStorage.getItem(KEY))?.tasks || []; } catch { /* Keep an empty view. */ }
  const current = tasks.filter((task) => active(task, now)).sort((a, b) => score(b, now.getTime()) - score(a, now.getTime()))[0];
  $("#currentHeading").textContent = current?.title || "从一件小事开始";
  $("#currentMeta").textContent = current ? `${current.kind === "event" ? "固定事项" : labels[current.questType] || "短期任务"} · ${current.priority === "high" ? "高优先级" : current.priority === "medium" ? "中优先级" : "下一步"} · ${Number(current.plannedMinutes) || Number(current.estimateMinutes) || 45} 分钟` : "打开日序，写下你想推进的事。";
  const next = tasks.filter((task) => active(task, now) && task.id !== current?.id && (task.scheduledAt || task.fixedAt))
    .sort((a, b) => new Date(a.scheduledAt || a.fixedAt) - new Date(b.scheduledAt || b.fixedAt))[0];
  $("#nextHeading").textContent = next?.title || "还没有安排";
  $("#nextTime").textContent = next ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(next.scheduledAt || next.fixedAt)) : "";
}

document.body.dataset.native = String(native);
$("#openFullButton").addEventListener("click", () => openFull());
$("#quickForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("#quickInput").value.trim();
  if (text) { openFull(text); $("#quickInput").value = ""; }
});
$("#pinButton").addEventListener("click", () => { if (native) window.webkit.messageHandlers.rixu.postMessage({ action: "togglePin" }); });
window.addEventListener("storage", render);
window.addEventListener("focus", render);
render(); setInterval(render, 15000);
