export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const today = new Date().toISOString().slice(0, 10);
    const response = await fetch("https://api.moonshot.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.KIMI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "moonshot-v1-8k",
        max_tokens: 2000,
        tools: [{
          type: "builtin_function",
          function: { name: "$web_search" }
        }],
        messages: [{
          role: "user",
          content: `今天是${today}，请联网搜索最近7天内中国马拉松赛事的真实最新资讯，包括：报名开始、赛事公告、成绩发布等。只返回真实存在的最新新闻。

严格返回JSON数组，不要任何其他文字：
[{"title":"资讯标题","source":"媒体来源","date":"YYYY-MM-DD","url":"原文链接或空字符串","summary":"50字以内摘要","category":"报名信息或赛事动态或成绩结果"}]

返回5-10条。`
        }],
      }),
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "[]";
    const clean = text.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("["), end = clean.lastIndexOf("]");
    if (start === -1) throw new Error("返回格式异常");
    const items = JSON.parse(clean.slice(start, end + 1));

    res.status(200).json({ items });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
