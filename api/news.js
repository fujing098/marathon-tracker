export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.LITELLM_API_KEY;
  const apiUrl = process.env.LITELLM_API_URL || "https://litellm.sre.gotokeep.com/v1/chat/completions";

  if (!apiKey) return res.status(500).json({ error: "API Key 未配置" });

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: `搜索今天最新的中国马拉松赛事资讯，包括报名信息、赛事动态、成绩公告等。返回8条最新内容，严格按JSON数组格式输出，不要任何其他文字：[{"title":"标题","source":"来源媒体","date":"YYYY-MM-DD","url":"链接或空字符串","summary":"50字以内摘要","category":"报名信息或赛事动态或成绩结果"}]`
        }]
      })
    });

    if (!response.ok) throw new Error(`LiteLLM 请求失败 ${response.status}`);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("["), end = clean.lastIndexOf("]");
    if (start === -1) throw new Error("返回格式异常");
    const items = JSON.parse(clean.slice(start, end + 1));
    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
