import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// API route
app.post("/audit", async (req, res) => {
  const { name, location, industry } = req.body;

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: `You are an AI visibility analyst.

Analyse this real business:
Name: ${name}
Location: ${location}
Industry: ${industry}

Be specific and do NOT say "unspecified business".

Return:

1. AI Visibility Score (0-100)
2. Why they are/aren’t visible in AI search
3. 3 real competitors in their niche/location
4. 3 actionable improvements

Keep it concise and practical.`
    });

    res.json({
      result: response.output[0].content[0].text
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// start server
app.listen(3000, () => {
  console.log("AI Visibility API running on http://localhost:3000");
});
