require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");
const { QdrantClient } = require("@qdrant/js-client-rest");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

async function embedOne(text) {
  const response = await ai.models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
  });

  return response.embeddings[0].values;
}

async function main() {
  const query = "লে শাতেলিয়ের নীতি কী? সহজভাবে ব্যাখ্যা কর।";
  const qvec = await embedOne(query);

  const res = await client.search(process.env.QDRANT_COLLECTION, {
    vector: qvec,
    limit: 5,
  });

  res.forEach((hit, idx) => {
    console.log("\n#", idx + 1, "score:", hit.score);
    console.log((hit.payload?.text || "").slice(0, 400));
  });
}

main().catch(console.error);
