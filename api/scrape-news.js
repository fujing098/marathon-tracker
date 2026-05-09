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
  if (data.code !== 0) throw new Error("获取表格列表失败");
  const tables = data.data.items;
  return {
    raceTableId: tables.find(t => t.name.includes("赛事信息"))?.table_id,
    newsTableId: tables.find(t => t.name.includes("推文"))?.table_id || tables[0]?.table_id,
  };
}

async function getExisting(token, tableId, field) {
  if (!tableId) return new Set();
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records?page_size=500`, {
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

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

function parseRaceType(text) {
  if (/越野|trail|Trail|山径|徒步|跑山|爬山/.test(text)) return "越野赛";
  if (/铁人|triathlon|骑行|游泳|自行车/.test(text)) return "其他赛事";
  return "马拉松";
}

function parseCategory(title) {
  if (/报名|开启|截止|额满|盲报/.test(title)) return "报名信息";
  if (/成绩|完赛|冠军|获奖/.test(title)) return "成绩结果";
  return "赛事动态";
}

function parseCityFromKeywords(keywords) {
  if (!keywords) return "";
  const parts = keywords.split(",");
  for (let i = 4; i < Math.min(parts.length, 8); i++) {
    const p = parts[i].trim();
    if (p && p.length <= 6 && !/马拉松|越野|报名|成绩|跑步|点评/.test(p)) return p;
  }
  return "";
}

function parseDetailFromMeta(desc, year) {
  const result = {};
  const scaleMatch = desc.match(/规模(\d+)人/);
  if (scaleMatch) result.scale = parseInt(scaleMatch[1]);
  const dateMatch = desc.match(/(\d{1,2})月(\d{1,2})日/);
  if (dateMatch) {
    result.raceDate = `${year}-${dateMatch[1].padStart(2,"0")}-${dateMatch[2].padStart(2,"0")}`;
  }
  const regStartMatch = desc.match(/(\d{1,2})月(\d{1,2})日[^\n，。]{0,10}?开[启]?报名/);
  if (regStartMatch) {
    result.regStart = `${year}-${regStartMatch[1].padStart(2,"0")}-${regStartMatch[2].padStart(2,"0")}`;
  }
  return result;
}

// 抓赛事详情页
async function scrapeDetail(id, name) {
  try {
    const res = await fetch(`https://zuicool.com/event/${id}`, { headers: HEADERS });
    if (!res.ok) return {};
    const html = await res.text();

    const descMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)
                   || html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i);
    const desc = descMatch ? descMatch[1] : "";

    const kwMatch = html.match(/<meta[^>]+name="keywords"[^>]+content="([^"]+)"/i)
                 || html.match(/<meta[^>]+content="([^"]+)"[^>]+name="keywords"/i);
    const keywords = kwMatch ? kwMatch[1] : "";

    const yearMatch = (name + desc).match(/20(\d{2})/);
    const year = yearMatch ? `20${yearMatch[1]}` : "2026";

    const detail = parseDetailFromMeta(desc, year);
    detail.city = parseCityFromKeywords(keywords);
    detail.summary = desc.slice(0, 100);
    return detail;
  } catch(e) {
    return {};
  }
}

