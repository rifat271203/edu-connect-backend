/**
 * RAG Retrieval Module for HSC Organic Chemistry Tutor
 * 
 * Features:
 * - Hybrid search (vector search + keyword reranking)
 * - Chemistry-specific keyword extraction
 * - Bilingual support (EN/BN)
 * - Safe prompt building (no empty sections)
 * 
 * Usage:
 *   const { retrieveAndBuildPrompt } = require('./Books/retrieval-organic.js');
 *   const result = await retrieveAndBuildPrompt(userQuestion);
 */

const { QdrantClient } = require("@qdrant/js-client-rest");
require("dotenv").config();

// Configuration
const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const COLLECTION_NAME = process.env.QDRANT_COLLECTION || "hsc_chem_2nd_paper";
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

// Retrieval parameters
const TOP_K = 30;       // Initial vector search candidates
const TOP_N = 8;       // Final chunks after reranking
const RERANK_WEIGHT = 0.05;  // Weight for keyword overlap bonus
const COSINE_THRESHOLD = 0.20;  // Minimum similarity to accept

// Initialize Qdrant client
const qdrant = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY,
  checkCompatibility: false,
});

/**
 * ============================================
 * CHEMISTRY KEYWORD EXTRACTION
 * ============================================
 * Extracts high-signal chemistry terms from queries
 * - Keeps chemical formulas (HBr, HCl, H2SO4, NaNO2, ROOR, NO2+)
 * - Keeps hyphenated words (Anti-Markovnikov)
 * - Keeps SN1/SN2/E1/E2
 * - Keeps Greek/symbol terms
 * - Keeps Bengali chemistry words
 * - Removes only stopwords
 */

// Bengali stopwords to remove
const BENGALI_STOPWORDS = new Set([
  'কী', 'কি', 'কে', 'কোন', 'কোথায়', 'কখন', 'কেন', 'কিভাবে',
  'এবং', 'অথবা', 'কিন্তু', 'যদি', 'তবে', 'যেহেতু', 'কারণ',
  'এই', 'ওই', 'সেই', 'এ', 'ও', 'সে', 'এগুলো', 'ওগুলো',
  'হলো', 'হল', 'হয়', 'আছে', 'ছিল', 'আসে', 'করে', 'করা',
  'থেকে', 'এর', 'এরা', 'যার', 'সাথে', 'জন্য', 'সম্পর্কে',
  'বলা', 'বলতে', 'বলে', 'দেখা', 'দেখতে', 'পাওয়া', 'নেওয়া'
]);

// English stopwords to remove
const ENGLISH_STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'and', 'but', 'or', 'if', 'because', 'as', 'until', 'while',
  'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under',
  'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
  'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 's', 't', 'just', 'don', 'now', 'i', 'me', 'my',
  'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it',
  'its', 'they', 'them', 'their', 'what', 'which', 'who', 'whom'
]);

/**
 * Bengali to English chemistry term mapping for alias queries
 */
const BN_TO_EN_ALIAS = {
  'পারঅক্সাইড': 'peroxide',
  'অ্যান্টি-মার্কোভনিকভ': 'Anti-Markovnikov',
  'অ্যান্টি মার্কোভনিকভ': 'Anti-Markovnikov',
  'যোগ বিক্রিয়া': 'addition reaction',
  'বিকল্পনা': 'elimination',
  'প্রতিস্থাপন': 'substitution',
  'ডায়াজোনিয়াম': 'diazonium',
  'ডায়াজোটাইজেশন': 'diazotization',
  'আজো': 'azo',
  'আজো কাপলিং': 'azo coupling',
  'স্যান্ডমায়ার': 'Sandmeyer',
  'হাকেল': 'Huckel',
  'হাকেল নিয়ম': 'Huckel rule',
  'মার্কোভনিকভ': 'Markovnikov',
  'কার্বোকেশন': 'carbocation',
  'কার্বঅ্যানিয়ন': 'carbanion',
  'মুক্ত মূলক': 'free radical',
  'ফ্রি র‍্যাডিক্যাল': 'free radical',
  'ইলেক্ট্রোফাইল': 'electrophile',
  'নিউক্লিওফাইল': 'nucleophile',
  'অ্যালকিন': 'alkene',
  'আলকিন': 'alkene',
  'আলকেন': 'alkane',
  'আল্কাইন': 'alkyne',
  'বেঞ্জিন': 'benzene',
  'ফেনল': 'phenol',
  'অ্যালকোহল': 'alcohol',
  'ইথার': 'ether',
  'অ্যালডিহাইড': 'aldehyde',
  'কিটোন': 'ketone',
  'কার্বক্সিলিক অ্যাসিড': 'carboxylic acid',
  'অ্যামিন': 'amine',
  'গ্লুকোজ': 'glucose',
  'ফ্রুক্টোজ': 'fructose',
  'রেজোন্যান্স': 'resonance',
  'হাইব্রিডাইজেশন': 'hybridization',
  'কার্যকরী মূলক': 'functional group',
  'সমধর্মী শ্রেণি': 'homologous series',
  'সমাণুতা': 'isomerism',
  'পলিমার': 'polymer',
  'নাইলন': 'nylon',
  'পলিয়েস্টার': 'polyester',
  'পিভিসি': 'PVC',
  'টেফলন': 'Teflon'
};

