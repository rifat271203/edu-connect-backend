/**
 * Script to index organic chemistry notes into Qdrant
 * Run with: node Books/index-organic.js
 * 
 * This script:
 * - Reads organic_chem_dataset.jsonl from project root
 * - Generates embeddings using the same Ollama model
 * - Upserts to the existing Qdrant collection with metadata
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
const BATCH_SIZE = 100; // Process in batches of 100

// Starting ID for organic chemistry records
// Using a high number range to avoid conflicts with existing data
const ORGANIC_ID_START = 100000;

// Organic chemistry keywords for detection
const ORGANIC_KEYWORDS = [
  'alkane', 'alkene', 'alkyne', 'benzene', 'aromatic',
  'alcohol', 'aldehyde', 'ketone', 'ester', 'carboxylic',
  'amine', 'polymer', 'mechanism', 'sn1', 'sn2',
  'electrophilic', 'nucleophilic', 'substitution', 'elimination',
  'hydrocarbon', 'functional group', 'isomer', 'homologous',
  'carbocation', 'carbonyl', 'haloalkane', 'phenol',
  'cracking', 'fermentation', 'ozonolysis', 'hydration',
  'dehydration', 'hydrogenation', 'halogenation', 'nitration'
];

// Embedding function using Ollama (same as existing)
async function getEmbedding(text) {
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
async function getBatchEmbeddings(items, retries = 3) {
  const embeddings = [];
  
  for (let i = 0; i < items.length; i++) {
    let success = false;
    let attempts = 0;
    
    while (!success && attempts < retries) {
      try {
        const embedding = await getEmbedding(items[i].text);
        embeddings.push({ item: items[i], embedding });
        success = true;
        console.log(`  Embedded ${i + 1}/${items.length} (ID: ${items[i].id})`);
      } catch (error) {
        attempts++;
        console.error(`  Attempt ${attempts} failed for ${items[i].id}: ${error.message}`);
        if (attempts < retries) {
          await new Promise(r => setTimeout(r, 2000));
        } else {
          console.error(`  ⚠️ Skipping ${items[i].id} after ${retries} failed attempts`);
          embeddings.push({ item: items[i], embedding: null });
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

async function main() {
  console.log("=== Organic Chemistry Notes Indexing ===\n");
  
  // Step 1: Read the dataset
  console.log("Step 1: Reading organic_chem_dataset.jsonl...");
  const datasetPath = path.join(__dirname, "..", "organic_chem_dataset.jsonl");
  const items = await readJSONL(datasetPath);
  console.log(`Found ${items.length} records to index\n`);
  
  if (items.length === 0) {
    console.log("No records found. Exiting.");
    return;
  }
  
  // Step 2: Check collection exists
  console.log("Step 2: Verifying Qdrant collection...");
  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some(c => c.name === COLLECTION_NAME);
    
    if (!exists) {
      console.log(`Collection ${COLLECTION_NAME} does not exist. Please run the main embedding script first.`);
      process.exit(1);
    }
    console.log(`Collection ${COLLECTION_NAME} verified\n`);
  } catch (error) {
    console.error("Error checking collection:", error);
    process.exit(1);
  }
  
  // Step 3: Process in batches
  console.log(`Step 3: Processing in batches of ${BATCH_SIZE}...\n`);
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
    // Use numeric IDs starting from ORGANIC_ID_START to avoid conflicts
    const points = embeddings
      .filter(e => e.embedding !== null)
      .map((e, idx) => ({
        id: ORGANIC_ID_START + start + idx, // Numeric ID
        vector: e.embedding,
        payload: {
          originalId: e.item.id, // Store original ID in payload
          doc: e.item.doc || "",
          chapter: e.item.chapter || 0,
          chapterTitle: e.item.chapterTitle || "",
          section: e.item.section || "",
          pageStart: e.item.pageStart || 0,
          pageEnd: e.item.pageEnd || 0,
          text: e.item.text || "",
          qa: e.item.qa || [],
          // Add metadata for filtering
          subject: "Chemistry",
          topic: "Organic",
          source: "organic_notes"
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
  console.log("=== Indexing Complete ===");
  console.log(`Organic notes indexed successfully`);
  console.log(`Total chunks inserted: ${totalIndexed}`);
  if (totalFailed > 0) {
    console.log(`Total chunks failed: ${totalFailed}`);
  }
  
  // Step 5: Verify with a test search
  console.log("\n=== Verification Test ===");
  try {
    const testQuery = "What is an alkane?";
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
      console.log(`     Section: ${r.payload?.section || 'N/A'}`);
    });
  } catch (error) {
    console.error("Verification search failed:", error.message);
  }
}

// Export the organic keywords for use in other modules
module.exports = { ORGANIC_KEYWORDS };

main().catch(console.error);
