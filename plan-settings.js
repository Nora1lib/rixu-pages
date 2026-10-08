import { copy, isProtected, normalizeState } from './schedule-domain.js';
import { previewScheduleChange } from './planner.js';
import { BACKUP_KEY, KEY, readPlan, recoverPlan, notifyNative } from './plan-store.js';
export function installPlanSettings({host,getData,saveData}) {
  const panel=document.createElement('div');panel.className='plan-preferences';
  panel.innerHTML=`<label class="setting-row"><span>云端智能整理</span><input type="checkbox" class="cloud-toggle"></label><label class="form-field">每天可安排时段<input class="available-windows" placeholder="09:00-12:00,13:00-18:00,19:00-21:00"></label><label class="form-field">每天总工作量上限（分钟，含固定和手动）<input type="number" class="capacity-minutes" min="30" max="1440"></label><label class="form-field">任务间缓冲（分钟）<input type="number" class="buffer-minutes" min="0" max="120"></label><div class="schedule-fields"><label>开始前（分钟）<input class="start-lead" type="number" min="0" max="1440"></label><label>本段结束前（分钟）<input class="end-lead" type="number" min="0" max="1440"></label><label>硬截止前（分钟）<input class="deadline-lead" type="number" min="0" max="10080"></label></div><button type="button" class="save-preferences light-button">保存规划偏好</button><p class="preferences-message" role="status"></p><p class="field-note" data-native-reminder-status>网页提醒仅在页面可见时展示；Mac 收起提醒需新版应用与系统通知权限。完全退出后停止提醒。</p><button type="button" class="request-notifications light-button">允许 Mac 系统提醒</button><button type="button" class="migration-backup light-button">导出升级前恢复副本</button><button type="button" class="plan-export light-button">导出当前原始数据</button><label class="light-button">导入备份／恢复异常数据<input class="plan-import" type="file" accept=".json,application/json" hidden></label>`;
  host.append(panel);const $=(s)=>panel.querySelector(s);
  function refresh(){const data=getData(),prefs=data.preferences;$('.cloud-toggle').checked=data.cloudAnalysis;$('.available-windows').value=prefs.windows.map(([a,b])=>[a,b].map(x=>`${String(Math.floor(x)).padStart(2,'0')}:${String(Math.round(x%1*60)).padStart(2,'0')}`).join('-')).join(',');$('.capacity-minutes').value=prefs.maxMinutes;$('.buffer-minutes').value=prefs.bufferMinutes;$('.start-lead').value=prefs.startLead;$('.end-lead').value=prefs.endLead;$('.deadline-lead').value=prefs.deadlineLead;}
  refresh();
  $('.request-notifications').hidden=!window.webkit?.messageHandlers?.rixu;
  $('.request-notifications').onclick=()=>window.webkit.messageHandlers.rixu.postMessage({action:'requestNotifications'});
  $('.migration-backup').onclick=()=>{const text=localStorage.getItem(BACKUP_KEY);if(!text){$('.preferences-message').textContent='没有升级前的恢复副本；可使用当前数据导出。';return;}const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download='时序-升级前恢复副本.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  $('.plan-export').onclick=()=>{const text=localStorage.getItem(KEY)||JSON.stringify(getData());const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download='时序-原始数据.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  $('.plan-import').onchange=async(event)=>{
    try {const file=event.target.files?.[0];if(!file)return;const data=normalizeState(JSON.parse(await file.text()));
      if(!confirm(`将用备份中的 ${data.tasks.length} 项事项替换本机计划，继续吗？`))return;
      let unreadable=false;try{readPlan();}catch{unreadable=true;}
      if(unreadable){notifyNative(recoverPlan(data));location.reload();}
      else{data.revision=getData().revision;saveData(data,'备份已导入，原安排已保留。');}
    }catch(error){$('.preferences-message').textContent=error.message;}finally{event.target.value='';}
  };
  $('.save-preferences').onclick=()=>{
    const data=getData(),next=copy(data);
    const list=$('.available-windows').value.split(/[,，]/).map((x)=>x.trim()).filter(Boolean);
    try {
    const windows=list.map((x)=>{const m=x.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);if(!m)throw new Error('时段格式为09:00-12:00，多个时段用逗号分开。');const a=Number(m[1])+Number(m[2])/60,b=Number(m[3])+Number(m[4])/60;if(Number(m[2])>59||Number(m[4])>59||a<0||b>24||b<=a)throw new Error('请检查可用时段。');return[a,b];});
      if(!windows.length)throw new Error('至少设置一个可用时段。');windows.sort((a,b)=>a[0]-b[0]);if(windows.some((w,i)=>i&&w[0]<windows[i-1][1]))throw new Error('可用时段不能重叠。');
      const number=(s,min,max)=>{const n=Number($(s).value);if(!Number.isFinite(n)||n<min||n>max)throw new Error('请检查时长和提醒提前量。');return n;};
      next.cloudAnalysis=$('.cloud-toggle').checked;next.preferences={windows,maxMinutes:number('.capacity-minutes',30,1440),bufferMinutes:number('.buffer-minutes',0,120),startLead:number('.start-lead',0,1440),endLead:number('.end-lead',0,1440),deadlineLead:number('.deadline-lead',0,10080)};
      const planningChanged=JSON.stringify([data.preferences.windows,data.preferences.maxMinutes,data.preferences.bufferMinutes])!==JSON.stringify([windows,next.preferences.maxMinutes,next.preferences.bufferMinutes]);
      if(planningChanged){const result=previewScheduleChange(data.tasks,next.tasks,new Date(),{preferences:next.preferences,replanIds:next.tasks.filter(t=>!isProtected(t)).map(t=>t.id)});if(result.error)throw new Error(result.error);if(result.changes.length&&!confirm('规划偏好会调整以下柔性日程：\n'+result.changes.map(c=>c.task.title+' → '+(c.to?new Date(c.to).toLocaleString():'待安排')).join('\n')+'\n是否接受？'))return;next.tasks=result.tasks;}
      if(saveData(next,'规划与提醒偏好已保存。')!==false){$('.preferences-message').textContent='已保存。';refresh();}
    }catch(error){$('.preferences-message').textContent=error.message;}
  };
  window.addEventListener('rixu:data-changed',refresh);window.addEventListener('storage',refresh);
}
