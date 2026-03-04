# Subject/Category Integration for Qdrant RAG

This backend now supports **subject-wise** and **category-wise** chunk storage and retrieval.

## 1) Frontend Ask Endpoint

- **Method:** `POST`
- **URL:** `/api/ai/ask`
- **Body (JSON):**

```json
{
  "question": "What is Newton's second law?",
  "subject": "physics",
  "category": "mechanics"
}
```

### Required field
- `question` (string)

### Optional but recommended
- `subject` (string): e.g., `physics`, `chemistry`, `math`
- `category` (string): e.g., `mechanics`, `organic`, `algebra`

If `subject` and `category` are sent, retrieval is filtered by these values in Qdrant (`subject_slug`, `category_slug`).

---

## 2) Ingest JSONL by Subject/Category

Use the ingest script with explicit subject/category:

```bash
npm run ingest:qdrant -- --jsonl organic_chem_bn_en.jsonl --subject chemistry --category organic --book "HSC Chemistry 2nd Paper"
```

You can now also choose the target Qdrant collection explicitly:

```bash
npm run ingest:qdrant -- --jsonl math.jsonl --subject math --category math --book "HSC Higher Math 1st Paper" --collection hsc_math
```

### CLI options
- `--jsonl` (or `--file`) path to JSONL
- `--subject` subject name
- `--category` category name
- `--book` book/source label
- `--collection` target Qdrant collection name (optional; falls back to `QDRANT_COLLECTION`)

The script stores payload fields:
- `subject`
- `subject_slug`
- `category`
- `category_slug`
- `topic`
- `book`
- `source_file`
- `text`

These are used for category-wise filtering in RAG.

---

## 3) Batch Ingest Multiple Files

1. Copy and edit config from `scripts/ingest-map.example.json`.
2. Run:

```bash
npm run ingest:qdrant:batch -- --config scripts/ingest-map.example.json
```

Each entry must include:
- `jsonl`
- `subject`
- `category`

Optional per-entry field:
- `collection`

Recommended collection names for subject-wise retrieval:
- Chemistry → `hsc_chem_2nd_paper`
- Math → `hsc_math`
- Physics → `hsc_physics`

---

## 4) JSONL Format Notes

Your JSONL can be either:

1. Standard chunk format with `text`
2. QA format (like `organic_chem_bn_en.jsonl`) with:
   - `topic_en`
   - `topic_bn`
   - `question_bn`
   - `answer_bn_en`
   - `keywords_en`

If `text` is not present, backend auto-builds searchable text from the QA fields.

