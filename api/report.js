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
  if (data.code !== 0) throw new Error("获取 Token 失败：" + data.msg);
  return data.tenant_access_token;
}

async function getUserId(token, email) {
  const res = await fetch(`https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ emails: [email] }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("获取用户 ID 失败：" + data.msg);
  const user = data.data?.user_list?.[0];
  if (!user?.user_id) throw new Error("未找到用户，请确认邮箱正确");
  return user.user_id;
}

async function getTableId(token) {
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("获取表格失败：" + data.msg);
  return data.data.items[0].table_id;
}

async function getRecords(token, tableId) {
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records?page_size=20`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("获取记录失败：" + data.msg);
  return data.data.items || [];
}

async function sendMessage(token, userId, content) {
  const res = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      receive_id: userId,
      msg_type: "text",
      content: JSON.stringify({ text: content }),
    }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("发送消息失败：" + data.msg);
  return data;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const token = await getFeishuToken();
    const userId = await getUserId(token, process.env.FEISHU_USER_EMAIL);
    const tableId = await getTableId(token);
    const records = await getRecords(token, tableId);

    const items = records
      .map(r => ({
        title:    r.fields["标题"] || "",
        source:   r.fields["来源"] || "",
        date:     r.fields["发布日期"] ? new Date(r.fields["发布日期"]).toISOString().slice(0,10) : "",
        url:      r.fields["链接"] || "",
        category: r.fields["分类"] || "赛事动态",
      }))
      .filter(i => i.title)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);

    const today = new Date().toISOString().slice(0, 10);
    const lines = items.map((n, i) =>
      `${i + 1}. 【${n.category}】${n.title}\n   来源：${n.source}  日期：${n.date}${n.url ? "\n   链接：" + n.url : ""}`
    ).join("\n\n");

    const content = `📋 马拉松赛事资讯日报（${today}）\n\n${lines}\n\n共 ${items.length} 条 · 查看完整内容：https://project-y57va.vercel.app`;

    await sendMessage(token, userId, content);
    res.status(200).json({ success: true, message: "报告已发送", count: items.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
