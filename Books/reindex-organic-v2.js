/**
 * Script to index organic chemistry notes into Qdrant with searchable_text field
 * Run with: node Books/reindex-organic-v2.js
 * 
 * This script:
 * - Creates a searchable_text field by joining all relevant fields
 * - Stores it in payload["text"] for retrieval
 * - Keeps original fields for metadata
 * 
 * Searchable text format:
 * topic_en
 * topic_bn
 * question_bn
 * answer_bn_en
 * " ".join(keywords_en)
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { QdrantClient } = require("@qdrant/js-client-rest");
require("dotenv").config();

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

const COLLECTION_NAME = process.env.QDRANT_COLLECTION || "hsc_chem_2nd_paper";
const BATCH_SIZE = 20;

// Starting ID for organic chemistry records
const ORGANIC_ID_START = 100000;

/**
 * Build searchable text field from JSONL record
 * Joins: topic_en, topic_bn, question_bn, answer_bn_en, keywords_en
 */
function buildSearchableText(item) {
  const parts = [];
  
  // Add English topic
  if (item.topic_en) parts.push(item.topic_en);
  
  // Add Bengali topic
  if (item.topic_bn) parts.push(item.topic_bn);
  
  // Add question (Bengali)
  if (item.question_bn) parts.push(item.question_bn);
  
  // Add answer (mixed BN/EN)
  if (item.answer_bn_en) parts.push(item.answer_bn_en);
  
  // Add keywords (English)
  if (item.keywords_en && Array.isArray(item.keywords_en)) {
    parts.push(item.keywords_en.join(" "));
  }
  
  return parts.join("\n");
}

/**
 * Clean text for embedding (truncate if too long)
 */
function cleanTextForEmbedding(text, maxChars = 4000) {
  // Remove excessive whitespace
  let cleaned = text.replace(/\s+/g, " ").trim();
  
  // Truncate if too long
  if (cleaned.length > maxChars) {
    cleaned = cleaned.substring(0, maxChars);
  }
  
  return cleaned;
}

// Embedding function using Ollama
async function getEmbedding(text) {
  const truncatedText = cleanTextForEmbedding(text);
  
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
async function getBatchEmbeddings(items, retries = 3) {
  const embeddings = [];
  
  for (let i = 0; i < items.length; i++) {
    let success = false;
    let attempts = 0;
    
    // Build searchable text for embedding
    const searchableText = buildSearchableText(items[i]);
    
    while (!success && attempts < retries) {
      try {
        const embedding = await getEmbedding(searchableText);
        embeddings.push({ item: items[i], embedding, searchableText });
        success = true;
        console.log(`  Embedded ${i + 1}/${items.length} (ID: ${items[i].id})`);
      } catch (error) {
        attempts++;
        console.error(`  Attempt ${attempts} failed for ${items[i].id}: ${error.message}`);
        if (attempts < retries) {
          await new Promise(r => setTimeout(r, 2000));
        } else {
          console.error(`  ⚠️ Skipping ${items[i].id} after ${retries} failed attempts`);
          embeddings.push({ item: items[i], embedding: null, searchableText: null });
        }
      }
    }
    
    // Small delay between requests to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  return embeddings;
}

// Read JSONL file line by line
async function readJSONL(filePath) {
  const items = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  for await (const line of rl) {
    if (line.trim()) {
      try {
        const item = JSON.parse(line);
        items.push(item);
      } catch (e) {
        console.error(`Failed to parse line: ${line.substring(0, 50)}...`);
      }
    }
  }
  
  return items;
}

// Recreate collection with proper settings
async function recreateCollection() {
  console.log("Recreating collection...");

  const vectorsConfig = {
    size: 768, // nomic-embed-text dimension
    distance: "Cosine",
  };

  // Step A: Check if collection exists (explicit API call)
  let collectionExists = false;
  let deletedExisting = false;
  try {
    const existsRes = await qdrant.collectionExists(COLLECTION_NAME);
    collectionExists = Boolean(existsRes?.exists);
    if (collectionExists) {
      console.log("  Found existing collection");
    } else {
      console.log("  Collection does not exist, creating new one");
    }
  } catch (error) {
    throw new Error(`Failed to check collection existence: ${error?.message || error}`);
  }

  // Step B: Delete only when it really exists
  if (collectionExists) {
    try {
      await qdrant.deleteCollection(COLLECTION_NAME);
      console.log("  Deleted existing collection");
      deletedExisting = true;
    } catch (error) {
      throw new Error(`Failed to delete existing collection: ${error?.message || error}`);
    }
  }

  // Step C: Create collection
  if (!collectionExists || deletedExisting) {
    try {
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: vectorsConfig,
      });
      console.log("  Created new collection");
    } catch (error) {
      const message = String(error?.message || "");
      const statusCode = error?.status || error?.response?.status || null;
      const alreadyExists = statusCode === 409 || /already exists/i.test(message);

      if (alreadyExists) {
        console.log("  Collection already exists (409), reusing existing collection");
      } else {
        throw error;
      }
    }
  }
  
  // Create payload index for topic field (for filtering if needed)
  try {
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      wait: true,
      field_name: "topic",
      field_schema: "keyword",
    });
    console.log("  Created keyword index for 'topic' field");
  } catch (indexError) {
    console.log("  Note: Could not create topic index:", indexError.message);
  }
}

