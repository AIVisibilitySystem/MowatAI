import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function runAudit(businessName, location, industry) {
  const response = await client.responses.create({
    model: "gpt-4.1-mini",
    input: `
You are an AI search visibility expert.

Analyse this business:

Business name: ${businessName}
Location: ${location}
Industry: ${industry}

Return:

1. AI visibility score (0–100)
2. Why this business may or may not appear in AI search results
3. Top 3 competitors likely appearing instead
4. 3 improvements to increase AI visibility across AI search tools (ChatGPT, Perplexity, Gemini)
5. A short summary for a business owner
`
  });

  return response.output_text;
}

// TEST
runAudit("Joe's Coffee Shop", "London", "Cafe")
  .then(console.log);
runAudit("De Jure Chambers Limited", "London", "Law Firm")
  .then(console.log);
