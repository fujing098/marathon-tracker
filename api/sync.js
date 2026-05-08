// 在 handler 函数里最开始加
console.log("sync.js version: 2025-NEW");

// 或者在返回的 JSON 里加一个字段
return res.json({ version: "NEW", success: true, ... });



const APP_TOKEN = "F1rmb1U2oaPqULsAtq5cqj7hnbh";

async function getFeishuToken() {
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET,
    }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("获取飞书 Token 失败：" + data.msg);
  return data.tenant_access_token;
}

async function getTableIds(token) {
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("获取表格列表失败：" + data.msg);
  const tables = data.data.items;
  return {
    newsTableId:   tables.find(t => t.name.includes("推文"))?.table_id || tables[0]?.table_id,
    raceTableId:   tables.find(t => t.name.includes("赛事信息"))?.table_id,
    wechatTableId: tables.find(t => t.name.includes("公众号"))?.table_id,
  };
}

async function getWechatAccounts(token, tableId) {
  if (!tableId) return [];
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records?page_size=50`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) return [];
  return (data.data.items || [])
    .map(r => ({ name: r.fields["公众号名称"] || "", status: r.fields["状态"] || "启用" }))
    .filter(a => a.name && a.status !== "停用");
}

async function getExisting(token, tableId, field) {
  if (!tableId) return new Set();
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records?page_size=200`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) return new Set();
  return new Set((data.data.items || []).map(r => r.fields[field] || ""));
}

async function writeRecord(token, tableId, fields) {
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("写入失败：" + data.msg);
}