/**
 * English to Bengali alias mapping (reverse)
 */
const EN_TO_BN_ALIAS = Object.fromEntries(
  Object.entries(BN_TO_EN_ALIAS).map(([k, v]) => [v.toLowerCase(), k])
);

/**
 * Drop-in keyword extractor for BN+EN mixed chemistry queries
 * Returns 8-12 high-signal chemistry tokens
 * Uses scoring to prioritize chemistry-specific terms
 */
function extractChemistryTerms(query, max = 12) {
  const stop = new Set([
    "why","does","what","is","are","the","a","an","and","or","but","in","on","of","to","with",
    "explain","predict","products","reaction","conditions","show","give","describe","difference",
    "এ","ও","কি","কী","কেন","কিভাবে","হবে","থাকে","এর","তে","এবং","করে","থেকে","বলো","লিখো"
  ]);

  // Extract tokens using regex - keeps formulas, hyphens, plus, digits
  const tokens = (query.match(/[A-Za-z\u0980-\u09FF0-9][A-Za-z\u0980-\u09FF0-9\-\+\⁺\⁻]*/g) || [])
    .map(t => t.trim())
    .filter(Boolean);

  // Scoring: prefer chemistry-looking tokens
  const scored = tokens.map(t => {
    const lower = t.toLowerCase();
    if (stop.has(lower)) return null;

    let score = 0;

    // Chemistry signals
    if (/[0-9]/.test(t)) score += 3;                 // SN1, sp2, C6H6, H2O
    if (/^[A-Z][A-Za-z]?$/.test(t)) score += 1;      // Single element-like token
    if (/^[A-Z]{1,3}[0-9]?/.test(t)) score += 2;     // HBr, HCl, NaOH, ROOR
    if (t.includes("-")) score += 2;                  // Anti-Markovnikov
    if (/(sn1|sn2|e1|e2|sp2|sp3|huckel)/i.test(t)) score += 4;
    if (/(cannizzaro|sandmeyer|diazonium|peroxide|markov|alcohol|aldehyde|ketone|phenol|ether)/i.test(t)) score += 4;
    if (t.length >= 6) score += 1;

    return { t, score };
  }).filter(Boolean);

  // Dedupe by lowercase
  const seen = new Set();
  const unique = scored.filter(x => {
    const k = x.t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  unique.sort((a, b) => b.score - a.score);

  return unique.slice(0, max).map(x => x.t);
}

/**
 * Extract terms from both English and Bengali queries
 */
function extractAllTerms(query) {
  const terms = extractChemistryTerms(query);
  
  // Also try to detect Bengali terms and add their English equivalents
  for (const term of terms) {
    if (BN_TO_EN_ALIAS[term]) {
      terms.push(BN_TO_EN_ALIAS[term]);
    }
  }
  
  return [...new Set(terms)];
}

/**
 * ============================================
 * EMBEDDING FUNCTION
 * ============================================
 */

async function getEmbedding(text) {
  const MAX_CHARS = 4000;
  const truncatedText = text.length > MAX_CHARS ? text.substring(0, MAX_CHARS) : text;
  
  const response = await fetch("http://127.0.0.1:11434/api/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_EMBED_MODEL,
      prompt: truncatedText,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Embedding failed: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.embedding;
}

/**
 * ============================================
 * HYBRID RETRIEVAL
 * ============================================
 */

/**
 * Calculate keyword overlap score between query and chunk text
 */
function calculateKeywordOverlap(queryTerms, chunkText) {
  if (!queryTerms || queryTerms.length === 0 || !chunkText) return 0;
  
  const textLower = chunkText.toLowerCase();
  let overlapCount = 0;
  
  for (const term of queryTerms) {
    const termLower = term.toLowerCase();
    
    // Check exact match
    if (textLower.includes(termLower)) {
      overlapCount += 1;
    } else {
      // Check partial match for longer terms
      if (termLower.length > 5) {
        const parts = termLower.split(/[-\s]/);
        for (const part of parts) {
          if (part.length > 3 && textLower.includes(part)) {
            overlapCount += 0.5;
            break;
          }
        }
      }
    }
  }
  
  return overlapCount;
}

/**
 * Hybrid search: vector search + keyword reranking
 */
async function hybridSearch(query, options = {}) {
  const {
    topK = TOP_K,
    topN = TOP_N,
    rerankWeight = RERANK_WEIGHT,
    threshold = COSINE_THRESHOLD
  } = options;
  
  console.log(`\n[RETRIEVAL] Starting hybrid search for: "${query}"`);
  
  // Step 1: Extract terms for keyword matching
  const extractedTerms = extractAllTerms(query);
  console.log(`[RETRIEVAL] Extracted terms: ${extractedTerms.join(', ')}`);
  
  // Step 2: Create bilingual query variants
  let queryVariants = [query];
  
  // Check if query contains Bengali terms that need English aliases
  const bnAliases = [];
  for (const term of extractedTerms) {
    if (BN_TO_EN_ALIAS[term]) {
      bnAliases.push(BN_TO_EN_ALIAS[term]);
    }
  }
  
  // If query is in Bengali or has Bengali terms, create English variant
  if (bnAliases.length > 0 || /[\u0980-\u09FF]/.test(query)) {
    let enQuery = query;
    for (const [bn, en] of Object.entries(BN_TO_EN_ALIAS)) {
      enQuery = enQuery.replace(new RegExp(bn, 'gi'), en);
    }
    if (enQuery !== query) {
      queryVariants.push(enQuery);
    }
  }
  
  console.log(`[RETRIEVAL] Query variants: ${queryVariants.join(' | ')}`);
  
  // Step 3: Get embeddings and search
  const seenIds = new Set();
  let allCandidates = [];
  
  for (const variant of queryVariants) {
    console.log(`[RETRIEVAL] Searching with variant: "${variant}"`);
    
    try {
      const embedding = await getEmbedding(variant);
      
      const results = await qdrant.search(COLLECTION_NAME, {
        vector: embedding,
        limit: topK,
        filter: {
          must: [
            { key: "topic", match: { value: "Organic" } }
          ]
        }
      });
      
      console.log(`[RETRIEVAL] Got ${results.length} candidates from vector search`);
      
      // Deduplicate by ID
      for (const result of results) {
        if (!seenIds.has(result.id)) {
          seenIds.add(result.id);
          allCandidates.push(result);
        }
      }
    } catch (error) {
      console.error(`[RETRIEVAL] Error searching with variant "${variant}":`, error.message);
    }
  }
  
  console.log(`[RETRIEVAL] Total unique candidates: ${allCandidates.length}`);
  
  // Step 4: Rerank by keyword overlap
  const reranked = allCandidates.map(candidate => {
    // Try multiple field names for text
    const chunkText = candidate.payload?.text || 
                      candidate.payload?.answer_bn_en || 
                      candidate.payload?.topic_en || 
                      candidate.payload?.topic_bn ||
                      '';
    
    const overlapScore = calculateKeywordOverlap(extractedTerms, chunkText);
    
    // Combined score: cosine similarity + 0.05 * overlap_count
    const finalScore = candidate.score + (rerankWeight * overlapScore);
    
    // Debug: log available fields
    console.log(`[RETRIEVAL] Candidate ${candidate.id} - fields: ${Object.keys(candidate.payload || {}).join(', ')}`);
    
    return {
      ...candidate,
      originalScore: candidate.score,
      overlapScore,
      finalScore,
      _textPreview: chunkText.substring(0, 100)  // For debugging
    };
  });
  
  // Sort by final score
  reranked.sort((a, b) => b.finalScore - a.finalScore);
  
  // Step 5: Filter by threshold and take top N (check multiple text fields)
  const filteredResults = reranked
    .filter(r => {
      const hasText = (r.payload?.text || r.payload?.answer_bn_en || r.payload?.topic_en || r.payload?.topic_bn || '').trim();
      return r.originalScore >= threshold && hasText.length > 0;
    })
    .slice(0, topN);
  
  console.log(`[RETRIEVAL] Top similarities:`);
  filteredResults.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. Score: ${r.finalScore.toFixed(3)} (cosine: ${r.originalScore.toFixed(3)}, overlap: ${r.overlapScore})`);
  });
  
  console.log(`[RETRIEVAL] Final chunks used: ${filteredResults.length}`);
  
  return {
    terms: extractedTerms,
    candidates: filteredResults,
    totalFound: filteredResults.length
  };
}

/**
 * ============================================
 * PROMPT BUILDER
 * ============================================
 */

/**
 * Build prompt with retrieved chunks (never empty sections)
 */
function buildPrompt(retrievalResult, query) {
  const { candidates, terms, totalFound } = retrievalResult;
  
  // If no valid chunks found, return "not found" indicator
  if (!candidates || candidates.length === 0) {
    return {
      prompt: '',
      context: [],
      notFound: true,
      terms,
      chunkCount: 0
    };
  }
  
  // Build context sections (skip empty ones)
  const contextParts = [];
  
  console.log(`[PROMPT] Processing ${candidates.length} candidates`);
  
  for (let i = 0; i < candidates.length; i++) {
    const chunk = candidates[i];
    
    // Try multiple field names for the text
    const text = chunk.payload?.text || 
                 chunk.payload?.answer_bn_en || 
                 chunk.payload?.topic_en || 
                 chunk.payload?.topic_bn ||
                 '';
    
    console.log(`[PROMPT] Chunk ${i+1} text length: ${text.length}, score: ${chunk.finalScore?.toFixed(3)}`);
    
    // Skip empty or whitespace-only chunks
    if (!text || text.trim().length === 0) {
      console.log(`[PROMPT] Skipping empty chunk ${i+1}`);
      continue;
    }
    
    // Calculate relevance percentage
    const relevance = Math.round((chunk.finalScore || chunk.score || 0) * 100);
    
    contextParts.push({
      section: contextParts.length + 1,
      text: text.trim(),
      relevance: relevance,
      score: chunk.finalScore || chunk.score
    });
  }
  
  // If all chunks were empty, return not found
  if (contextParts.length === 0) {
    console.log(`[PROMPT] WARNING: All chunks were empty!`);
    return {
      prompt: '',
      context: [],
      notFound: true,
      terms,
      chunkCount: 0
    };
  }
  
  // Build the prompt with actual content
  let prompt = `বইয়ের তথ্য:\n\n`;
  
  for (const ctx of contextParts) {
    prompt += `--- অংশ ${ctx.section} (প্রাসঙ্গিকতা: ${ctx.relevance}%) ---\n`;
    prompt += `${ctx.text}\n\n`;
  }
  
  prompt += `---\n`;
  prompt += `উপরের তথ্যের ভিত্তিতে নিচের প্রশ্নের উত্তর দাও:\n`;
  prompt += `প্রশ্ন: ${query}`;
  
  return {
    prompt,
    context: contextParts,
    notFound: false,
    terms,
    chunkCount: contextParts.length
  };
}

/**
 * ============================================
 * MAIN RETRIEVAL FUNCTION
 * ============================================
 */

/**
 * Retrieve relevant chunks and build prompt for the model
 * 
 * @param {string} question - User question (BN or EN mixed)
 * @returns {Object} - { prompt, context, notFound, terms, chunkCount, logs }
 */
async function retrieveAndBuildPrompt(question) {
  const logs = [];
  
  try {
    // Step 1: Hybrid search
    const retrievalResult = await hybridSearch(question);
    
    logs.push({
      type: 'extracted_terms',
      data: retrievalResult.terms
    });
    
    logs.push({
      type: 'top_similarities',
      data: retrievalResult.candidates.slice(0, 5).map(c => ({
        id: c.id,
        score: c.finalScore.toFixed(3),
        originalScore: c.originalScore.toFixed(3),
        overlap: c.overlapScore
      }))
    });
    
    // Step 2: Build prompt
    const promptResult = buildPrompt(retrievalResult, question);
    
    logs.push({
      type: 'final_chunks',
      data: promptResult.chunkCount
    });
    
    return {
      prompt: promptResult.prompt,
      context: promptResult.context,
      notFound: promptResult.notFound,
      terms: promptResult.terms,
      chunkCount: promptResult.chunkCount,
      logs
    };
    
  } catch (error) {
    console.error('[RETRIEVAL] Error:', error.message);
    logs.push({
      type: 'error',
      data: error.message
    });
    
    return {
      prompt: '',
      context: [],
      notFound: true,
      terms: [],
      chunkCount: 0,
      logs,
      error: error.message
    };
  }
}

/**
 * Simple fallback retrieval (vector search only, no reranking)
 * Use this if hybrid search fails
 */
async function simpleRetrieve(question, limit = 5) {
  const embedding = await getEmbedding(question);
  
  const results = await qdrant.search(COLLECTION_NAME, {
    vector: embedding,
    limit: limit,
    filter: {
      must: [
        { key: "topic", match: { value: "Organic" } }
      ]
    }
  });
  
  return results
    .filter(r => r.score >= COSINE_THRESHOLD && r.payload?.text?.trim())
    .map(r => ({
      id: r.id,
      score: r.score,
      text: r.payload.text
    }));
}

module.exports = {
  retrieveAndBuildPrompt,
  simpleRetrieve,
  extractChemistryTerms,
  extractAllTerms,
  hybridSearch,
  buildPrompt,
  // Constants for testing
  TOP_K,
  TOP_N,
  COSINE_THRESHOLD,
  BN_TO_EN_ALIAS,
  EN_TO_BN_ALIAS
};
