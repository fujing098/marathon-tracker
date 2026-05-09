const APP_TOKEN = "F1rmb1U2oaPqULsAtq5cqj7hnbh";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

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
  if (data.code !== 0) throw new Error("获取表格列表失败");
  const tables = data.data.items;
  return { newsTableId: tables.find(t => t.name.includes("推文"))?.table_id || tables[0]?.table_id };
}

async function getExistingTitles(token, tableId) {
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records?page_size=500`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) return new Set();
  return new Set((data.data.items || []).map(r => r.fields["标题"] || ""));
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

function parseRaceType(text) {
  if (/越野|trail|Trail|山径|徒步|跑山/.test(text)) return "越野赛";
  if (/铁人|骑行|游泳/.test(text)) return "其他赛事";
  return "马拉松";
}

function parseCategory(title) {
  if (/报名|开启|截止|额满|盲报/.test(title)) return "报名信息";
  if (/成绩|完赛|冠军|获奖/.test(title)) return "成绩结果";
  return "赛事动态";
}

async function scrapeNewsPage(page) {
  // 使用报名分类页，数据更纯净
  const url = page === 1
    ? "https://zuicool.com/news/archives/category/reg"
    : `https://zuicool.com/news/archives/category/reg/page/${page}`;
  
  console.log(`抓取资讯第${page}页: ${url}`);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();

  const items = [];
  // 格式：[标题 日期](链接) 其中标题可含特殊字符
  // 用更宽松的正则，匹配到 archives/数字 结尾
  const lines = text.split("\n");
  for (const line of lines) {
    // 匹配 [任意内容 YYYY-MM-DD](https://zuicool.com/news/archives/数字)
    const m = line.match(/\[(.+?)\s+(\d{4}-\d{2}-\d{2})\]\((https:\/\/zuicool\.com\/news\/archives\/\d+)\)/);
    if (m) {
      const title = m[1].trim();
      const date  = m[2];
      const url   = m[3];
      if (title && date && url) {
        items.push({ title, date, url });
      }
    }
  }
  
  console.log(`第${page}页找到 ${items.length} 条`);
  return items;
}

async function scrapeNewsDetail(url) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return "";
    const html = await res.text();
    const descMatch = html.match(/meta-description:\s*(.+)/);
    if (descMatch) return descMatch[1].trim().slice(0, 100);
    return "";
  } catch(e) {
    return "";
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const maxPages = parseInt(req.query.pages || "5");
    const token = await getFeishuToken();
    const { newsTableId } = await getTableIds(token);
    if (!newsTableId) return res.status(400).json({ error: "找不到推文资讯表" });

    const existingTitles = await getExistingTitles(token, newsTableId);
    console.log(`已有资讯：${existingTitles.size} 条`);

    let allItems = [];
    for (let page = 1; page <= maxPages; page++) {
      try {
        const items = await scrapeNewsPage(page);
        allItems = allItems.concat(items);
        if (items.length === 0) break; // 没有更多数据了
        await new Promise(r => setTimeout(r, 500));
      } catch(e) {
        console.error(`第${page}页失败：`, e.message);
        break;
      }
    }

    console.log(`总计抓取：${allItems.length} 条`);

    let written = 0, skipped = 0;
    const seenTitles = new Set(existingTitles);

    for (const item of allItems) {
      if (!item.title || seenTitles.has(item.title)) { skipped++; continue; }
      seenTitles.add(item.title);

      const summary = await scrapeNewsDetail(item.url);
      await new Promise(r => setTimeout(r, 200));

      try {
        await writeRecord(token, newsTableId, {
          "标题":    item.title,
          "来源":    "最酷马拉松",
          "发布日期": new Date(item.date).getTime(),
          "链接":    { link: item.url, text: item.url },
          "摘要":    summary,
          "分类":    parseCategory(item.title),
          "赛事类型": parseRaceType(item.title),
        });
        written++;
        await new Promise(r => setTimeout(r, 200));
      } catch(e) {
        console.error(`写入失败 ${item.title}：`, e.message);
      }
    }

    res.status(200).json({ success: true, scraped: allItems.length, written, skipped });
  } catch(e) {
    console.error("Handler 错误：", e.message);
    res.status(500).json({ error: e.message });
  }
}
