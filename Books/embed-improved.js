/**
 * Script to embed improved chunks and upload to Qdrant
 * Run with: node Books/embed-improved.js
 */

const fs = require("fs");
const path = require("path");
const { QdrantClient } = require("@qdrant/js-client-rest");
require("dotenv").config();

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

const COLLECTION_NAME = process.env.QDRANT_COLLECTION || "hsc_chem_2nd_paper";
const BATCH_SIZE = 20; // Process in batches to avoid rate limits

// Embedding function using Ollama
async function getEmbedding(text) {
  // Truncate text if too long (nomic-embed-text has 8192 token limit)
  // Approximate: 1 token ~ 4 characters for Bengali, but can be less
  // Using 4000 chars to be safe
  const MAX_CHARS = 4000;
  const truncatedText = text.length > MAX_CHARS ? text.substring(0, MAX_CHARS) : text;
  
  const response = await fetch("http://127.0.0.1:11434/api/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text",
      prompt: truncatedText,
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding failed: ${response.statusText} - ${errorText}`);
  }
  
  const data = await response.json();
  return data.embedding;
}

// Batch embedding with retry
async function getBatchEmbeddings(texts, retries = 3) {
  const embeddings = [];
  
  for (let i = 0; i < texts.length; i++) {
    let success = false;
    let attempts = 0;
    
    while (!success && attempts < retries) {
      try {
        const embedding = await getEmbedding(texts[i]);
        embeddings.push(embedding);
        success = true;
        console.log(`  Embedded ${i + 1}/${texts.length}`);
      } catch (error) {
        attempts++;
        console.error(`  Attempt ${attempts} failed for text ${i + 1}: ${error.message}`);
        if (attempts < retries) {
          await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
        } else {
          // Skip this chunk after all retries failed
          console.error(`  ⚠️ Skipping chunk ${i + 1} after ${retries} failed attempts`);
          embeddings.push(null); // Push null to maintain index
        }
      }
    }
    
    // Small delay between requests to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  return embeddings;
}

async function main() {
  console.log("Reading improved chunks...");
  const chunksFile = fs.readFileSync(path.join(__dirname, "chunks_improved.jsonl"), "utf8");
  const chunks = chunksFile
    .trim()
    .split("\n")
    .map(line => JSON.parse(line));
  
  console.log(`Found ${chunks.length} chunks to embed`);
  
  // Check if collection exists, create if not
  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some(c => c.name === COLLECTION_NAME);
    
    if (!exists) {
      console.log(`Creating collection: ${COLLECTION_NAME}`);
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: {
          size: 768, // nomic-embed-text dimension
          distance: "Cosine",
        },
      });
    } else {
      console.log(`Collection ${COLLECTION_NAME} already exists`);
      // Optionally delete existing points
      // await qdrant.deleteCollection(COLLECTION_NAME);
      // Then recreate
    }
  } catch (error) {
    console.error("Error checking/creating collection:", error);
    process.exit(1);
  }
  
  // Process in batches
  const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
  
  for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
    const start = batchNum * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, chunks.length);
    const batch = chunks.slice(start, end);
    
    console.log(`\nProcessing batch ${batchNum + 1}/${totalBatches} (chunks ${start + 1}-${end})...`);
    
    // Get embeddings for batch
    const texts = batch.map(c => c.text);
    const embeddings = await getBatchEmbeddings(texts);
    
    // Prepare points for Qdrant (filter out failed embeddings)
    const points = batch
      .map((chunk, i) => ({
        id: chunk.id,
        vector: embeddings[i],
        payload: {
          text: chunk.text,
          chapter: chunk.chapter || "",
          chapterIndex: chunk.chapterIndex || 0,
          chunkIndex: chunk.chunkIndex || 0,
          subject: chunk.subject,
          level: chunk.level,
          book: chunk.book,
        },
      }))
      .filter((p, i) => embeddings[i] !== null); // Remove failed embeddings
    
    if (points.length === 0) {
      console.log(`  ⚠️ No valid embeddings in batch ${batchNum + 1}, skipping...`);
      continue;
    }
    
    // Upload to Qdrant
    try {
      await qdrant.upsert(COLLECTION_NAME, {
        wait: true,
        points: points,
      });
      console.log(`  ✅ Uploaded batch ${batchNum + 1}`);
    } catch (error) {
      console.error(`  ❌ Failed to upload batch ${batchNum + 1}:`, error);
      process.exit(1);
    }
    
    // Delay between batches
    if (batchNum < totalBatches - 1) {
      console.log("  Waiting 2 seconds before next batch...");
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  console.log(`\n✅ Successfully embedded and uploaded ${chunks.length} chunks to Qdrant!`);
  
  // Verify by searching
  console.log("\nVerifying with a test search...");
  try {
    const testQuery = "ইথাইন কী?";
    const testEmbedding = await getEmbedding(testQuery);
    const results = await qdrant.search(COLLECTION_NAME, {
      vector: testEmbedding,
      limit: 3,
    });
    
    console.log(`Test query: "${testQuery}"`);
    console.log(`Found ${results.length} results:`);
    results.forEach((r, i) => {
      console.log(`  ${i + 1}. Score: ${r.score.toFixed(3)}`);
      console.log(`     Text: ${r.payload.text.substring(0, 100)}...`);
    });
  } catch (error) {
    console.error("Verification search failed:", error);
  }
}

main().catch(console.error);
