import { isProtected, isDaily, setSession, clearSession } from './schedule-domain.js';
import { previewScheduleChange, formatDateTime } from "./planner.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const localInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const labelTime = (value) => value ? formatDateTime(value) : "待安排";

export function createScheduleController({ getTasks, saveTasks, onComplete, getData }) {
  const dialog = document.createElement("dialog");
  dialog.className = "schedule-adjust-dialog";
  dialog.innerHTML = `<div class="schedule-adjust-shell">
    <div class="schedule-adjust-head"><h2>调整日程</h2><button type="button" class="schedule-close" aria-label="关闭">×</button></div>
    <p class="schedule-adjust-lead"></p>
    <div class="schedule-fields">
      <label>安排方式<select class="schedule-mode"><option value="auto">自动安排</option><option value="exact">指定时间</option></select></label>
      <label>名称<input class="schedule-task-title" maxlength="180"></label>
      <label>开始时间<input class="schedule-time-input" type="datetime-local"></label>
      <label>本段结束<input class="schedule-end-input" type="datetime-local"></label>
      <label>预计总工作量（分钟）<input class="schedule-minutes" type="number" min="10" max="480" step="5"></label>
      <label>优先级<select class="schedule-priority"><option value="auto">自动</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
      <label class="schedule-deadline-label">截止时间<input class="schedule-deadline" type="datetime-local"></label>
      <label>所属旅程<select class="schedule-journey"></select></label>
      <label>重复<select class="schedule-recurrence"><option value="once">一次性</option><option value="daily">每日</option></select></label>
      <label>紧急程度<select class="schedule-urgency"><option value="normal">普通</option><option value="urgent">今天内紧急</option></select></label>
      <label>锁定安排<input class="schedule-locked" type="checkbox"></label>
      <label class="schedule-protected-label">明确修改固定／锁定时间<input class="schedule-allow-protected" type="checkbox"></label>
    </div>
    <div class="schedule-impact"><strong>自动调整预览</strong><div class="schedule-impact-list"></div></div>
    <p class="schedule-adjust-error" role="alert"></p>
    <div class="schedule-adjust-actions"><button type="button" class="schedule-preview">预览调整</button><button type="button" class="schedule-confirm" disabled>确认安排</button></div>
  </div>`;
  document.body.append(dialog);
  const $ = (selector) => dialog.querySelector(selector);
  let base = [];
  let signature = "";
  let selectedId = "";
  let proposal = null;
  let mode = "edit";
  let sourceId = "";
  let targetId = "";
  let placeAfter = false;

  function prepare() {
    base = clone(getTasks());
    signature = JSON.stringify(base);
    proposal = null;
    $(".schedule-confirm").disabled = true;
    $(".schedule-adjust-error").textContent = "";
    $(".schedule-impact-list").replaceChildren();
  }

  function showChanges(result) {
    const host = $(".schedule-impact-list"); host.replaceChildren();
    if (result.error) {
      $(".schedule-adjust-error").textContent = result.error;
      $(".schedule-confirm").disabled = true;
      proposal = null;
      return;
    }
    $(".schedule-adjust-error").textContent = "";
    proposal = result.tasks;
    $(".schedule-confirm").disabled = false;
    if (!result.changes.length) {
      const line = document.createElement("p"); line.textContent = "这次调整没有改变已排定的时间；修改的设置仍会保存。"; host.append(line);
    }
    for (const change of result.changes) {
      const line = document.createElement("p");
      line.textContent = `${change.task.title}：${labelTime(change.from)}–${labelTime(change.fromEnd)} → ${labelTime(change.to)}–${labelTime(change.toEnd)}`;
      host.append(line);
    }
    const unplanned = result.changes.filter((change) => change.from && !change.to).length;
    if (unplanned) {
      const note = document.createElement("p"); note.className = "schedule-impact-warning";
      note.textContent = `${unplanned} 件事项在当前时间窗口内无法排入，确认后会留在收纳箱待安排。`;
      host.append(note);
    }
  }

  function openEdit(taskId) {
    prepare();
    const task = base.find((item) => item.id === taskId);
    if (!task) return;
    mode = "edit"; selectedId = taskId;
    $(".schedule-adjust-head h2").textContent = "调整日程";
    $(".schedule-adjust-lead").textContent = task.title + (task.kind === "event" ? " · 固定事项，修改后会重新安排可移动任务。" : " · 选择时间或优先级，预览受影响的安排。 ");
    const exact = task.kind === "event" || Boolean(task.manualAt) || isProtected(task);
    $(".schedule-mode").value = exact ? "exact" : "auto";
    $(".schedule-mode").disabled = task.kind === "event" || Boolean(task.actualStartAt);
    $(".schedule-time-input").value = localInput(task.manualAt || task.fixedAt || task.scheduledAt);
    $(".schedule-time-input").disabled = !exact;
    $('.schedule-task-title').value=task.title;
    $('.schedule-end-input').value=localInput(task.scheduledEndAt);
    $('.schedule-locked').checked=Boolean(task.locked);
    $('.schedule-recurrence').value=isDaily(task)?'daily':'once';
    $('.schedule-urgency').value=task.urgency||'normal';
    $('.schedule-protected-label').hidden=!isProtected(task);$('.schedule-allow-protected').checked=false;
    const choices=$('.schedule-journey');choices.replaceChildren();
    for(const j of [{id:'',title:'无长期归属'},...(getData?.().journeys||[])]){const option=document.createElement('option');option.value=j.id;option.textContent=j.title;choices.append(option);}choices.value=task.journeyId||'';
    $(".schedule-minutes").value = task.estimateMinutes || 45;
    $(".schedule-priority").value = task.priority || "auto";
    $(".schedule-deadline-label").hidden = task.kind === "event";
    $(".schedule-deadline").value = localInput(task.deadline);
    $(".schedule-fields").hidden = false;
    $(".schedule-preview").hidden = false;
    dialog.showModal();
  }

  function reorder(baseTasks, draggedId, droppedId, after) {
    const items = baseTasks.filter((item) => item.status === "pending" && item.kind === "task" && !isDaily(item) && !isProtected(item))
      .sort((a, b) => (a.scheduledAt || "9999").localeCompare(b.scheduledAt || "9999") || (a.createdAt || "").localeCompare(b.createdAt || ""));
    const from = items.findIndex((item) => item.id === draggedId);
    if (from < 0) return false;
    const [dragged] = items.splice(from, 1);
    const target = items.findIndex((item) => item.id === droppedId);
    if (target >= 0) items.splice(target + (after ? 1 : 0), 0, dragged);
    else {
      const targetTime = baseTasks.find((item) => item.id === droppedId)?.scheduledAt || "";
      const index = items.findIndex((item) => (item.scheduledAt || "9999") > targetTime);
      items.splice(index < 0 ? items.length : index, 0, dragged);
    }
    items.forEach((item, index) => { item.manualOrder = index; });
    dragged.manualAt = null;
    clearSession(dragged);
    return true;
  }

  function openReorder(draggedId, droppedId, after) {
    prepare();
    mode = "reorder"; sourceId = draggedId; targetId = droppedId; placeAfter = after;
    const dragged = base.find((item) => item.id === draggedId);
    const dropped = base.find((item) => item.id === droppedId);
    if (!dragged || !dropped || dragged.id === dropped.id || isProtected(dragged)) return;
    $(".schedule-adjust-head h2").textContent = "调整优先顺序";
    $(".schedule-adjust-lead").textContent = `把“${dragged.title}”的排程优先级移到“${dropped.title}”${after ? "之后" : "之前"}，自动重排可移动任务。固定事项保持原时间。${dragged.manualAt ? "这件事原先指定的时间将改为自动安排。" : ""}`;
    $(".schedule-fields").hidden = true;
    $(".schedule-preview").hidden = true;
    const next = clone(base);
    if (!reorder(next, draggedId, droppedId, after)) return;
    showChanges(previewScheduleChange(base, next,new Date(),{preferences:getData?.().preferences}));
    dialog.showModal();
  }

  function previewEdit() {
    const next = clone(base);
    const task = next.find((item) => item.id === selectedId);
    if (!task) return;
    const minutes = Number($(".schedule-minutes").value);
    if (!Number.isFinite(minutes) || minutes < 10 || minutes > 480) {
      showChanges({ error: "预计时间须为 10–480 分钟。" }); return;
    }
    const exact = task.kind === "event" || $(".schedule-mode").value === "exact";
    const inputTime = $(".schedule-time-input").value;
    if (exact && (!inputTime || Number.isNaN(new Date(inputTime).getTime()) || new Date(inputTime).getTime() < Date.now() - 60000 && inputTime !== localInput(base.find(t=>t.id===selectedId)?.scheduledAt))) {
      showChanges({ error: "请填写有效的未来时间。" }); return;
    }
    const title=$('.schedule-task-title').value.trim();if(!title){showChanges({error:'请输入事项名称。'});return;}
    const old=base.find(t=>t.id===selectedId);
    task.title=title;task.estimateMinutes=minutes;task.remainingMinutes=task.status==='done'?0:Math.max(0,task.remainingMinutes+minutes-old.estimateMinutes);
    task.priority=$('.schedule-priority').value;
    task.journeyId=$('.schedule-journey').value||null;task.journeyKind=getData?.().journeys.find(j=>j.id===task.journeyId)?.kind||null;
    task.recurrence=$('.schedule-recurrence').value;task.urgency=$('.schedule-urgency').value;task.questType=task.recurrence==='daily'?'daily':task.journeyKind|| (task.urgency==='urgent'?'adventure':'normal');
    const endInput=$('.schedule-end-input').value;
    if(exact){
      const start=new Date(inputTime),end=endInput?new Date(endInput):new Date(start.getTime()+Math.min(task.remainingMinutes||minutes,task.kind==='event'?480:90)*60000);
      if(!Number.isFinite(end.getTime())||end<=start||end-start>480*60000){showChanges({error:'本段结束须晚于开始，且不超过8小时。'});return;}
      task.manualAt=task.kind==='task'?start.toISOString():null;if(task.kind==='event')task.fixedAt=start.toISOString();setSession(task,start,(end-start)/60000);
    }else{task.manualAt=null;clearSession(task);}
    const deadline=$('.schedule-deadline').value;task.deadline=deadline?new Date(deadline).toISOString():null;
    task.locked=$('.schedule-locked').checked;
    if(old.actualStartAt&&(old.scheduledAt!==task.scheduledAt||old.scheduledEndAt!==task.scheduledEndAt)){showChanges({error:'正在执行的安排请先确认本段进度，再安排下一段。'});return;}
    const allow=$('.schedule-allow-protected').checked;
    if(isProtected(old)&&(old.scheduledAt!==task.scheduledAt||old.scheduledEndAt!==task.scheduledEndAt||old.estimateMinutes!==task.estimateMinutes||old.locked!==task.locked)&&!allow){showChanges({error:'请明确确认修改固定／锁定安排。'});return;}
    showChanges(previewScheduleChange(base,next,new Date(),{preferences:getData?.().preferences,allowProtectedIds:allow?[task.id]:[]}));
  }

  $(".schedule-mode").addEventListener("change", () => { $(".schedule-time-input").disabled = $(".schedule-mode").value !== "exact"; proposal = null; $(".schedule-confirm").disabled = true; });
  dialog.querySelectorAll("input, select").forEach((field) => field.addEventListener("input", () => { proposal = null; $(".schedule-confirm").disabled = true; }));
  $(".schedule-preview").addEventListener("click", previewEdit);
  $(".schedule-close").addEventListener("click", () => dialog.close());
  $(".schedule-confirm").addEventListener("click", () => {
    if (!proposal) return;
    if (JSON.stringify(getTasks()) !== signature) { $(".schedule-adjust-error").textContent = "日程已在其他窗口更新，请重新打开并预览。"; $(".schedule-confirm").disabled = true; return; }
    const message = mode === "reorder" ? "优先顺序已更新，相关日程已自动重排。" : "日程已调整，受影响的任务已自动重排。";
    if (saveTasks(proposal, message) !== false) dialog.close();
  });

  function decorate(row, task) {
    row.dataset.scheduleId = task.id;
    const actions = document.createElement("div"); actions.className = "schedule-row-actions";
    if (task.kind === "task" && !isProtected(task) && !isDaily(task)) {
      const drag = document.createElement("button"); drag.type = "button"; drag.className = "schedule-drag";
      drag.textContent = "⋮⋮"; drag.title = "拖动调整优先顺序";
      drag.setAttribute("aria-label", `拖动调整“${task.title}”的优先顺序，或用上下方向键`);
      let startY = 0, moved = false, target = null, after = false;
      drag.addEventListener("pointerdown", (event) => { if (event.button !== 0) return; event.preventDefault(); startY = event.clientY; moved = false; target = null; drag.setPointerCapture(event.pointerId); row.classList.add("schedule-dragging"); });
      drag.addEventListener("pointermove", (event) => {
        if (!drag.hasPointerCapture(event.pointerId)) return;
        if (Math.abs(event.clientY - startY) > 5) moved = true;
        document.querySelectorAll(".schedule-drop-before,.schedule-drop-after").forEach((node) => node.classList.remove("schedule-drop-before", "schedule-drop-after"));
        target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-schedule-id]") || null;
        if (!target || target === row) { target = null; return; }
        after = event.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
        target.classList.add(after ? "schedule-drop-after" : "schedule-drop-before");
      });
      drag.addEventListener("pointerup", (event) => {
        if (!drag.hasPointerCapture(event.pointerId)) return;
        drag.releasePointerCapture(event.pointerId);
        row.classList.remove("schedule-dragging");
        document.querySelectorAll(".schedule-drop-before,.schedule-drop-after").forEach((node) => node.classList.remove("schedule-drop-before", "schedule-drop-after"));
        if (moved && target) openReorder(task.id, target.dataset.scheduleId, after);
      });
      drag.addEventListener("pointercancel", () => { row.classList.remove("schedule-dragging"); document.querySelectorAll(".schedule-drop-before,.schedule-drop-after").forEach((node) => node.classList.remove("schedule-drop-before", "schedule-drop-after")); });
      drag.addEventListener("keydown", (event) => {
        if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const rows = [...document.querySelectorAll("[data-schedule-id]")];
        const index = rows.indexOf(row);
        const other = rows[index + (event.key === "ArrowUp" ? -1 : 1)];
        if (other) openReorder(task.id, other.dataset.scheduleId, event.key === "ArrowDown");
      });
      actions.append(drag);
    }
    const adjust = document.createElement("button"); adjust.type = "button"; adjust.className = "schedule-adjust-button";
    adjust.textContent = "调整"; adjust.setAttribute("aria-label", `调整“${task.title}”的日程`);
    adjust.addEventListener("click", () => openEdit(task.id));
    actions.append(adjust);
    if (onComplete) {
      const complete = document.createElement("button"); complete.type = "button"; complete.className = "schedule-complete";
      const label = "确认进度";
      complete.textContent = "✓"; complete.title = label;
      complete.setAttribute("aria-label", `${label}“${task.title}”`);
      complete.addEventListener("click", () => onComplete(task.id));
      actions.append(complete);
    }
    row.append(actions);
  }
  return { decorate, openEdit };
}
