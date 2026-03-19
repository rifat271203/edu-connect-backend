require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const { GoogleGenAI } = require("@google/genai");
const { QdrantClient } = require("@qdrant/js-client-rest");

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const DEFAULT_COLLECTION = process.env.QDRANT_COLLECTION || "hsc_chem_2nd_paper";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const BATCH_SIZE = 32; // Smaller batches for stability
const EMBED_MIN_INTERVAL_MS = Number(process.env.EMBED_MIN_INTERVAL_MS || 700);
const EMBED_MAX_RETRIES = Number(process.env.EMBED_MAX_RETRIES || 8);
let lastEmbedAt = 0;

const client = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY,
  checkCompatibility: false,
});

function parseCliArgs(argv) {
  const args = {
    jsonlPath: null,
    subject: "",
    category: "",
    book: "",
    collection: "",
  };

  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];

    if (token === "--jsonl" || token === "--file") {
      args.jsonlPath = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (token === "--subject") {
      args.subject = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--category") {
      args.category = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--book") {
      args.book = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--collection") {
      args.collection = argv[i + 1] || "";
      i += 1;
      continue;
    }

    // Backward compatibility: first positional arg is jsonl path
    if (!token.startsWith("--") && !args.jsonlPath) {
      args.jsonlPath = token;
    }
  }

  if (!args.jsonlPath) {
    args.jsonlPath = "chunks.jsonl";
  }

  return args;
}

