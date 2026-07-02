import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();

app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/", (req, res) => {
  res.send("AI Visibility API is running");
});

app.post("/audit", async (req, res) => {
  const { name, location, industry } = req.body;

  try {
    // ----------------------------
    // 1. REAL DETERMINISTIC SCORE
    // ----------------------------
    let score = 100;

    // Basic heuristics (you can improve later)
    if (!name || name.length < 3) score -= 20;
    if (!location || location.length < 3) score -= 10;
    if (!industry || industry.length < 3) score -= 10;

    const lowerName = name.toLowerCase();

    if (lowerName.includes("test")) score -= 20;
    if (lowerName.includes("demo")) score -= 20;

    // Clamp score
    if (score < 0) score = 0;
    if (score > 100) score = 100;

    // ----------------------------
    // 2. AI ONLY EXPLAINS SCORE
    // ----------------------------
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: `
You are an AI visibility analyst.

A deterministic scoring system has already calculated this score:

Score: ${score}/100
Business:
Name: ${name}
Location: ${location}
Industry: ${industry}

Your job:
- Explain WHY the score might be this value
- Give 3 competitors in this space
- Give 3 actionable improvements

DO NOT change the score.
DO NOT recalculate it.
Only explain it clearly and professionally.
`
    });

   res.json({
  result: JSON.stringify({
    score,
    report: response.output_text
  })
});

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