async function kimiSearch(prompt) {
  const res = await fetch("https://api.moonshot.cn/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.KIMI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "moonshot-v1-8k",
      max_tokens: 3000,
      tools: [{ type: "builtin_function", function: { name: "$web_search" } }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "[]";
  const clean = text.replace(/```json|```/g, "").trim();
  const s = clean.indexOf("["), e = clean.lastIndexOf("]");
  if (s === -1) return [];
  try { return JSON.parse(clean.slice(s, e + 1)); } catch { return []; }
}

async function searchByMonth(year, month) {
  const monthStr = `${year}年${month}月`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const prompt = `请联网搜索${monthStr}中国跑步赛事的所有资讯，包括：马拉松、越野赛、公路跑等赛事的报名开始、赛事公告、成绩发布、赛事动态等。时间范围：${year}-${String(month).padStart(2,"0")}-01 到 ${year}-${String(month).padStart(2,"0")}-${daysInMonth}。

赛事类型判断规则：
- 马拉松：全程、半程、10公里等公路跑赛事
- 越野赛：山地、越野、trail、徒步比赛
- 其他赛事：障碍赛、定向越野等其他类型

严格返回JSON数组，不要任何其他文字：
[{"title":"资讯标题","source":"媒体来源","date":"YYYY-MM-DD","url":"链接或空字符串","summary":"50字摘要","category":"报名信息或赛事动态或成绩结果","raceType":"马拉松或越野赛或其他赛事","raceInfo":{"name":"赛事名称或null","city":"城市或null","raceDate":"比赛日期YYYY-MM-DD或null","regStart":"报名开始日期或null","regEnd":"报名截止日期或null","scale":"规模数字或null","official":"官网或null","raceType":"马拉松或越野赛或其他赛事"}}]

返回所有找到的真实资讯，raceInfo 只在包含具体报名信息时填写，否则设为 null。`;
  return await kimiSearch(prompt);
}

async function searchWechatHistory(accounts) {
  if (!accounts.length) return [];
  const accountList = accounts.map(a => `"${a.name}"`).join("、");
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `请联网搜索以下微信公众号从2026年1月1日到${today}发布的所有内容：${accountList}。

只返回与跑步赛事直接相关的内容（马拉松、越野赛、公路跑等），不相关的过滤掉。

赛事类型判断规则：
- 马拉松：全程、半程、10公里等公路跑赛事
- 越野赛：山地、越野、trail、徒步比赛
- 其他赛事：障碍赛、定向越野等其他类型

严格返回JSON数组，不要任何其他文字：
[{"title":"文章标题","source":"公众号名称","date":"YYYY-MM-DD","url":"链接或空字符串","summary":"50字摘要","category":"报名信息或赛事动态或成绩结果","raceType":"马拉松或越野赛或其他赛事","raceInfo":{"name":"赛事名称或null","city":"城市或null","raceDate":"比赛日期YYYY-MM-DD或null","regStart":"报名开始日期或null","regEnd":"报名截止日期或null","scale":"规模数字或null","official":"官网或null","raceType":"马拉松或越野赛或其他赛事"}}]

没有相关内容返回 []。`;
  return await kimiSearch(prompt);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const token = await getFeishuToken();
    const { newsTableId, raceTableId, wechatTableId } = await getTableIds(token);
    const existingTitles = await getExisting(token, newsTableId, "标题");
    const existingRaces  = await getExisting(token, raceTableId, "赛事名称");
    const accounts = await getWechatAccounts(token, wechatTableId);

    const today = new Date();
    const endYear = today.getFullYear();
    const endMonth = today.getMonth() + 1;

    let allItems = [];

    // 按月分批搜索 2026.01 至今
    for (let y = 2026; y <= endYear; y++) {
      const mStart = 1;
      const mEnd = (y === endYear) ? endMonth : 12;
      for (let m = mStart; m <= mEnd; m++) {
        console.log(`搜索 ${y}年${m}月...`);
        const items = await searchByMonth(y, m);
        allItems = allItems.concat(items);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // 搜索公众号历史内容
    const wechatItems = await searchWechatHistory(accounts);
    allItems = allItems.concat(wechatItems);
    console.log(`总计抓取：${allItems.length} 条`);

    // 推文去重
    const seenTitles = new Set(existingTitles);
    const seenRaces  = new Set(existingRaces);
    const newItems = allItems.filter(item => {
      if (!item.title || seenTitles.has(item.title)) return false;
      seenTitles.add(item.title);
      return true;
    });
    console.log(`去重后：${newItems.length} 条`);

    // 写入推文资讯表
    let writtenNews = 0;
    for (const item of newItems) {
      try {
        await writeRecord(token, newsTableId, {
          "标题":    item.title,
          "来源":    item.source || "",
          "发布日期": item.date ? new Date(item.date).getTime() : Date.now(),
          "链接":    item.url ? { link: item.url, text: item.url } : "",
          "摘要":    item.summary || "",
          "分类":    item.category || "赛事动态",
          "赛事类型": item.raceType || "马拉松",
        });
        writtenNews++;
      } catch(e) {
        console.error("推文写入失败：", e.message);
      }
    }

    // 写入赛事信息表（赛事名称去重）
    let writtenRaces = 0;
    if (raceTableId) {
      for (const item of newItems) {
        const ri = item.raceInfo;
        if (ri && ri.name && !seenRaces.has(ri.name)) {
          seenRaces.add(ri.name);
          try {
            await writeRecord(token, raceTableId, {
              "赛事名称": ri.name,
              "城市":     ri.city || "",
              "比赛日期": ri.raceDate ? new Date(ri.raceDate).getTime() : "",
              "报名开始": ri.regStart ? new Date(ri.regStart).getTime() : "",
              "报名截止": ri.regEnd   ? new Date(ri.regEnd).getTime()   : "",
              "赛事规模": ri.scale ? Number(ri.scale) : "",
              "官网地址": ri.official ? { link: ri.official, text: ri.official } : "",
              "状态":     "报名中",
              "赛事类型": ri.raceType || item.raceType || "马拉松",
            });
            writtenRaces++;
          } catch(e) {
            console.error("赛事写入失败：", e.message);
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      total:   allItems.length,
      new:     newItems.length,
      writtenNews,
      writtenRaces,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
