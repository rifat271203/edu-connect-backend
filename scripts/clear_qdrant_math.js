/**
 * Script to clear the math collection in Qdrant
 * Run with: node scripts/clear_qdrant_math.js
 */
require("dotenv").config();
const { QdrantClient } = require("@qdrant/js-client-rest");

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const COLLECTION_NAME = process.env.QDRANT_COLLECTION_MATH || "hsc_math";

const client = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY,
  checkCompatibility: false,
});

async function deleteAllPoints() {
  console.log(`Deleting all points from collection: ${COLLECTION_NAME}`);
  
  try {
    // First check if collection exists
    const collections = await client.getCollections();
    const exists = collections.collections?.some((c) => c.name === COLLECTION_NAME);
    
    if (!exists) {
      console.log(`Collection '${COLLECTION_NAME}' does not exist. Nothing to clear.`);
      return true;
    }

    // Get collection info
    const collectionInfo = await client.getCollection(COLLECTION_NAME);
    const pointsCount = collectionInfo.points_count;
    console.log(`Current points in collection: ${pointsCount}`);

    // Always recreate with correct dimension to avoid dimension mismatch issues
    console.log("Deleting and recreating collection with correct dimension (3072)...");
    await client.deleteCollection(COLLECTION_NAME);
    console.log("✅ Deleted collection");
    
    await client.createCollection(COLLECTION_NAME, {
      vectors: { size: 3072, distance: "Cosine" },
    });
    console.log("✅ Created new collection with dimension 3072");
    
    return true;

    // Delete all points using delete all filter
    await client.delete(COLLECTION_NAME, {
      wait: true,
      filter: {
        must: [
          {
            key: "subject",
            match: { any: ["math", "Mathematics", "Math"] },
          },
        ],
      },
    });
    
    console.log("✅ Deleted math-related points");

    // Also try to delete by category_slug containing "math" or any math-related
    // Since filter approach might not catch all, let's do a scroll and delete approach
    let deletedCount = 0;
    let scrollResult = await client.scroll(COLLECTION_NAME, { limit: 1000, with_vectors: false });
    
    while (scrollResult.results && scrollResult.results.length > 0) {
      const idsToDelete = scrollResult.results.map((point) => point.id);
      
      await client.delete(COLLECTION_NAME, {
        wait: true,
        points: idsToDelete,
      });
      
      deletedCount += idsToDelete.length;
      console.log(`Deleted ${deletedCount} points so far...`);
      
      // Continue scrolling
      scrollResult = await client.scroll(COLLECTION_NAME, {
        limit: 1000,
        with_vectors: false,
        offset: scrollResult.next_page_offset,
      });
    }
    
    console.log(`✅ Total deleted: ${deletedCount} points`);
    return true;
  } catch (error) {
    console.error("❌ Error clearing collection:", error.message);
    
    // If simple delete fails, try recreating the collection
    console.log("Attempting to recreate collection...");
    try {
      await client.deleteCollection(COLLECTION_NAME);
      console.log("✅ Deleted collection");
      
      // Recreate with correct dimension for gemini-embedding-001 (3072)
      await client.createCollection(COLLECTION_NAME, {
        vectors: { size: 3072, distance: "Cosine" },
      });
      console.log("✅ Created new empty collection");
      return true;
    } catch (recreateError) {
      console.error("❌ Recreation failed:", recreateError.message);
      return false;
    }
  }
}

async function main() {
  console.log("=== Qdrant Math Collection Clear Script ===");
  console.log(`Collection: ${COLLECTION_NAME}`);
  console.log("");
  
  const success = await deleteAllPoints();
  
  if (success) {
    console.log("\n✅ Math collection cleared successfully!");
  } else {
    console.log("\n❌ Failed to clear math collection");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("❌ Script failed:", e);
  process.exit(1);
});
