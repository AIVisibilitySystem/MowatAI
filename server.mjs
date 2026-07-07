import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// -----------------------------
// 🔍 QUERY PERPLEXITY (real-time web-aware AI)
// -----------------------------
async function queryPerplexity(prompt) {
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!res.ok) {
    throw new Error(`Perplexity request failed (${res.status})`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function checkMention(text, businessName) {
  const normalizedText = text.toLowerCase();
  const normalizedName = businessName.toLowerCase().trim();
  return normalizedText.includes(normalizedName);
}

// -----------------------------
// 🚀 API ENDPOINT
// -----------------------------
app.post("/audit", async (req, res) => {
  const { name, location, industry } = req.body;

  try {
    const queries = [
      `Best ${industry} in ${location}`,
      `Top rated ${industry} near me in ${location}`,
      `Who should I contact for ${industry} services in ${location}?`
    ];

    const queryResults = [];
    for (const query of queries) {
      const answer = await queryPerplexity(query);
      const mentioned = checkMention(answer, name);
      queryResults.push({ query, answer, mentioned });
    }

    const mentionCount = queryResults.filter(r => r.mentioned).length;
    const totalQueries = queryResults.length;

    const analysisPrompt = `
You are an AI visibility analyst. A business was tested against ${totalQueries} real search queries on a live AI search platform. It was mentioned in ${mentionCount} out of ${totalQueries} queries.

Business: ${name}
Location: ${location}
Industry: ${industry}

Query results:
${queryResults.map((r, i) => `${i + 1}. "${r.query}" — ${r.mentioned ? "MENTIONED" : "NOT MENTIONED"}`).join("\n")}

Based on this REAL data, return ONLY valid JSON:
{
  "score": <integer 0-100, based on mention rate: ${mentionCount}/${totalQueries}>,
  "report": "2-3 sentence explanation referencing the actual mention rate and pattern across queries",
  "competitors": ["businesses that appeared in the answers instead, pulled from the actual query answers"],
  "improvements": ["3 specific, actionable improvements based on the gaps found"]
}

Rules:
- ONLY JSON, NO markdown, NO extra text
`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: analysisPrompt
    });

    let ai;
    try {
      ai = JSON.parse(response.output_text);
      if (
        typeof ai.score !== "number" ||
        !ai.report ||
        !Array.isArray(ai.competitors) ||
        !Array.isArray(ai.improvements)
      ) {
        throw new Error("Invalid AI structure");
      }
    } catch (e) {
      ai = {
        score: Math.round((mentionCount / totalQueries) * 100),
        report: `Mentioned in ${mentionCount} of ${totalQueries} test queries.`,
        competitors: ["N/A"],
        improvements: ["Try running the audit again"]
      };
    }

    res.json({
      score: ai.score,
      report: ai.report,
      competitors: ai.competitors,
      improvements: ai.improvements,
      queryResults: queryResults,
      mentionCount: mentionCount,
      totalQueries: totalQueries
    });

  } catch (err) {
    console.error(err);
    res.json({
      score: 0,
      report: "Server error",
      competitors: [],
      improvements: [],
      queryResults: [],
      mentionCount: 0,
      totalQueries: 0
    });
  }
});

// -----------------------------
// 📧 CONTACT FORM ENDPOINT
// -----------------------------
app.post("/contact", async (req, res) => {
  const { name, email, message } = req.body;

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Contact Form <onboarding@resend.dev>",
        to: "katherinemowat@findmelaw.co.uk",
        subject: `New message from ${name}`,
        text: `From: ${name} (${email})\n\nMessage:\n${message}`
      })
    });

    if (!emailRes.ok) throw new Error("Failed to send email");
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

app.get("/", (req, res) => {
  res.send("AI Visibility API is running");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