function normalizeSlug(value) {
  if (!value || typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function deriveCategoryFromPath(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function buildSearchableText(obj) {
  // Check for direct text field
  const directText = (obj.text || "").trim();
  if (directText) return directText;

  // Check for question and solution fields (common in problem_solution entries)
  const question = (obj.question || "").trim();
  const solution = (obj.solution || "").trim();
  if (question || solution) {
    return [question, solution].filter(Boolean).join("\nSolution: ").trim();
  }

  const parts = [];
  if (obj.topic_en) parts.push(obj.topic_en);
  if (obj.topic_bn) parts.push(obj.topic_bn);
  if (obj.question_bn) parts.push(obj.question_bn);
  if (obj.answer_bn_en) parts.push(obj.answer_bn_en);
  if (Array.isArray(obj.keywords_en)) parts.push(obj.keywords_en.join(" "));

  return parts.join("\n").trim();
}

// Retry helper for upsert
async function upsertWithRetry(collection, points, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await client.upsert(collection, { points, wait: true });
      return;
    } catch (err) {
      const msg = err?.cause?.code || err?.message || String(err);
      console.log(`⚠️ Upsert failed (attempt ${attempt}/${retries}):`, msg);

      if (attempt === retries) throw err;
      // wait a bit before retry
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(rawText) {
  if (!rawText) return null;

  // e.g. "Please retry in 12.592833013s."
  const retryInMatch = rawText.match(/retry\s+in\s+([0-9.]+)s/i);
  if (retryInMatch) {
    return Math.ceil(Number(retryInMatch[1]) * 1000);
  }

  // e.g. "\"retryDelay\":\"12s\""
  const retryDelayMatch = rawText.match(/"retryDelay"\s*:\s*"([0-9.]+)s"/i);
  if (retryDelayMatch) {
    return Math.ceil(Number(retryDelayMatch[1]) * 1000);
  }

  return null;
}

function isRateLimitError(err) {
  const status = err?.status || err?.cause?.status;
  const msg = String(err?.message || "");
  return status === 429 || /RESOURCE_EXHAUSTED|quota|rate\-?limit/i.test(msg);
}

async function embedOne(text, retries = EMBED_MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const now = Date.now();
      const timeSinceLast = now - lastEmbedAt;
      const waitMs = EMBED_MIN_INTERVAL_MS - timeSinceLast;
      if (waitMs > 0) {
        await sleep(waitMs);
      }

      const response = await ai.models.embedContent({
        model: "gemini-embedding-001",
        contents: text,
      });

      lastEmbedAt = Date.now();
      return response.embeddings[0].values;
    } catch (err) {
      if (!isRateLimitError(err) || attempt === retries) {
        throw err;
      }

      const retryDelayMs = parseRetryDelayMs(String(err?.message || ""));
      const fallbackDelayMs = 5000 + attempt * 2000;
      const delayMs = Math.max(retryDelayMs || 0, fallbackDelayMs);

      console.log(
        `⚠️ Embed rate limit hit (attempt ${attempt}/${retries}). Waiting ${Math.ceil(delayMs / 1000)}s before retry...`
      );

      await sleep(delayMs);
    }
  }
}

async function ensureCollection(collectionName, vectorSize) {
  const collections = await client.getCollections();
  const exists = collections.collections?.some((c) => c.name === collectionName);

  if (!exists) {
    await client.createCollection(collectionName, {
      vectors: { size: vectorSize, distance: "Cosine" },
    });
    console.log("✅ Created collection:", collectionName);
  } else {
    console.log("ℹ️ Collection already exists:", collectionName);
  }

  await ensurePayloadIndexes(collectionName);
}

async function ensurePayloadIndexes(collectionName) {
  const fields = ["subject_slug", "category_slug", "topic"];
  for (const fieldName of fields) {
    try {
      await client.createPayloadIndex(collectionName, {
        wait: true,
        field_name: fieldName,
        field_schema: "keyword",
      });
      console.log(`✅ Created keyword index: ${fieldName}`);
    } catch (error) {
      if (error.message?.includes("already exists") || error.status === 409) {
        console.log(`ℹ️ Index already exists: ${fieldName}`);
      } else {
        console.log(`⚠️ Could not create index '${fieldName}':`, error.message);
      }
    }
  }
}

async function embedTexts(texts) {
  const vectors = [];
  for (const t of texts) {
    const vec = await embedOne(t);
    vectors.push(vec);
  }
  return vectors;
}

function seedToUuid(seed) {
  const hash = crypto.createHash("md5").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function main() {
  const args = parseCliArgs(process.argv);
  const JSONL_PATH = args.jsonlPath;
  const collectionName = args.collection || DEFAULT_COLLECTION;

  const defaultSubject = args.subject || "general";
  const defaultCategory = args.category || deriveCategoryFromPath(JSONL_PATH);
  const defaultBook = args.book || "Question Bank";
  const sourceFile = path.basename(JSONL_PATH);

  const defaultSubjectSlug = normalizeSlug(defaultSubject) || "general";
  const defaultCategorySlug = normalizeSlug(defaultCategory) || "general";

  console.log("Using JSONL:", JSONL_PATH);
  console.log("Target collection:", collectionName);
  console.log("Default subject:", defaultSubject, `(${defaultSubjectSlug})`);
  console.log("Default category:", defaultCategory, `(${defaultCategorySlug})`);

  // 1) Determine embedding size from a single sample
  const sample = await embedOne("test");
  const vectorSize = sample.length;
  console.log("Embedding dim:", vectorSize);

  // 2) Ensure collection exists
  await ensureCollection(collectionName, vectorSize);

  // 3) Stream JSONL and ingest
  const rl = readline.createInterface({
    input: fs.createReadStream(JSONL_PATH, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let batch = [];
  let batchIds = [];
  let pointId = 1;
  let total = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const text = buildSearchableText(obj);
    if (!text) continue;

    const rowSubject = args.subject ? defaultSubject : obj.subject || defaultSubject;
    const rowCategory = args.category ? defaultCategory : obj.category || obj.topic || defaultCategory;
    const rowSubjectSlug = normalizeSlug(rowSubject) || defaultSubjectSlug;
    const rowCategorySlug = normalizeSlug(rowCategory) || defaultCategorySlug;
    const rowType = String(obj.type || obj.chunk_type || obj.kind || "").trim();

    const stableRowIdPart =
      obj.id !== undefined && obj.id !== null && String(obj.id).trim().length > 0
        ? String(obj.id).trim()
        : String(pointId);

    const qdrantPointId = seedToUuid(`${rowSubjectSlug}:${rowCategorySlug}:${stableRowIdPart}`);

    batch.push(text);
    batchIds.push({
      id: qdrantPointId,
      payload: {
        subject: rowSubject,
        subject_slug: rowSubjectSlug,
        category: rowCategory,
        category_slug: rowCategorySlug,
        level: obj.level || "HSC",
        chapter: obj.chapter || "",
        topic: obj.topic || rowCategory,
        type: rowType,
        chunk_type: String(obj.chunk_type || "").trim(),
        kind: String(obj.kind || "").trim(),
        book: obj.book || defaultBook,
        chunk_id: obj.id ?? null,
        source_file: sourceFile,
        text,
      },
    });

    pointId++;
    if (batch.length >= BATCH_SIZE) {
      const vectors = await embedTexts(batch);

      const points = batchIds.map((p, i) => ({
        id: p.id,
        vector: vectors[i],
        payload: p.payload,
      }));

      await upsertWithRetry(collectionName, points);
      total += points.length;
      console.log("✅ Upserted:", total);

      batch = [];
      batchIds = [];
    }
  }

  // flush remaining
  if (batch.length) {
    const vectors = await embedTexts(batch);
    const points = batchIds.map((p, i) => ({
      id: p.id,
      vector: vectors[i],
      payload: p.payload,
    }));
    await upsertWithRetry(collectionName, points);
    total += points.length;
    console.log("✅ Upserted:", total);
  }

  console.log("🎉 Done! Total points:", total);
}

main().catch((e) => {
  console.error("❌ Ingest failed:", e);
  process.exit(1);
});
