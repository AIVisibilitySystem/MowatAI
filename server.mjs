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

async function queryGemini(prompt, maxRetries = 3) {
  const models = ["gemini-2.5-flash", "gemini-2.0-flash"];

  for (const model of models) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
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

        if (res.status === 503) {
          const waitMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        if (!res.ok) throw new Error(`Gemini request failed (${res.status})`);

        const data = await res.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        return parts.map(p => p.text || "").join(" ").trim();
      } catch (err) {
        if (attempt === maxRetries - 1) break;
      }
    }
  }
  throw new Error("Gemini request failed on all models after retries");
}

// -----------------------------
// 🧠 RUN ONE PLATFORM ACROSS ALL QUERIES
// -----------------------------
async function runPlatform(platformName, queryFn, queries, businessName) {
  const results = [];
  for (const query of queries) {
    try {
      const answer = await queryFn(query);
      const mentioned = checkMention(answer, businessName);
      results.push({ query, answer, mentioned, error: false });
    } catch (err) {
      console.error(`${platformName} query failed:`, err.message);
      results.push({ query, answer: "", mentioned: false, error: true });
    }
  }

  const validResults = results.filter(r => !r.error);
  const mentionCount = validResults.filter(r => r.mentioned).length;
  const totalQueries = validResults.length;
  const failedQueries = results.length - validResults.length;

  return {
    platform: platformName,
    queries: results,
    mentionCount,
    totalQueries,
    failedQueries
  };
}

// -----------------------------
// 🩹 JSON REPAIR STEP
// -----------------------------
async function repairJson(brokenText) {
  const repairPrompt = `
The following text was supposed to be valid JSON in this exact shape, but it isn't valid. Fix it and return ONLY the corrected valid JSON, nothing else, no markdown, no explanation.

Required shape:
{
  "score": <integer 0-100>,
  "report": "string",
  "competitors": ["string", "string", "string"],
  "improvements": ["string", "string", "string"]
}

Broken text to fix:
"""
${brokenText}
"""
`;
  const response = await client.responses.create({
    model: "gpt-4.1-mini",
    input: repairPrompt
  });
  return JSON.parse(response.output_text);
}

// -----------------------------
// 🧩 FALLBACK: pull likely competitor names directly from raw answers
// -----------------------------
function extractLikelyBusinessNames(platforms, excludeName) {
  const allText = Object.values(platforms)
    .flatMap(p => p.queries.map(q => q.answer))
    .join(" ");

  const matches = allText.match(/\b([A-Z][a-zA-Z]+(?:\s+&?\s?[A-Z][a-zA-Z]+){1,3})\b/g) || [];

  const cleaned = [...new Set(matches)]
    .filter(name => name.toLowerCase() !== excludeName.toLowerCase())
    .filter(name => !["The", "This", "That", "Based On", "According To"].some(bad => name.startsWith(bad)))
    .slice(0, 5);

  return cleaned.length > 0 ? cleaned : ["No clear competitors identified in this audit"];
}

