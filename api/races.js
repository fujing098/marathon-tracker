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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const token = await getFeishuToken();

    // 获取表格列表
    const tablesRes = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const tablesData = await tablesRes.json();
    const tables = tablesData.data.items;
    const raceTable = tables.find(t => t.name.includes("赛事信息"));
    if (!raceTable) return res.status(200).json({ races: [] });

    // 读取赛事记录
    const recordsRes = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${raceTable.table_id}/records?page_size=200`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const recordsData = await recordsRes.json();
    const races = (recordsData.data.items || []).map(r => r.fields);

    res.status(200).json({ races });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
