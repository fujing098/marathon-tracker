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

async function getTableId(token) {
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("获取表格列表失败：" + data.msg);
  return data.data.items[0].table_id;
}

async function getRecords(token, tableId) {
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records?page_size=50`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("获取记录失败：" + data.msg);
  return data.data.items || [];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const token = await getFeishuToken();
    const tableId = await getTableId(token);
    const records = await getRecords(token, tableId);

    const items = records
      .map(r => ({
        title:   r.fields["标题"] || "",
        source:  r.fields["来源"] || "",
        date:    r.fields["发布日期"] ? new Date(r.fields["发布日期"]).toISOString().slice(0,10) : "",
        url:     r.fields["链接"] || "",
        summary: r.fields["摘要"] || "",
        category:r.fields["分类"] || "赛事动态",
      }))
      .filter(i => i.title)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    res.status(200).json({ items });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