// 抓赛事专属资讯标签页
async function scrapeEventNews(id) {
  try {
    const url = `https://zuicool.com/news/archives/tag/event${id}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    const text = await res.text();

    const items = [];
    // 格式：[标题 日期](链接)
    const lines = text.split("\n");
    for (const line of lines) {
      const m = line.match(/\[(.+?)\s+(\d{4}-\d{2}-\d{1,2})\]\((https:\/\/zuicool\.com\/news\/archives\/\d+)\)/);
      if (m) {
        const title = m[1].trim();
        const date  = m[2].length === 9 ? m[2].slice(0,8) + "0" + m[2].slice(8) : m[2];
        const url   = m[3];
        if (title && date) items.push({ title, date, url });
      }
    }
    return items;
  } catch(e) {
    return [];
  }
}

async function scrapePage(page) {
  const url = `https://zuicool.com/events?page=${page}&per-page=100`;
  console.log(`抓取第${page}页...`);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const races = [];
  const eventRegex = /<h4[^>]*>\s*<a[^>]+href="(https:\/\/zuicool\.com\/event\/(\d+))"[^>]*>\s*([^<]+)\s*<\/a>/g;
  let match;

  while ((match = eventRegex.exec(html)) !== null) {
    const url  = match[1];
    const id   = match[2];
    const name = match[3].trim();
    if (!name || name.includes("取消")) continue;

    const ctx = html.slice(match.index, match.index + 600);
    const dateM = ctx.match(/(\d{4})\.(\d{2})\.(\d{2})/);
    const raceDate = dateM ? `${dateM[1]}-${dateM[2]}-${dateM[3]}` : null;

    const regEndM = ctx.match(/报名截止[：:]\s*(\d{2}-\d{2})/);
    const regEnd = (regEndM && raceDate) ? `${raceDate.slice(0,4)}-${regEndM[1]}` : null;

    const locM = ctx.match(/\d{4}\.\d{2}\.\d{2}\s*·\s*([^\n<]+)/);
    const loc  = locM ? locM[1].trim() : "";
    const locParts = loc.split(/\s+/);
    const city = locParts.length >= 2 ? locParts[1] : locParts[0] || "";

    races.push({ name, url, id, raceDate, city, regEnd, raceType: parseRaceType(name + loc) });
  }
  return races;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const maxPages  = parseInt(req.query.pages || "1");
    const newsOnly  = req.query.newsonly === "1"; // 只抓资讯，跳过赛事写入
    const token = await getFeishuToken();
    const { raceTableId, newsTableId } = await getTableIds(token);
    if (!raceTableId) return res.status(400).json({ error: "找不到赛事信息表" });

    const existingRaces = await getExisting(token, raceTableId, "赛事名称");
    const existingNews  = await getExisting(token, newsTableId, "标题");

    let allRaces = [];
    for (let page = 1; page <= maxPages; page++) {
      try {
        const races = await scrapePage(page);
        allRaces = allRaces.concat(races);
        await new Promise(r => setTimeout(r, 500));
      } catch(e) {
        console.error(`第${page}页失败：`, e.message);
        break;
      }
    }

    let writtenRaces = 0, writtenNews = 0, skippedRaces = 0, skippedNews = 0;
    const seenRaces = new Set(existingRaces);
    const seenNews  = new Set(existingNews);

    for (const race of allRaces) {
      if (!race.name) continue;

      // 抓详情页
      const detail = await scrapeDetail(race.id, race.name);
      await new Promise(r => setTimeout(r, 300));

      // 写入赛事（新赛事才写）
      if (!newsOnly && !seenRaces.has(race.name)) {
        seenRaces.add(race.name);
        try {
          const fields = {
            "赛事名称": race.name,
            "城市":     detail.city || race.city || "",
            "状态":     "报名中",
            "赛事类型": race.raceType,
            "官网地址": { link: race.url, text: race.url },
          };
          const rd = detail.raceDate || race.raceDate;
          const rs = detail.regStart || null;
          const re = race.regEnd || null;
          if (rd) fields["比赛日期"] = new Date(rd).getTime();
          if (rs) fields["报名开始"] = new Date(rs).getTime();
          if (re) fields["报名截止"] = new Date(re).getTime();
          if (detail.scale) fields["赛事规模"] = detail.scale;

          await writeRecord(token, raceTableId, fields);
          writtenRaces++;
          await new Promise(r => setTimeout(r, 200));
        } catch(e) {
          console.error(`赛事写入失败 ${race.name}：`, e.message);
        }
      } else if (!newsOnly) {
        skippedRaces++;
      }

      // 抓并写入该赛事的资讯
      const newsItems = await scrapeEventNews(race.id);
      await new Promise(r => setTimeout(r, 300));
      console.log(`${race.name} 资讯：${newsItems.length} 条`);

      for (const item of newsItems) {
        if (seenNews.has(item.title)) { skippedNews++; continue; }
        seenNews.add(item.title);
        try {
          await writeRecord(token, newsTableId, {
            "标题":    item.title,
            "来源":    "最酷马拉松",
            "发布日期": new Date(item.date).getTime(),
            "链接":    { link: item.url, text: item.url },
            "摘要":    detail.summary || "",
            "分类":    parseCategory(item.title),
            "赛事类型": race.raceType,
          });
          writtenNews++;
          await new Promise(r => setTimeout(r, 150));
        } catch(e) {
          console.error(`资讯写入失败 ${item.title}：`, e.message);
        }
      }
    }

    res.status(200).json({ success: true, scraped: allRaces.length, writtenRaces, skippedRaces, writtenNews, skippedNews });
  } catch(e) {
    console.error("Handler 错误：", e.message);
    res.status(500).json({ error: e.message });
  }
}
