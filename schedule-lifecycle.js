export function scheduleStart(task) {
  const value = task.kind === "event" ? task.fixedAt || task.scheduledAt : task.scheduledAt;
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
}

export function scheduleEnd(task) {
  const start = scheduleStart(task);
  if (task.kind === "event") return start === null ? null : start + (Number(task.estimateMinutes) || 45) * 60000;
  if (task.deadline) {
    const deadline = new Date(task.deadline).getTime();
    if (Number.isFinite(deadline)) return deadline;
  }
  return start === null ? null : start + (Number(task.plannedMinutes) || Number(task.estimateMinutes) || 45) * 60000;
}

export function scheduleEndLabel(task) {
  return task.kind === "event" ? "结束" : task.deadline ? "截止" : "本段结束";
}

export function nextScheduleReminder(tasks, seen, now = Date.now()) {
  const candidates = [];
  for (const task of tasks) {
    if (task.status !== "pending" || task.questType === "daily") continue;
    const start = scheduleStart(task);
    const end = scheduleEnd(task);
    if (start !== null) {
      const lead = task.priority === "high" ? 60 : 15;
      const minutes = (start - now) / 60000;
      const key = `${task.id}:start:${start}`;
      if (minutes >= 0 && minutes <= lead && !seen.has(key)) candidates.push({ task, kind: "start", minutes, key });
    }
    if (end !== null && end > (start ?? -Infinity)) {
      const minutes = (end - now) / 60000;
      const key = `${task.id}:end:${end}`;
      if (minutes >= -5 && minutes <= 10 && !seen.has(key)) candidates.push({ task, kind: "end", minutes, key });
    }
  }
  return candidates.sort((a, b) => (a.minutes < 0 ? 0 : a.minutes) - (b.minutes < 0 ? 0 : b.minutes) || (a.kind === "end" ? 0 : 1) - (b.kind === "end" ? 0 : 1))[0] || null;
}
