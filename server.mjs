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

/**
 * 🧠 DETERMINISTIC SCORE FUNCTION (ALWAYS SAME INPUT = SAME SCORE)
 */
function generateScore(name, location, industry) {
  let score = 70;

  if (name) score += name.length % 10;
  if (location) score += location.length % 7;
  if (industry) score += industry.length % 5;

  // penalties for weak inputs
  if (!name || name.length < 3) score -= 20;
  if (!location || location.length < 3) score -= 10;
  if (!industry || industry.length < 3) score -= 10;

  // keep stable range
  score = Math.max(10, Math.min(95, score));

  return Math.round(score);
}

/**
 * 🧠 /audit endpoint
 */
app.post("/audit", async (req, res) => {
  const { name, location, industry } = req.body;

  try {
    // 1. Stable deterministic score (NO RANDOMNESS)
    const score = generateScore(name, location, industry);

    // 2. AI generates structured insights ONLY
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: `
You are an AI visibility analyst.

Return ONLY valid JSON. No markdown. No extra text.

Business:
Name: ${name}
Location: ${location}
Industry: ${industry}
Score: ${score}

Return exactly this format:

{
  "competitors": ["competitor 1", "competitor 2", "competitor 3"],
  "improvements": ["improvement 1", "improvement 2", "improvement 3"],
  "report": "short explanation of the score"
}

Rules:
- competitors must be real companies in this industry
- improvements must be actionable
- do not include extra text
`
    });

    // 3. Safe JSON parsing
    let ai;
    try {
      ai = JSON.parse(response.output_text);
    } catch (e) {
      ai = {
        competitors: ["N/A", "N/A", "N/A"],
        improvements: ["Improve SEO", "Improve branding", "Improve marketing"],
        report: response.output_text
      };
    }

    // 4. FINAL CLEAN RESPONSE (LOVABLE READY)
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
      report: "Server error occurred",
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
