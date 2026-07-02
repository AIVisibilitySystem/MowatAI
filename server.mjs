
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
// 🧠 STABLE SCORING (NO RANDOMNESS)
// -----------------------------
function generateScore(name, location, industry) {
  let score = 100;

  if (!name || name.length < 3) score -= 35;
  if (!location || location.length < 3) score -= 20;
  if (!industry || industry.length < 3) score -= 20;

  const n = (name || "").toLowerCase();
  if (n.includes("test")) score -= 40;
  if (n.includes("demo")) score -= 40;
  if (n.includes("company")) score -= 10;
  if (n.includes("new")) score -= 10;

  const weakIndustries = ["unknown", "other", "misc"];
  if (weakIndustries.includes((industry || "").toLowerCase())) {
    score -= 25;
  }

  let seed = 0;
  const str = (name + location + industry);
  for (let i = 0; i < str.length; i++) {
    seed += str.charCodeAt(i);
  }
  score -= seed % 25;

  score = Math.max(5, Math.min(95, score));
  return Math.round(score);
}

// -----------------------------
// 🚀 API ENDPOINT
// -----------------------------
app.post("/audit", async (req, res) => {
  const { name, location, industry } = req.body;

  try {
    const score = generateScore(name, location, industry);

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: `
You are an AI visibility analyst.
Return ONLY valid JSON.

Business:
Name: ${name}
Location: ${location}
Industry: ${industry}
Score: ${score}

Return format:
{
  "report": "short explanation of score",
  "competitors": ["competitor 1", "competitor 2", "competitor 3"],
  "improvements": ["improvement 1", "improvement 2", "improvement 3"]
}

Rules:
- ONLY JSON
- NO markdown
- NO extra text
`
    });

    let ai;
    try {
      ai = JSON.parse(response.output_text);
    } catch (e) {
      ai = {
        report: "AI parsing failed",
        competitors: ["N/A", "N/A", "N/A"],
        improvements: ["Improve SEO", "Improve branding", "Improve marketing"]
      };
    }

    // -----------------------------
    // 🔌 CLEAN RESPONSE FORMAT (no double-encoding)
    // -----------------------------
    res.json({
      score,
      report: ai.report,
      competitors: ai.competitors,
      improvements: ai.improvements
    });

  } catch (err) {
    console.error(err);

    res.json({
      score: 0,
      report: "Server error",
      competitors: [],
      improvements: []
    });
  }
});

app.get("/", (req, res) => {
  res.send("AI Visibility API is running");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
