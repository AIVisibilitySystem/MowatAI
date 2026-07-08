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

function checkMention(text, businessName) {
  const normalizedText = text.toLowerCase();
  const normalizedName = businessName.toLowerCase().trim();
  return normalizedText.includes(normalizedName);
}

// -----------------------------
// 🔍 PLATFORM QUERY FUNCTIONS
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
  if (!res.ok) throw new Error(`Perplexity request failed (${res.status})`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function queryChatGPT(prompt) {
  const response = await client.responses.create({
    model: "gpt-4.1-mini",
    tools: [{ type: "web_search" }],
    input: prompt
  });
  return response.output_text || "";
}

async function queryGemini(prompt, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": process.env.GEMINI_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }]
          })
        }
      );

      if (res.status === 503 && attempt < retries) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      if (!res.ok) throw new Error(`Gemini request failed (${res.status})`);

      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      return parts.map(p => p.text || "").join(" ").trim();
    } catch (err) {
      if (attempt === retries) throw err;
    }
  }
  return "";
}

// -----------------------------
// 🧠 RUN ONE PLATFORM ACROSS 3 QUERIES
// -----------------------------
async function runPlatform(platformName, queryFn, queries, businessName) {
  const results = [];
  for (const query of queries) {
    try {
      const answer = await queryFn(query);
      const mentioned = checkMention(answer, businessName);
      results.push({ query, answer, mentioned });
    } catch (err) {
      console.error(`${platformName} query failed:`, err.message);
      results.push({ query, answer: "", mentioned: false, error: true });
    }
  }
  const mentionCount = results.filter(r => r.mentioned).length;
  return { platform: platformName, queries: results, mentionCount, totalQueries: results.length };
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

    const [perplexityResult, chatgptResult, geminiResult] = await Promise.all([
      runPlatform("perplexity", queryPerplexity, queries, name),
      runPlatform("chatgpt", queryChatGPT, queries, name),
      runPlatform("gemini", queryGemini, queries, name)
    ]);

    const platforms = {
      perplexity: perplexityResult,
      chatgpt: chatgptResult,
      gemini: geminiResult
    };

    const totalMentionCount = perplexityResult.mentionCount + chatgptResult.mentionCount + geminiResult.mentionCount;
    const totalQueries = perplexityResult.totalQueries + chatgptResult.totalQueries + geminiResult.totalQueries;

    const analysisPrompt = `
You are an AI visibility analyst. A business was tested against ${queries.length} real search queries across THREE live AI platforms (Perplexity, ChatGPT with web search, Gemini with Google Search grounding).

Business: ${name}
Location: ${location}
Industry: ${industry}

Overall: mentioned in ${totalMentionCount} of ${totalQueries} total checks.

Perplexity: mentioned in ${perplexityResult.mentionCount} of ${perplexityResult.totalQueries}
ChatGPT: mentioned in ${chatgptResult.mentionCount} of ${chatgptResult.totalQueries}
Gemini: mentioned in ${geminiResult.mentionCount} of ${geminiResult.totalQueries}

Sample findings:
${[...perplexityResult.queries, ...chatgptResult.queries, ...geminiResult.queries]
  .slice(0, 9)
  .map((r, i) => `${i + 1}. "${r.query}" — ${r.mentioned ? "MENTIONED" : "NOT MENTIONED"}`)
  .join("\n")}

Based on this REAL data, return ONLY valid JSON:
{
  "score": <integer 0-100, based on overall mention rate across all 3 platforms>,
  "report": "2-3 sentence explanation referencing the actual per-platform pattern",
  "competitors": ["businesses that appeared in the answers instead, pulled from the actual findings"],
  "improvements": ["3 specific, actionable improvements based on the gaps found"]
}

Rules:
- ONLY JSON, NO markdown, NO extra text
- Write the report and improvements in natural, flowing prose, as a human consultant would write them — no bullet dashes, no markdown symbols, no pipe characters, no numbered list formatting inside the text itself
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
        score: Math.round((totalMentionCount / totalQueries) * 100),
        report: `Mentioned in ${totalMentionCount} of ${totalQueries} checks across Perplexity, ChatGPT, and Gemini.`,
        competitors: ["N/A"],
        improvements: ["Try running the audit again"]
      };
    }

    res.json({
      score: ai.score,
      report: ai.report,
      competitors: ai.competitors,
      improvements: ai.improvements,
      platforms: platforms,
      mentionCount: totalMentionCount,
      totalQueries: totalQueries
    });

  } catch (err) {
    console.error(err);
    res.json({
      score: 0,
      report: "Server error",
      competitors: [],
      improvements: [],
      platforms: {},
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
        to: "katielmowat@gmail.com",
        subject: `New message from ${name}`,
        text: `From: ${name} (${email})\n\nMessage:\n${message}`
      })
    });

    if (!emailRes.ok) {
      const errorBody = await emailRes.text();
      console.error("Resend API error:", emailRes.status, errorBody);
      throw new Error("Failed to send email");
    }

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
