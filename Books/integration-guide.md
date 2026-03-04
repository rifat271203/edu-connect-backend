# Integration Guide: Improved RAG Retrieval for HSC Organic Chemistry Tutor

## Overview

This guide explains how to integrate the improved retrieval pipeline into your existing application.

## Files Created

| File | Purpose |
|------|---------|
| [`Books/reindex-organic-v2.js`](Books/reindex-organic-v2.js) | Updated indexing script with `searchable_text` field |
| [`Books/retrieval-organic.js`](Books/retrieval-organic.js) | Core retrieval module with hybrid search |
| [`Books/test-retrieval.js`](Books/test-retrieval.js) | Test script |

## Step 1: Reindex Data

Before using the new retrieval, you must reindex your data with the new `searchable_text` field:

```bash
node Books/reindex-organic-v2.js
```

This will:
1. Delete the existing collection
2. Create a new collection
3. Index all organic chemistry records with `payload["text"]` containing joined fields:
   - topic_en
   - topic_bn
   - question_bn
   - answer_bn_en
   - keywords_en (joined)

## Step 2: Update Your Chat Handler

In your main application (e.g., `index.js`), replace the old retrieval code with:

```javascript
const { retrieveAndBuildPrompt } = require('./Books/retrieval-organic');

// In your chat handler:
const result = await retrieveAndBuildPrompt(userQuestion);

// Check if relevant chunks found
if (result.notFound) {
  // Return the "not found" message
  return "এই প্রশ্নের উত্তর বইয়ের তথ্য থেকে পাওয়া যায়নি।";
}

// Build the final prompt for your model
const finalPrompt = result.prompt;

// Then call your LLM with the prompt
const response = await callLLM(finalPrompt);
```

## Key Features Explained

### 1. Chemistry-Specific Keyword Extraction

The [`extractChemistryTerms()`](Books/retrieval-organic.js:116) function:
- Keeps chemical formulas (HBr, HCl, H2SO4, NaNO2, ROOR)
- Keeps reaction mechanisms (SN1, SN2, E1, E2)
- Keeps special terms (Anti-Markovnikov, Huckel, diazonium)
- Removes stopwords (both English and Bengali)
- Returns 8-15 high-signal tokens

### 2. Hybrid Search Strategy

The [`hybridSearch()`](Books/retrieval-organic.js:200) function:
1. **Vector Search**: Gets top 30 candidates using embeddings
2. **Bilingual Queries**: Creates English variants from Bengali queries
3. **Keyword Reranking**: Adds bonus score for term overlap
4. **Threshold Filtering**: Removes results with cosine similarity < 0.20
5. **Deduplication**: Merges results from multiple query variants

### 3. Safe Prompt Builder

The [`buildPrompt()`](Books/retrieval-organic.js:299) function:
- Never outputs empty "অংশ" blocks
- Skips chunks with empty text
- Includes relevance percentage for each chunk
- Formats properly for Bengali output

### 4. Logging

The retrieval returns detailed logs:
```javascript
result.logs.forEach(log => {
  console.log(`[${log.type}]`, log.data);
});
```

Log types:
- `extracted_terms`: Array of extracted chemistry terms
- `top_similarities`: Top 5 results with scores
- `final_chunks`: Number of chunks used

## Configuration

You can customize the retrieval parameters in [`retrieval-organic.js`](Books/retrieval-organic.js:30):

```javascript
const TOP_K = 30;        // Initial candidates from vector search
const TOP_N = 8;        // Final chunks after reranking
const RERANK_WEIGHT = 0.05;  // Weight for keyword overlap bonus
const COSINE_THRESHOLD = 0.20;  // Minimum similarity
```

## Expected Output

For a query like "HBr যোগে peroxide থাকলে কেন Anti-Markovnikov হয়?" you should get:

```
Extracted terms: HBr, peroxide, Anti-Markovnikov, যোগ

Chunks found: 3

Prompt:
বইয়ের তথ্য:

--- অংশ 1 (প্রাসঙ্গিকতা: 85%) ---
Anti-Markovnikov (পারঅক্সাইড প্রভাব): 
Peroxide (ROOR) উপস্থিতিতে HBr-এর যোগ radical mechanism-এ হয়...

--- অংশ 2 (প্রাসঙ্গিকতা: 72%) ---
Markovnikov's rule: অসমমিত আলকিনে HX যোগ হলে H যুক্ত হয়...

---
উপরের তথ্যের ভিত্তিতে নিচের প্রশ্নের উত্তর দাও:
প্রশ্ন: HBr যোগে peroxide থাকলে কেন Anti-Markovnikov হয়?
```

## Troubleshooting

### No chunks found
- Run reindexing: `node Books/reindex-organic-v2.js`
- Check Qdrant is running: `curl http://localhost:6333/collections`

### Empty prompts
- This happens when all retrieved chunks have empty `text` field
- Verify data was indexed with the new script

### Low similarity scores
- The threshold (0.20) might be too high
- Lower it in the configuration if needed

## Complete Example

```javascript
const { retrieveAndBuildPrompt } = require('./Books/retrieval-organic');

async function handleUserMessage(userQuestion) {
  console.log(`User: ${userQuestion}`);
  
  // Retrieve relevant chunks
  const result = await retrieveAndBuildPrompt(userQuestion);
  
  // Log the retrieval details
  console.log('\n=== Retrieval Logs ===');
  result.logs.forEach(log => {
    console.log(`[${log.type}]:`, JSON.stringify(log.data));
  });
  
  // Check if we found relevant content
  if (result.notFound || result.chunkCount === 0) {
    return "এই প্রশ্নের উত্তর বইয়ের তথ্য থেকে পাওয়া যায়নি।";
  }
  
  console.log(`\nFound ${result.chunkCount} relevant chunks`);
  
  // Use the prompt with your LLM
  const response = await callYourLLM(result.prompt);
  
  return response;
}
```
