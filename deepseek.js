import { parseCapture, dayKey } from "./planner.js";

const pad = (value) => String(value).padStart(2, "0");
const localStamp = (date) => `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

export async function recognizeWithDeepSeek(text, key, now = new Date()) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 16000);
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-flash",
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 1200,
        messages: [
          { role: "system", content: `你是日程提取智能体。只返回 JSON 对象 {"tasks":[{"sourceText":"原文对应片段","title":"事项名","kind":"task或event","time":"YYYY-MM-DDTHH:mm或空字符串","duration":45,"questType":"adventure或normal或main或side或daily","journeyName":"长期旅程名或空","priority":"auto或high或medium或low","recordState":"future或ongoing或completed"}]}。设备本地当前时间：${localStamp(now)}；时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}。今天、今晚、今夜等明确指设备当前日期，即使所说时刻已经过去，也不可擅自移到明天；不明确的过时时刻可以推到明天。不要因“还有个事”“还有一件事”这样的同一句尾语拆出独立任务；只有明确的多个行动才拆分。固定会议/面试等用 event；需要执行的动作用 task。今天内到期且紧急用 adventure；近期普通事项用 normal；长期重要目标用 main，次要长期目标用 side；明确每天重复用 daily。识别“已经结束、刚完成”为 completed，“正在进行、刚开始”为 ongoing，并按开始至结束时间计算时长。不要臆造精确时间；不明时留空。输出必须是合法 json。` },
          { role: "user", content: text.slice(0, 4000) }
        ]
      })
    });
    if (!response.ok) throw new Error(`DeepSeek ${response.status}`);
    const payload = await response.json();
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || "{}");
    if (!Array.isArray(parsed.tasks) || !parsed.tasks.length || parsed.tasks.length > 12) throw new Error("模型返回格式无效");
    return parsed.tasks.map((item) => {
      if (!item || typeof item.title !== "string" || !item.title.trim()) throw new Error("模型返回格式无效");
      const sourceText = typeof item.sourceText === "string" && item.sourceText.trim() ? item.sourceText : item.title;
      const local = parseCapture(sourceText, now)[0];
      let time = typeof item.time === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(item.time) && !Number.isNaN(new Date(item.time).getTime()) ? item.time : "";
      if (/(?:今天|今晚|今夜|今早|今晨|今下午|今上午|今中午|明天|后天)/.test(sourceText) && local?.time) time = local.time;
      const duration = local?.duration && !local.inferred ? local.duration : Math.max(10, Math.min(480, Number(item.duration) || 45));
      const kind = item.kind === "event" ? "event" : "task";
      let questType = ["adventure", "normal", "main", "side", "daily"].includes(item.questType) ? item.questType : "normal";
      if (kind === "event") questType = "normal";
      else if (questType === "adventure" && (!time || dayKey(new Date(time)) !== dayKey(now))) questType = "normal";
      else if (questType === "normal" && time && dayKey(new Date(time)) === dayKey(now) && /紧急|今晚|今天|马上|尽快|必须/.test(sourceText)) questType = "adventure";
      return { title: item.title.trim().slice(0, 180), kind, time, duration, questType,
        journeyName: ["main", "side"].includes(questType) ? String(item.journeyName || item.title).slice(0, 80) : "",
        priority: ["auto", "high", "medium", "low"].includes(item.priority) ? item.priority : "auto",
        recordState: ["future", "ongoing", "completed"].includes(item.recordState) ? item.recordState : /已经|已完成|结束了/.test(sourceText) ? "completed" : /正在|进行中|开始了/.test(sourceText) ? "ongoing" : "future",
        inferred: !time || !item.duration };
    });
  } finally { clearTimeout(timeout); }
}
