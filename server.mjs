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
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: `You are an AI visibility scoring engine.

Use this strict scoring system:
0–20 weak
21–40 low
41–60 average
61–80 strong
81–100 dominant

Business:
Name: ${name}
Location: ${location}
Industry: ${industry}

Return ONLY JSON:
{
  "score": number,
  "reasons": ["1", "2", "3"],
  "competitors": ["1", "2", "3"],
  "improvements": ["1", "2", "3"]
}`
    });

    res.json({
      result: response.output_text
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
