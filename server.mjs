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
// 🚀 API ENDPOINT
// -----------------------------
app.post("/audit", async (req, res) => {
  const { name, location, industry } = req.body;

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: `
You are an AI visibility analyst. You assess how visible and recognized a business is likely to be to AI systems (like ChatGPT, Perplexity, Claude) when users ask about businesses in their industry and location.

Business:
Name: ${name}
Location: ${location}
Industry: ${industry}

Score the business from 0-100 on AI visibility, considering:
- How likely this business is to be known or cited by AI models
- How established/recognizable the name sounds within its industry
- Whether the business has the kind of digital footprint (reviews, press, content) that AI models typically learn from
- Competitive strength versus likely competitors in the same industry and location

Return ONLY valid JSON in this exact format:
{
  "score": <integer 0-100>,
  "report": "short explanation of the score, 2-3 sentences",
  "competitors": ["competitor 1", "competitor 2", "competitor 3"],
  "improvements": ["improvement 1", "improvement 2", "improvement 3"]
}

Rules:
- ONLY JSON
- NO markdown
- NO extra text
- Be realistic and vary scores meaningfully based on the business details provided — do not default to a fixed number
`
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
      // Fallback only if the AI response is malformed — not a real score
      ai = {
        score: 0,
        report: "AI parsing failed — could not generate a real score",
        competitors: ["N/A", "N/A", "N/A"],
        improvements: ["Try running the audit again"]
      };
    }

    // -----------------------------
    // 🔌 CLEAN RESPONSE FORMAT
    // -----------------------------
    res.json({
      score: ai.score,
      report: ai.report,
      competitors: ai.competitors,
      improvements: ai.improvements
    });

  } catch (err) {
    console.error(err);

    res.json({
  score: ai.score,
  report: ai.report,
  competitors: ai.competitors,
  improvements: ai.improvements,
  aiRawAnswer: perplexityAnswer,
  wasMentioned: wasMentioned
});

app.get("/", (req, res) => {
  res.send("AI Visibility API is running");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
