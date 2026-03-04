/**
 * Script to delete old chunks and reindex organic chemistry notes into Qdrant
 * Run with: node Books/reindex-organic.js
 * 
 * This script:
 * - Deletes all existing points from the Qdrant collection
 * - Reads organic_chem_dataset copy.jsonl from project root
 * - Generates embeddings using Ollama
 * - Uploads to Qdrant collection with metadata
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
const BATCH_SIZE = 20; // Process in batches of 20

// Starting ID for organic chemistry records
const ORGANIC_ID_START = 100000;

// Embedding function using Ollama
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
    
    // Use question_bn for embedding (what users will search with)
    const textToEmbed = items[i].question_bn || items[i].topic_en || "";
    
    while (!success && attempts < retries) {
      try {
        const embedding = await getEmbedding(textToEmbed);
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

// Delete all points from collection
async function deleteAllPoints() {
  console.log("Deleting all existing points from collection...");
  
  try {
    // First, get collection info to check if it exists
    const collectionInfo = await qdrant.getCollection(COLLECTION_NAME);
    const pointsCount = collectionInfo.points_count;
    
    if (pointsCount === 0) {
      console.log("Collection is already empty.");
      return true;
    }
    
    console.log(`Found ${pointsCount} existing points. Deleting...`);
    
    // Delete all points using delete all filter
    await qdrant.delete(COLLECTION_NAME, {
      wait: true,
      filter: {
        must: [
          {
            key: "id",
            match: {
              any: [0] // This won't match anything, so we need another approach
            }
          }
        ]
      }
    });
    
    // Actually, the better approach is to recreate the collection
    // or use delete points by scroll
    
    // Let's try to use scroll to get all IDs and delete them
    let deleted = 0;
    let offset = null;
    
    do {
      const scrollResult = await qdrant.scroll(COLLECTION_NAME, {
        limit: 1000,
        offset: offset,
        with_vectors: false,
      });
      
      if (scrollResult.points && scrollResult.points.length > 0) {
        const idsToDelete = scrollResult.points.map(p => p.id);
        
        await qdrant.delete(COLLECTION_NAME, {
          wait: true,
          points: idsToDelete
        });
        
        deleted += idsToDelete.length;
        console.log(`Deleted ${idsToDelete.length} points (total: ${deleted})`);
        
        offset = scrollResult.next_page_offset;
      } else {
        break;
      }
    } while (offset);
    
    console.log(`✅ Successfully deleted ${deleted} points from collection`);
    return true;
    
  } catch (error) {
    console.error("Error deleting points:", error.message);
    // Try alternative: recreate collection
    console.log("Trying to recreate collection instead...");
    
    try {
      await qdrant.deleteCollection(COLLECTION_NAME);
      console.log("Deleted collection successfully");
      
      // Recreate collection
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: {
          size: 3072, // nomic-embed-text dimension
          distance: "Cosine",
        },
      });
      console.log("Created new collection");
      
      // Create payload index for topic field (needed for filtering)
      try {
        await qdrant.createPayloadIndex(COLLECTION_NAME, {
          wait: true,
          field_name: "topic",
          field_schema: "keyword",
        });
        console.log("Created keyword index for 'topic' field");
      } catch (indexError) {
        // Index might already exist
        console.log("Note: Could not create topic index:", indexError.message);
      }
      return true;
    } catch (recreateError) {
      console.error("Error recreating collection:", recreateError.message);
      return false;
    }
  }
}

async function main() {
  console.log("=== Organic Chemistry Notes Reindexing ===");
  console.log("This will DELETE all existing points and upload new data\n");
  
  // Step 1: Delete all existing points
  console.log("STEP 1: Deleting old chunks from Qdrant...");
  const deleteSuccess = await deleteAllPoints();
  
  if (!deleteSuccess) {
    console.log("Failed to delete old data. Exiting.");
    process.exit(1);
  }
  
  console.log("");
  
  // Step 2: Read the new dataset
  console.log("STEP 2: Reading organic_chem_bn_en.jsonl...");
  const datasetPath = path.join(__dirname, "..", "organic_chem_bn_en.jsonl");
  
  // Check if file exists
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
        id: ORGANIC_ID_START + start + idx, // Numeric ID
        vector: e.embedding,
        payload: {
          originalId: e.item.id, // Store original ID in payload
          topic_en: e.item.topic_en || "",
          topic_bn: e.item.topic_bn || "",
          question_bn: e.item.question_bn || "",
          answer_bn_en: e.item.answer_bn_en || "",
          keywords_en: e.item.keywords_en || [],
          // Add metadata for filtering
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
      console.log(`     Text preview: ${(r.payload?.text || '').substring(0, 80)}...`);
    });
  } catch (error) {
    console.error("Verification search failed:", error.message);
  }
  
  console.log("\n✅ Reindexing complete! The new organic chemistry dataset is now active in the RAG system.");
}

main().catch(console.error);
