require("dotenv").config();
const { QdrantClient } = require("@qdrant/js-client-rest");

const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

async function embedOne(text) {
  const r = await fetch("http://127.0.0.1:11434/api/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text",
      prompt: text,
    }),
  });

  const data = await r.json();
  return data.embedding;
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
