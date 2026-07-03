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
    const recommendationPrompt = `What are the best ${industry} businesses in ${location}? List a few specific names.`;
    const perplexityAnswer = await queryPerplexity(recommendationPrompt);
    const wasMentioned = checkMention(perplexityAnswer, name);

    const analysisPrompt = `
You are an AI visibility analyst. You are given REAL results from querying a live, web-connected AI (Perplexity) about a business. Use these real findings to produce an honest visibility score.

Business: ${name}
Location: ${location}
Industry: ${industry}

REAL FINDING - When asked "best ${industry} businesses in ${location}", the business was ${wasMentioned ? "MENTIONED" : "NOT MENTIONED"} in the AI's answer.
Full answer received: "${perplexityAnswer}"

Based on this REAL finding, return ONLY valid JSON:
{
  "score": <integer 0-100, weighted heavily toward whether the business was actually mentioned>,
  "report": "2-3 sentence explanation referencing the actual finding above",
  "competitors": ["names actually mentioned in the finding, if any — otherwise your best inference"],
  "improvements": ["3 specific, actionable improvements based on what's missing"]
}

Rules:
- ONLY JSON, NO markdown, NO extra text
- Be honest — if the business wasn't mentioned, the score should reflect that clearly (low score)
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
        score: wasMentioned ? 60 : 20,
        report: "Analysis completed based on live AI search, but detailed report generation failed.",
        competitors: ["N/A"],
        improvements: ["Try running the audit again"]
      };
    }

    res.json({
      score: ai.score,
      report: ai.report,
      competitors: ai.competitors,
      improvements: ai.improvements,
      aiRawAnswer: perplexityAnswer,
      wasMentioned: wasMentioned
    });

  } catch (err) {
    console.error(err);
    res.json({
      score: 0,
      report: "Server error — could not complete live AI visibility check",
      competitors: [],
      improvements: [],
      aiRawAnswer: "",
      wasMentioned: false
    });
  }
});

app.get("/", (req, res) => {
  res.send("AI Visibility API is running");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

