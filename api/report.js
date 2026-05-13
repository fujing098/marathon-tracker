const APP_TOKEN = "F1rmb1U2oaPqULsAtq5cqj7hnbh";
const TRACKER_URL = "https://marathon-tracker-v2.vercel.app";

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
  const res = await fetch("https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ emails: [email] }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("获取用户 ID 失败：" + data.msg);
  const user = data.data?.user_list?.[0];
  if (!user?.user_id) throw new Error("未找到用户，请确认邮箱正确");
  return user.user_id;
}

async function getNewsRecords(token) {
  // 获取推文资讯表 ID
  const tabRes = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const tabData = await tabRes.json();
  if (tabData.code !== 0) throw new Error("获取表格失败");
  const tables = tabData.data.items;
  const newsTable = tables.find(t => t.name.includes("推文")) || tables[0];

  // 读取最近20条资讯
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${newsTable.table_id}/records?page_size=20`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("获取记录失败");
  return data.data.items || [];
}

// 发送飞书卡片消息
async function sendCardMessage(token, userId, items) {
  const today = new Date().toISOString().slice(0, 10);

  // 构建卡片内容的 elements
  const elements = [];

  items.forEach((n, i) => {
    const catEmoji = n.category === "报名信息" ? "🟢" : n.category === "成绩结果" ? "🏆" : "📢";
    const text = `${catEmoji} **${n.title}**\n来源：${n.source}　日期：${n.date}`;

    if (n.url) {
      elements.push({
        tag: "action",
        actions: [{
          tag: "button",
          text: { tag: "plain_text", content: `${i + 1}. ${n.title}` },
          type: "default",
          url: n.url,
        }]
      });
    } else {
      elements.push({
        tag: "div",
        text: { tag: "lark_md", content: `${i + 1}. ${catEmoji} ${n.title}\n来源：${n.source}　${n.date}` }
      });
    }
  });

  // 底部查看全部按钮
  elements.push({ tag: "hr" });
  elements.push({
    tag: "action",
    actions: [{
      tag: "button",
      text: { tag: "plain_text", content: "🔗 查看完整赛事追踪" },
      type: "primary",
      url: TRACKER_URL,
    }]
  });

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `🏃 马拉松赛事资讯日报（${today}）` },
      template: "green",
    },
    elements,
  };

  const res = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      receive_id: userId,
      msg_type: "interactive",
      content: JSON.stringify(card),
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
    const token  = await getFeishuToken();
    const userId = await getUserId(token, process.env.FEISHU_USER_EMAIL);
    const records = await getNewsRecords(token);

    const items = records
      .map(r => ({
        title:    r.fields["标题"] || "",
        source:   r.fields["来源"] || "",
        date:     r.fields["发布日期"] ? new Date(r.fields["发布日期"]).toISOString().slice(0, 10) : "",
        // 修复：链接字段是对象，取 .link
        url:      r.fields["链接"]?.link || r.fields["链接"] || "",
        category: r.fields["分类"] || "赛事动态",
      }))
      .filter(i => i.title)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8); // 每次推送最多8条

    if (!items.length) {
      return res.status(200).json({ success: true, message: "暂无资讯，跳过推送" });
    }

    await sendCardMessage(token, userId, items);
    res.status(200).json({ success: true, message: "日报已发送", count: items.length });
  } catch(e) {
    console.error("report 错误：", e.message);
    res.status(500).json({ error: e.message });
  }
}
