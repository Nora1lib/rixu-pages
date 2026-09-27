import { dayKey, formatDateTime, timeLabel } from "./planner.js";

const labels = { main: "主线", side: "支线", daily: "每日", normal: "短期任务", adventure: "奇遇任务" };
const make = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
};

function adventure(task, now) {
  const deadline = task.deadline && new Date(task.deadline).getTime();
  return task.kind === "task" && task.questType === "adventure" && task.status === "pending" && deadline && deadline >= now;
}

function quest(task, journeys) {
  if (task.kind === "event") return "固定事项";
  const journey = journeys.find((item) => item.id === task.journeyId);
  return journey ? `${labels[journey.kind]} · ${journey.title}` : labels[task.questType] || labels.normal;
}

export function renderScheduleView({ tasks, journeys, list, dailyList, workSummary, fullView = false, onDailyToggle, now = new Date() }) {
  const current = now.getTime();
  const horizon = current + (fullView ? 7 * 24 : 72) * 3600000;
  const items = tasks.filter((task) => task.status === "pending" && task.scheduledAt &&
    !(task.kind === "task" && task.questType === "adventure" && task.deadline && new Date(task.deadline).getTime() < current) &&
    task.questType !== "daily" && new Date(task.scheduledAt).getTime() <= horizon)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  if (!fullView) items.splice(3);

  list.replaceChildren();
  if (!items.length) list.append(make("div", "empty-state", "近期还没有安排。固定事项和可调整任务会显示在这里。"));
  let currentDay = "";
  let group;
  for (const task of items) {
    const key = dayKey(task.scheduledAt);
    if (key !== currentDay) {
      currentDay = key;
      group = make("div", "schedule-day");
      const date = new Date(key + "T12:00:00");
      group.append(make("div", "day-label", new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(date)));
      list.append(group);
    }
    const isAdventure = adventure(task, current);
    const kind = task.kind === "event" ? "event" : isAdventure ? "adventure" : "flexible";
    const row = make("div", "schedule-item " + kind);
    const info = make("div");
    info.append(make("div", "schedule-title", task.title));
    const detail = task.kind === "event" ? "已保护的固定时间" : quest(task, journeys) + " · 预计 " + task.plannedMinutes + " 分钟";
    info.append(make("div", "schedule-detail", detail + (task.deadline ? " · 截止 " + formatDateTime(task.deadline) : "")));
    const pill = make("span", "status-pill " + kind,
      task.kind === "event" ? "▣ 固定事项" : isAdventure ? "✦ 奇遇 · " + timeLabel(task.deadline) + " 前" : "⇄ 可调整");
    row.append(make("span", "schedule-time", timeLabel(task.scheduledAt)), info, pill);
    group.append(row);
  }

  const today = dayKey(now);
  const workMinutes = tasks.filter((task) => task.status === "pending" && task.scheduledAt && dayKey(task.scheduledAt) === today &&
    task.questType !== "daily" && !/聚餐|散步|休息|娱乐|旅行/.test(task.title))
    .reduce((sum, task) => sum + task.plannedMinutes, 0);
  const hours = workMinutes ? (Math.ceil(workMinutes / 30) / 2).toString() : "0";
  const urgent = tasks.filter((task) => adventure(task, current) && task.deadline && new Date(task.deadline).getTime() <= current + 24 * 3600000).length;
  const level = workMinutes || urgent ? Math.max(1, Math.min(5, Math.ceil(workMinutes / 75) + (urgent ? 1 : 0))) : 0;
  workSummary.replaceChildren();
  workSummary.append(make("span", "", level ? "预计工作 " + hours + " 小时" : "今日空闲"));
  if (level) {
    const mangoes = make("span", "mango-strip level-" + level);
    mangoes.setAttribute("role", "img");
    mangoes.setAttribute("aria-label", "忙碌度 " + level + "/5");
    for (let i = 0; i < level; i++) {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", "#i-mango"); icon.append(use); mangoes.append(icon);
    }
    workSummary.append(mangoes);
  }
  const explanation = level ? "今天预计工作约 " + hours + " 小时，临近截止的奇遇任务 " + urgent + " 件，忙碌度为 " + level + "/5。建议保留任务之间的缓冲时间；忙碌时可把支线顺延。" : "今天还没有已安排的工作或临近截止任务。忙碌度暂不评级。";

  dailyList.replaceChildren();
  for (const task of tasks.filter((item) => item.status === "pending" && item.questType === "daily")) {
    const skipped = task.dailyLastSkipped === today;
    const done = task.dailyHistory?.includes(today) || task.dailyLastCompleted === today;
    const row = make("label", "daily-item" + (skipped ? " skipped" : ""));
    const check = make("input"); check.type = "checkbox"; check.checked = Boolean(done);
    check.addEventListener("change", () => onDailyToggle(task.id));
    row.append(check, make("span", "", "每日 · " + task.title + (skipped ? "（今天先略过）" : "")));
    dailyList.append(row);
  }
  return { explanation, shown: items.length, total: tasks.length };
}
