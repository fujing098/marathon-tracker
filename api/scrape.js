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
    raceTableId: tables.find(t => t.name.includes("赛事信息"))?.table_id,
  };
}

async function getExistingRaces(token, tableId) {
  if (!tableId) return new Set();
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records?page_size=200`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) return new Set();
  return new Set((data.data.items || []).map(r => r.fields["赛事名称"] || ""));
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
  if (text.includes("越野") || text.includes("trail") || text.includes("Trail") || text.includes("山径") || text.includes("徒步")) return "越野赛";
  if (text.includes("铁人") || text.includes("triathlon") || text.includes("骑行") || text.includes("游泳")) return "其他赛事";
  return "马拉松";
}

function parseCity(locationText) {
  if (!locationText) return "";
  // 尝试提取省市信息
  const parts = locationText.split(" ").filter(Boolean);
  // 通常格式：省 市 区 详细地址
  if (parts.length >= 2) return parts[1]; // 返回市级
  if (parts.length === 1) return parts[0];
  return "";
}

async function scrapePage(page) {
  const url = `https://zuicool.com/events?page=${page}&per-page=100`;
  console.log(`抓取第${page}页: ${url}`);
  
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
    },
  });
  
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  
  const races = [];
  
  // 匹配赛事块：从 <h4> 标签提取赛事名称和链接
  const eventRegex = /<h4[^>]*>\s*<a[^>]+href="(https:\/\/zuicool\.com\/event\/(\d+))"[^>]*>\s*([^<]+)\s*<\/a>/g;
  let match;
  
  while ((match = eventRegex.exec(html)) !== null) {
    const url   = match[1];
    const id    = match[2];
    const name  = match[3].trim();
    
    // 跳过取消/延期的赛事
    if (name.includes("取消") || name.includes("延期")) continue;
    
    // 提取该赛事块的上下文（往后500字符）
    const startIdx = match.index;
    const context  = html.slice(startIdx, startIdx + 800);
    
    // 提取日期：格式 2026.05.10
    const dateMatch = context.match(/(\d{4})\.(\d{2})\.(\d{2})/);
    const raceDate  = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
    
    // 提取地点
    const locMatch = context.match(/(\d{4}\.\d{2}\.\d{2})\s*·\s*([^\n<]+)/);
    const location = locMatch ? locMatch[2].trim() : "";
    
    // 提取报名截止
    const regEndMatch = context.match(/报名截止[：:]\s*(\d{2}-\d{2})/);
    let regEnd = null;
    if (regEndMatch && raceDate) {
      const year = raceDate.slice(0, 4);
      regEnd = `${year}-${regEndMatch[1].replace("-", "-")}`;
    }
    
    const city     = parseCity(location);
    const raceType = parseRaceType(name + location);
    
    races.push({ name, url, id, raceDate, city, location, regEnd, raceType });
  }
  
  return races;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const maxPages = parseInt(req.query.pages || "3");
    const token = await getFeishuToken();
    const { raceTableId } = await getTableIds(token);
    
    if (!raceTableId) {
      return res.status(400).json({ error: "找不到赛事信息表" });
    }
    
    const existingRaces = await getExistingRaces(token, raceTableId);
    console.log(`已有赛事：${existingRaces.size} 场`);
    
    let allRaces = [];
    for (let page = 1; page <= maxPages; page++) {
      try {
        const races = await scrapePage(page);
        allRaces = allRaces.concat(races);
        console.log(`第${page}页抓取：${races.length} 场`);
        await new Promise(r => setTimeout(r, 500));
      } catch(e) {
        console.error(`第${page}页失败：`, e.message);
        break;
      }
    }
    
    console.log(`总计抓取：${allRaces.length} 场`);
    
    // 去重并写入
    let written = 0;
    let skipped = 0;
    const seenNames = new Set(existingRaces);
    
    for (const race of allRaces) {
      if (!race.name || seenNames.has(race.name)) { skipped++; continue; }
      seenNames.add(race.name);
      
      try {
        const fields = {
          "赛事名称": race.name,
          "城市":     race.city || "",
          "状态":     "报名中",
          "赛事类型": race.raceType,
          "官网地址": race.url ? { link: race.url, text: race.url } : "",
        };
        if (race.raceDate) fields["比赛日期"] = new Date(race.raceDate).getTime();
        if (race.regEnd)   fields["报名截止"] = new Date(race.regEnd + "-01").getTime();
        
        await writeRecord(token, raceTableId, fields);
        written++;
        await new Promise(r => setTimeout(r, 200));
      } catch(e) {
        console.error(`写入失败 ${race.name}：`, e.message);
      }
    }
    
    res.status(200).json({
      success: true,
      scraped: allRaces.length,
      written,
      skipped,
    });
  } catch(e) {
    console.error("Handler 错误：", e.message);
    res.status(500).json({ error: e.message });
  }
}
