import { parseCapture, dayKey } from "./planner.js";

const pad = (value) => String(value).padStart(2, "0");
const localStamp = (date) => `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

const API_URL = "https://rixu-ai-service-2026.valerienora11.chatgpt.site/api/recognize";

export async function recognizeWithDeepSeek(text, now = new Date()) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 16000);
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 2000), localNow: localStamp(now), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai" })
    });
    if (!response.ok) throw new Error(`智能识别 ${response.status}`);
    const payload = await response.json();
    const parsed = payload;
    if (!Array.isArray(parsed.tasks) || !parsed.tasks.length || parsed.tasks.length > 12) throw new Error("模型返回格式无效");
    return parsed.tasks.map((item) => {
      if (!item || typeof item.title !== "string" || !item.title.trim()) throw new Error("模型返回格式无效");
      const sourceText = typeof item.sourceText === "string" && item.sourceText.trim() ? item.sourceText : item.title;
      const local = parseCapture(sourceText, now)[0];
      let time = typeof item.time === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(item.time) && !Number.isNaN(new Date(item.time).getTime()) ? item.time : "";
      if (/(?:今天|今晚|今夜|今早|今晨|今下午|今上午|今中午|明天|后天)/.test(sourceText) && local?.time) time = local.time;
      if (/(?:点|[:：])\s*(?:半|\d{0,2})\s*(?:到|至|—|－|-)\s*(?:上午|下午|晚上|早上|凌晨)?\s*\d{1,2}(?:点|[:：])/.test(sourceText) && local?.time) time = local.time;
      const duration = local?.duration && !local.inferred ? local.duration : Math.max(10, Math.min(480, Number(item.duration) || 45));
      const kind = item.kind === "event" ? "event" : "task";
      let questType = ["adventure", "normal", "main", "side", "daily"].includes(item.questType) ? item.questType : "normal";
      if (kind === "event") questType = "normal";
      else if (questType === "adventure" && (!time || dayKey(new Date(time)) !== dayKey(now))) questType = "normal";
      else if (questType === "normal" && time && dayKey(new Date(time)) === dayKey(now) && /紧急|今晚|今天|马上|尽快|必须/.test(sourceText)) questType = "adventure";
      return { title: item.title.trim().slice(0, 180), sourceText, kind, time, duration, questType,
        journeyName: ["main", "side"].includes(questType) ? String(item.journeyName || item.title).slice(0, 80) : "",
        priority: ["auto", "high", "medium", "low"].includes(item.priority) ? item.priority : "auto",
        recordState: ["future", "ongoing", "completed"].includes(item.recordState) ? item.recordState : /已经|已完成|结束了/.test(sourceText) ? "completed" : /正在|进行中|开始了/.test(sourceText) ? "ongoing" : "future",
        inferred: !time || !item.duration };
    });
  } finally { clearTimeout(timeout); }
}