// -----------------------------
// 🚀 API ENDPOINT
// -----------------------------
app.post("/audit", async (req, res) => {
  const { name, location, industry, customQueries } = req.body;

  try {
    const defaultQueries = [
      `Best ${industry} in ${location}`,
      `Top rated ${industry} near me in ${location}`,
      `Who should I contact for ${industry} services in ${location}?`
    ];

    const queries =
      Array.isArray(customQueries) &&
      customQueries.filter(q => typeof q === "string" && q.trim().length > 0).length > 0
        ? customQueries
            .filter(q => typeof q === "string" && q.trim().length > 0)
            .slice(0, 5)
        : defaultQueries;

    const usedCustomQueries = queries !== defaultQueries;

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
    const totalFailedQueries = perplexityResult.failedQueries + chatgptResult.failedQueries + geminiResult.failedQueries;

    if (totalQueries === 0) {
      return res.json({
        score: null,
        report: "We couldn't complete this audit right now — all platform checks failed. Please try again in a moment.",
        competitors: [],
        improvements: [],
        platforms: platforms,
        mentionCount: 0,
        totalQueries: 0,
        failedQueries: totalFailedQueries,
        auditFailed: true,
        usedCustomQueries
      });
    }

    const realMentionLine = `Mentioned in ${totalMentionCount} of ${totalQueries} completed checks across Perplexity, ChatGPT, and Gemini.`;

    const analysisPrompt = `
You are an AI visibility analyst. A business was tested against real search queries across up to THREE live AI platforms (Perplexity, ChatGPT with web search, Gemini with Google Search grounding). Some individual checks may have failed to run due to technical issues — those are excluded from these numbers entirely, so all figures below reflect only checks that actually completed.

Business: ${name}
Location: ${location}
Industry: ${industry}

${realMentionLine}
${totalFailedQueries > 0 ? `Note: ${totalFailedQueries} check(s) failed to run and are excluded from this data.` : ""}

Perplexity: mentioned in ${perplexityResult.mentionCount} of ${perplexityResult.totalQueries} completed checks${perplexityResult.failedQueries > 0 ? ` (${perplexityResult.failedQueries} failed)` : ""}
ChatGPT: mentioned in ${chatgptResult.mentionCount} of ${chatgptResult.totalQueries} completed checks${chatgptResult.failedQueries > 0 ? ` (${chatgptResult.failedQueries} failed)` : ""}
Gemini: mentioned in ${geminiResult.mentionCount} of ${geminiResult.totalQueries} completed checks${geminiResult.failedQueries > 0 ? ` (${geminiResult.failedQueries} failed)` : ""}

Full raw answers from every check (use this to identify real competitor names actually mentioned):
${[...perplexityResult.queries, ...chatgptResult.queries, ...geminiResult.queries]
  .filter(r => !r.error)
  .map((r, i) => `${i + 1}. Query: "${r.query}"\nAnswer: ${r.answer}\n`)
  .join("\n")}

Based on this REAL data, return ONLY valid JSON in exactly this shape:
{
  "score": <integer 0-100, based on the exact mention rate stated above: ${totalMentionCount} of ${totalQueries}>,
  "report": "2-3 sentence explanation. You MUST state the mention count exactly as: ${totalMentionCount} of ${totalQueries}. Do not restate or recalculate this number differently.",
  "competitors": ["3-5 real business names that actually appear in the raw answers above, exactly as written there"],
  "improvements": ["3 specific, actionable improvements based on the gaps found"]
}

Rules:
- ONLY JSON, NO markdown, NO extra text, NO trailing commas
- competitors MUST be real names pulled from the raw answers above, never invented, never "N/A" — if truly no other business is named anywhere in the raw answers, return an empty array []
- Write the report and improvements in natural, flowing prose, as a human consultant would write them — no bullet dashes, no markdown symbols, no pipe characters, no numbered list formatting inside the text itself
`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: analysisPrompt
    });

    let ai;
    let usedFallback = false;

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
      console.error("Initial JSON parse failed. Raw output was:", response.output_text);

      try {
        ai = await repairJson(response.output_text);
        if (
          typeof ai.score !== "number" ||
          !ai.report ||
          !Array.isArray(ai.competitors) ||
          !Array.isArray(ai.improvements)
        ) {
          throw new Error("Repaired JSON still invalid");
        }
      } catch (repairErr) {
        console.error("JSON repair also failed:", repairErr.message);

        usedFallback = true;
        ai = {
          score: Math.round((totalMentionCount / totalQueries) * 100),
          report: realMentionLine,
          competitors: extractLikelyBusinessNames(platforms, name),
          improvements: [
            "Increase content that directly references your services and service area",
            "Encourage client reviews and mentions on sites AI platforms commonly cite",
            "Re-run this audit after making changes to confirm improvement"
          ]
        };
      }
    }

    res.json({
      score: ai.score,
      report: ai.report,
      competitors: ai.competitors,
      improvements: ai.improvements,
      platforms: platforms,
      mentionCount: totalMentionCount,
      totalQueries: totalQueries,
      failedQueries: totalFailedQueries,
      auditFailed: false,
      usedCustomQueries,
      usedFallback
    });

  } catch (err) {
    console.error(err);
    res.json({
      score: null,
      report: "Server error — could not complete audit",
      competitors: [],
      improvements: [],
      platforms: {},
      mentionCount: 0,
      totalQueries: 0,
      failedQueries: 0,
      auditFailed: true,
      usedCustomQueries: false,
      usedFallback: false
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
