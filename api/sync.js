const APP_TOKEN = "F1rmb1U2oaPqULsAtq5cqj7hnbh";

// ─── 飞书 Token ───────────────────────────────────────────
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

// ─── 获取表格 ID ──────────────────────────────────────────
async function getTableIds(token) {
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("获取表格列表失败：" + data.msg);
  const tables = data.data.items;
  const newsTable = tables.find(t => t.name.includes("推文")) || tables[0];
  const raceTable = tables.find(t => t.name.includes("赛事信息"));
  return { newsTableId: newsTable.table_id, raceTableId: raceTable?.table_id };
}

// ─── 获取已有标题（去重）─────────────────────────────────
async function getExistingTitles(token, tableId) {
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records?page_size=100`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) return new Set();
  return new Set((data.data.items || []).map(r => r.fields["标题"] || ""));
}

// ─── 写入飞书记录 ─────────────────────────────────────────
async function writeRecord(token, tableId, fields) {
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("写入记录失败：" + data.msg);
  return data;
}

// ─── Kimi 搜索最新资讯 ───────────────────────────────────
async function fetchNewsFromKimi() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch("https://api.moonshot.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.KIMI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "moonshot-v1-8k",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: `今天是${today}，请列出最近7天内中国马拉松赛事的真实资讯，包括：报名开始、赛事公告、成绩发布等。

每条资讯必须是真实存在的，不要编造。

严格返回JSON数组，不要任何其他文字：
[{"title":"资讯标题","source":"媒体来源","date":"YYYY-MM-DD","url":"原文链接或空字符串","summary":"50字以内摘要","category":"报名信息或赛事动态或成绩结果"}]

返回5-10条，只返回最近真实发生的资讯。`
        }],
      }),
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "[]";
    const clean = text.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("["), end = clean.lastIndexOf("]");
    if (start === -1) return [];
    return JSON.parse(clean.slice(start, end + 1));
  } catch(e) {
    console.error("Kimi 搜索失败：", e.message);
    return [];
  }
}

// ─── Kimi AI 审核 ─────────────────────────────────────────
async function aiReview(items) {
  if (!items.length) return [];
  const prompt = `你是马拉松赛事资讯审核员。以下是一批新闻标题，请判断每条是否与马拉松/跑步赛事直接相关（报名信息、赛事动态、成绩结果、赛事公告等）。

不相关的内容包括：娱乐八卦、与赛事无关的健身内容、广告、其他运动项目等。

新闻列表：
${items.map((item, i) => `${i + 1}. ${item.title}`).join("\n")}

严格返回JSON数组，不要任何其他文字：
[{"index":1,"pass":true,"category":"报名信息","summary":"50字以内摘要"},{"index":2,"pass":false}]

category 只能是：报名信息、赛事动态、成绩结果`;

  const res = await fetch("https://api.moonshot.cn/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.KIMI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "moonshot-v1-8k",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "[]";
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("["), end = clean.lastIndexOf("]");
  if (start === -1) return [];
  const results = JSON.parse(clean.slice(start, end + 1));
  return items
    .map((item, i) => {
      const r = results.find(x => x.index === i + 1);
      if (!r || !r.pass) return null;
      return { ...item, category: r.category || "赛事动态", summary: r.summary || "" };
    })
    .filter(Boolean);
}

// ─── 主函数 ───────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const token = await getFeishuToken();
    const { newsTableId } = await getTableIds(token);
    const existingTitles = await getExistingTitles(token, newsTableId);

    // 1. Kimi 搜索最新资讯
    const kimiItems = await fetchNewsFromKimi();
    console.log(`Kimi 搜索：${kimiItems.length} 条`);

    // 2. 去重
    const newItems = kimiItems.filter(item => !existingTitles.has(item.title));
    console.log(`去重后：${newItems.length} 条新内容`);

    // 3. 直接写入（Kimi 已判断相关性，跳过二次审核）
    const approved = newItems;

    // 4. 写入飞书多维表格
    let written = 0;
    for (const item of approved) {
      await writeRecord(token, newsTableId, {
        "标题": item.title,
        "来源": item.source,
        "发布日期": new Date(item.date).getTime(),
        "链接": item.url ? { link: item.url, text: item.url } : "",
        "摘要": item.summary || "",
        "分类": item.category || "赛事动态",
        "审核状态": "已通过",
      });
      written++;
    }

    res.status(200).json({
      success: true,
      fetched: kimiItems.length,
      new: newItems.length,
      approved: approved.length,
      written,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