async function main() {
  console.log("=== Organic Chemistry Notes Reindexing v2 ===");
  console.log("This will create searchable_text field for better retrieval\n");

  // Quick Qdrant connectivity/auth sanity check
  console.log("QDRANT_URL:", process.env.QDRANT_URL);
  const cols = await qdrant.getCollections();
  console.log("Qdrant OK. Collections:", cols.collections?.length ?? cols.length);
  console.log("");
  
  // Step 1: Recreate collection
  console.log("STEP 1: Setting up Qdrant collection...");
  await recreateCollection();
  
  console.log("");
  
  // Step 2: Read the dataset
  console.log("STEP 2: Reading organic_chem_bn_en.jsonl...");
  const datasetPath = path.join(__dirname, "..", "organic_chem_bn_en.jsonl");
  
  if (!fs.existsSync(datasetPath)) {
    console.log(`Error: File not found at ${datasetPath}`);
    process.exit(1);
  }
  
  const items = await readJSONL(datasetPath);
  console.log(`Found ${items.length} records to index\n`);
  
  if (items.length === 0) {
    console.log("No records found. Exiting.");
    return;
  }
  
  // Step 3: Process in batches
  console.log(`STEP 3: Processing in batches of ${BATCH_SIZE}...\n`);
  const totalBatches = Math.ceil(items.length / BATCH_SIZE);
  let totalIndexed = 0;
  let totalFailed = 0;
  
  for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
    const start = batchNum * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, items.length);
    const batch = items.slice(start, end);
    
    console.log(`Batch ${batchNum + 1}/${totalBatches} (records ${start + 1}-${end}):`);
    
    // Get embeddings for batch
    const embeddings = await getBatchEmbeddings(batch);
    
    // Prepare points for Qdrant (filter out failed embeddings)
    const points = embeddings
      .filter(e => e.embedding !== null)
      .map((e, idx) => ({
        id: ORGANIC_ID_START + start + idx,
        vector: e.embedding,
        payload: {
          // Original fields
          originalId: e.item.id,
          topic_en: e.item.topic_en || "",
          topic_bn: e.item.topic_bn || "",
          question_bn: e.item.question_bn || "",
          answer_bn_en: e.item.answer_bn_en || "",
          keywords_en: e.item.keywords_en || [],
          
          // NEW: Searchable text field
          text: e.searchableText,
          
          // Metadata for filtering
          subject: "Chemistry",
          topic: "Organic",
          source: "organic_bn_en"
        }
      }));
    
    const failed = embeddings.filter(e => e.embedding === null).length;
    totalFailed += failed;
    
    if (points.length === 0) {
      console.log(`  ⚠️ No valid embeddings in batch ${batchNum + 1}, skipping...\n`);
      continue;
    }
    
    // Upsert to Qdrant
    try {
      await qdrant.upsert(COLLECTION_NAME, {
        wait: true,
        points: points,
      });
      console.log(`  ✅ Upserted ${points.length} records (failed: ${failed})\n`);
      totalIndexed += points.length;
    } catch (error) {
      console.error(`  ❌ Failed to upsert batch ${batchNum + 1}:`, error.message, "\n");
    }
    
    // Delay between batches
    if (batchNum < totalBatches - 1) {
      console.log("  Waiting 1 second before next batch...\n");
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  // Step 4: Summary
  console.log("=== Reindexing Complete ===");
  console.log(`Total chunks inserted: ${totalIndexed}`);
  if (totalFailed > 0) {
    console.log(`Total chunks failed: ${totalFailed}`);
  }
  
  // Step 5: Verify with a test search
  console.log("\n=== Verification Test ===");
  try {
    const testQuery = "Anti-Markovnikov addition reaction with HBr and peroxide";
    const testEmbedding = await getEmbedding(testQuery);
    const results = await qdrant.search(COLLECTION_NAME, {
      vector: testEmbedding,
      limit: 3,
      filter: {
        must: [
          { key: "topic", match: { value: "Organic" } }
        ]
      }
    });
    
    console.log(`Test query: "${testQuery}"`);
    console.log(`Found ${results.length} organic chemistry results:`);
    results.forEach((r, i) => {
      console.log(`  ${i + 1}. Score: ${r.score.toFixed(3)}`);
      console.log(`     ID: ${r.id}`);
      console.log(`     Text preview: ${(r.payload?.text || '').substring(0, 100)}...`);
    });
  } catch (error) {
    console.error("Verification search failed:", error.message);
  }
  
  console.log("\n✅ Reindexing complete! The searchable_text field is now active.");
}

main().catch(console.error);
