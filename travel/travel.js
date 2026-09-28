const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const validId = x => /^[a-f0-9]{32}$/.test(x || "");
const uid = () => crypto.randomUUID().replaceAll("-", "");
const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const key = id => `rixu_travel_trip_${id}`;
let tripId = "", records = [], settingsDirty = false;

function note(text = "", error = false) {
  $("#status").textContent = text;
  $("#status").classList.toggle("error", error);
}
function recents() {
  try { return JSON.parse(localStorage.getItem("rixu_travel_recent") || "[]").filter(validId).slice(0, 30); }
  catch { return []; }
}
function remember(id) {
  localStorage.setItem("rixu_travel_recent", JSON.stringify([id, ...recents().filter(x => x !== id)].slice(0, 30)));
}
function load(id) {
  if (!validId(id)) return null;
  try {
    const value = JSON.parse(localStorage.getItem(key(id)) || "null");
    return value?.format === "rixu-travel-v1" && Array.isArray(value.records) ? value : null;
  } catch { return null; }
}
function persist() {
  localStorage.setItem(key(tripId), JSON.stringify({format:"rixu-travel-v1", records}));
  remember(tripId);
  render();
  note("已保存在这个浏览器中。建议定期导出备份。");
}
const record = id => records.find(x => x.id === id);
const kind = k => records.filter(x => x.kind === k);
function landing() {
  const items = recents().map(id => ({id, data:load(id)})).filter(x => x.data);
  $("#recentTrips").innerHTML = items.length ? items.map(({id,data}) => {
    const info = data.records.find(x => x.id === "settings")?.data || {};
    return `<a href="#trip=${id}"><strong>${esc(info.title || "未命名旅程")}</strong><br><small>${esc(info.destination || "目的地待定")} · 只保存在本浏览器</small></a>`;
  }).join("") : '<p class="muted">还没有旅程。</p>';
}
function render() {
  const info = record("settings")?.data || {};
  $("#tripHeading").textContent = info.title || "未命名旅程";
  $("#tripSubtitle").textContent = [info.destination || "目的地待定", info.startDate ? `${info.startDate}${info.endDate ? ` — ${info.endDate}` : ""}` : "日期待定"].join(" · ");
  if (!settingsDirty && !document.activeElement?.closest("#settingsForm")) {
    for (const name of ["title","destination","startDate","endDate","note"]) $("#settingsForm").elements[name].value = info[name] || "";
  }
  const schedules = kind("schedule").sort((a,b) => `${a.data.date || "9999"} ${a.data.time || "99"}`.localeCompare(`${b.data.date || "9999"} ${b.data.time || "99"}`));
  $("#scheduleList").innerHTML = schedules.length ? schedules.map(x => {
    const d=x.data, link=/^https?:\/\//i.test(d.link || "") ? `<small><a href="${esc(d.link)}" target="_blank" rel="noopener noreferrer">相关链接 ↗</a></small>` : "";
    return `<div class="item"><div class="item-main"><strong>${esc(d.title)}</strong><small>${esc([d.date,d.time,d.category,d.place].filter(Boolean).join(" · "))}</small>${d.note ? `<small>${esc(d.note)}</small>` : ""}${link}</div><div class="item-actions"><button data-edit="${x.id}">编辑</button><button class="danger" data-delete="${x.id}">删除</button></div></div>`;
  }).join("") : '<div class="empty">还没有行程。添加第一项安排吧。</div>';
  const todos=kind("todo").sort((a,b) => Number(a.data.done)-Number(b.data.done));
  $("#todoList").innerHTML = todos.length ? todos.map(x => `<div class="item"><div class="item-main"><strong>${x.data.done ? "✓ " : "○ "}${esc(x.data.text)}</strong></div><div class="item-actions"><button data-toggle="${x.id}">${x.data.done ? "恢复" : "完成"}</button><button class="danger" data-delete="${x.id}">删除</button></div></div>`).join("") : '<div class="empty">还没有待办事项。</div>';
  const expenses=kind("expense");
  $("#expenseList").innerHTML = expenses.length ? expenses.map(x => {
    const d=x.data;
    return `<div class="item"><div class="item-main"><strong>${esc(d.title)} · ${esc(d.currency)} ${(Number(d.cents || 0)/100).toFixed(2)}</strong>${d.note ? `<small>${esc(d.note)}</small>` : ""}</div><div class="item-actions"><button data-edit="${x.id}">编辑</button><button class="danger" data-delete="${x.id}">删除</button></div></div>`;
  }).join("") : '<div class="empty">还没有旅费记录。</div>';
}
function save(id, type, data) {
  records=records.filter(x => x.id !== id);
  records.push({id,kind:type,data,updatedAt:new Date().toISOString()});
  persist();
}
function openTrip() {
  const match=location.hash.match(/^#trip=([a-f0-9]{32})$/), data=match && load(match[1]);
  $("#landing").hidden=!!data; $("#tripView").hidden=!data;
  if (!data) {tripId="";landing();return;}
  tripId=match[1];records=data.records;remember(tripId);render();note();
}
$("#createTrip").addEventListener("click", () => {
  const id=uid();localStorage.setItem(key(id),JSON.stringify({format:"rixu-travel-v1",records:[]}));remember(id);location.hash=`trip=${id}`;
});
$("#exportTrip").addEventListener("click", () => {
  const data={format:"rixu-travel-v1",exportedAt:new Date().toISOString(),records};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download=`旅行计划-${new Date().toISOString().slice(0,10)}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);note("备份已导出，请妥善保存。");
});
$("#importTrip").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", async e => {
  const file=e.target.files?.[0];if(!file)return;
  try {
    if(file.size>1024*1024)throw new Error("备份文件不能超过 1 MB。");
    const data=JSON.parse(await file.text());
    if(data.format!=="rixu-travel-v1"||!Array.isArray(data.records)||data.records.length>500)throw new Error("这不是有效的旅行计划备份。");
    const safe=data.records.map(x => {
      if(!x||!["settings","schedule","todo","expense"].includes(x.kind)||!(x.id==="settings"||validId(x.id))||!x.data||typeof x.data!=="object")throw new Error("备份内容有误。");
      return {id:x.id,kind:x.kind,data:x.data,updatedAt:String(x.updatedAt||"")};
    });
    const id=uid();localStorage.setItem(key(id),JSON.stringify({format:"rixu-travel-v1",records:safe}));remember(id);location.hash=`trip=${id}`;
  } catch(error) {alert(error.message||"导入失败。");}
  finally {e.target.value="";}
});
$("#settingsForm").addEventListener("input",()=>{settingsDirty=true;});
$("#settingsForm").addEventListener("submit",e=>{e.preventDefault();save("settings","settings",Object.fromEntries(new FormData(e.currentTarget)));settingsDirty=false;});
$("#scheduleForm").addEventListener("submit",e=>{
  e.preventDefault();const form=e.currentTarget,data=Object.fromEntries(new FormData(form));
  const id=validId(data.recordId)?data.recordId:uid();delete data.recordId;save(id,"schedule",data);form.reset();
});
$("#todoForm").addEventListener("submit",e=>{e.preventDefault();const f=e.currentTarget;save(uid(),"todo",{text:f.elements.text.value.trim(),done:false});f.reset();});
$("#expenseForm").addEventListener("submit",e=>{
  e.preventDefault();const f=e.currentTarget,data=Object.fromEntries(new FormData(f));
  const cents=Math.round(Number(data.amount)*100);if(!Number.isFinite(cents)||cents<=0){note("请输入正确金额。",true);return;}
  save(validId(data.recordId)?data.recordId:uid(),"expense",{title:data.title,cents,currency:data.currency,note:data.note});f.reset();
});
$(".tabs").addEventListener("click",e=>{
  const b=e.target.closest("[data-tab]");if(!b)return;
  $$('[data-tab]').forEach(x=>x.classList.toggle("selected",x.dataset.tab===b.dataset.tab));
  $$('[data-panel]').forEach(x=>{x.hidden=x.dataset.panel!==b.dataset.tab;});
});
$(".content").addEventListener("click",e=>{
  const b=e.target.closest("[data-delete],[data-edit],[data-toggle]");if(!b)return;
  const id=b.dataset.delete||b.dataset.edit||b.dataset.toggle,item=record(id);if(!item)return;
  if(b.dataset.delete){records=records.filter(x=>x.id!==id);persist();return;}
  if(b.dataset.toggle){save(id,"todo",{...item.data,done:!item.data.done});return;}
  const f=item.kind==="schedule"?$("#scheduleForm"):$("#expenseForm");f.elements.recordId.value=id;
  for(const [name,value] of Object.entries(item.data)){
    if(name==="cents")f.elements.amount.value=(Number(value)/100).toFixed(2);
    else if(f.elements[name])f.elements[name].value=value??"";
  }
  f.scrollIntoView({behavior:"smooth",block:"center"});
});
window.addEventListener("hashchange",openTrip);
window.addEventListener("storage",e=>{if(tripId&&e.key===key(tripId))openTrip();});
openTrip();
