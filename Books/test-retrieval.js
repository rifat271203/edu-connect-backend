/**
 * Test script for the improved RAG retrieval pipeline
 * Run with: node Books/test-retrieval.js
 * 
 * Tests keyword extraction and retrieval
 */

const { retrieveAndBuildPrompt, extractChemistryTerms, simpleRetrieve } = require('./retrieval-organic');

console.log("=== Testing Keyword Extraction ===\n");

// Test the keyword extraction directly
const testKeywords = [
  "Why does HBr show Anti-Markovnikov addition but HCl does not in presence of peroxide?",
  "Benzaldehyde + dilute vs conc NaOH",
  "What is Cannizzaro reaction?",
  "Explain SN1 vs SN2 mechanism",
  "HBr যোগে peroxide থাকলে কেন Anti-Markovnikov হয়?",
  "Aldol condensation কখন হয়?"
];

console.log("--- Keyword Extraction Tests ---\n");
testKeywords.forEach((q, i) => {
  const terms = extractChemistryTerms(q);
  console.log(`Query ${i+1}: "${q}"`);
  console.log(`Keywords: [${terms.join(', ')}]`);
  console.log("");
});

console.log("\n=== Testing Full Retrieval Pipeline ===\n");

const testQueries = [
  // Test 1: Anti-Markovnikov with peroxide
  "HBr যোগে peroxide থাকলে কেন Anti-Markovnikov হয়?",
  
  // Test 2: SN1 vs SN2
  "SN1 এবং SN2 বিক্রিয়ার মূল পার্থক্য কী?",
  
  // Test 3: Huckel's rule
  "Hückel's rule কী?",
  
  // Test 4: Benzaldehyde + NaOH (the problematic case)
  "Benzaldehyde-এ dilute NaOH ও concentrated NaOH-এর সাথে বিক্রিয়া কী হবে?",
  
  // Test 5: Cannizzaro reaction
  "Cannizzaro reaction কোন aldehyde-এ হয়?",
  
  // Test 6: The exact query user mentioned
  "Aldehyde with dilute NaOH vs concentrated NaOH what products form"
];

async function runTests() {
  for (let i = 0; i < testQueries.length; i++) {
    const query = testQueries[i];
    console.log(`\n========== Test ${i + 1}/${testQueries.length} ==========`);
    console.log(`Query: "${query}"`);
    
    try {
      const result = await retrieveAndBuildPrompt(query);
      
      console.log(`\n--- Extraction ---`);
      console.log(`Extracted terms: ${result.terms.join(', ')}`);
      
      console.log(`\n--- Retrieval Results ---`);
      console.log(`Chunks found: ${result.chunkCount}`);
      console.log(`Not found: ${result.notFound}`);
      
      if (result.context.length > 0) {
        console.log(`\n--- Top Chunks ---`);
        result.context.slice(0, 3).forEach((ctx, idx) => {
          console.log(`\nChunk ${idx + 1} (relevance: ${ctx.relevance}%):`);
          console.log(`   ${ctx.text.substring(0, 200)}...`);
        });
      }
      
      console.log(`\n--- Prompt Preview ---`);
      if (result.prompt) {
        console.log(result.prompt.substring(0, 600) + "...");
      } else {
        console.log("(No prompt - not found)");
      }
      
    } catch (error) {
      console.error(`Error:`, error.message);
    }
    
    console.log(`\n${'='.repeat(50)}\n`);
    
    // Small delay between tests
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log("=== Tests Complete ===");
}

// Run tests
runTests().catch(console.error);
