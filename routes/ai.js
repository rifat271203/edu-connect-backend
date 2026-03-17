require("dotenv").config();
const express = require("express");
const { GoogleGenAI } = require("@google/genai");
const { QdrantClient } = require("@qdrant/js-client-rest");
const { detectQuestionType } = require("../utils/organicDetector");
const { handleChemistryQuestion, getChemistryMaps } = require("./aiChemistry");
const { handleMathQuestion } = require("./aiMath");
const { handlePhysicsQuestion } = require("./aiPhysics");
const { smilesMap, aliasToCanonical, smilesToCanonical } = getChemistryMaps();

const router = express.Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════
const PAYLOAD_INDEX_FIELDS   = ["topic", "subject_slug", "category_slug"];
const DEFAULT_COLLECTION_NAME = process.env.QDRANT_COLLECTION || "hsc_chem_2nd_paper";

const SUBJECT_COLLECTION_MAP = {
  chemistry: process.env.QDRANT_COLLECTION_CHEMISTRY || process.env.QDRANT_COLLECTION || "hsc_chem_2nd_paper",
  math:      process.env.QDRANT_COLLECTION_MATH      || "hsc_math",
  physics:   process.env.QDRANT_COLLECTION_PHYSICS   || "hsc_physics",
};

const GROQ_MODEL_FALLBACKS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "llama3-70b-8192",
  "mixtral-8x7b-32768",
];

const OPENROUTER_MODEL_FALLBACKS = [
  "google/gemma-2-9b-it",
  "meta-llama/llama-3.1-8b-instruct",
  "mistralai/mistral-7b-instruct",
  "openai/gpt-4o-mini",
];


// ═══════════════════════════════════════════════════════════════════
// LANGUAGE DETECTOR
// Only returns "bangla" when the question is CLEARLY in Bangla.
// English or scientific questions → "english" regardless of any
// stray Bangla punctuation or unicode characters.
// ═══════════════════════════════════════════════════════════════════
function detectLanguage(text) {
  if (!text) return "english";
  const str       = String(text);
  const bangla    = (str.match(/[\u0980-\u09FF]/g) || []).length;
  const total     = str.replace(/\s/g, "").length || 1;
  const ratio     = bangla / total;

  // Strict threshold: >30% bangla chars = bangla
  // 10–30% = mixed (answer in bangla)
  // <10%   = english  ← key change: was 0.05, now 0.10
  if (ratio > 0.30) return "bangla";
  if (ratio > 0.10) return "mixed";
  return "english";
}


// ═══════════════════════════════════════════════════════════════════
// ██  QUESTION TYPE CLASSIFIER  (server-side, fast, no LLM needed)
// ═══════════════════════════════════════════════════════════════════
// Returns: { isConversion: bool, questionMode: string }
//
// CONVERSION (is_conversion = true):
//   "benzene to nitrobenzene কর", "convert A to B",
//   "A থেকে B তৈরি করো", reaction equations, mechanism questions
//
// DESCRIPTION (is_conversion = false):
//   "what is benzene", "বেনজিনের ধর্ম কী", "why is phenol acidic",
//   "explain aromaticity", definition/property/concept questions
// ═══════════════════════════════════════════════════════════════════

// Bangla + English patterns that strongly signal a CONVERSION question
const CONVERSION_PATTERNS = [
  // ── Direct conversion verbs ───────────────────────────────────
  /\bconvert\b/i,
  /\bconversion\b/i,
  /\bpreparation\s+of\b/i,
  /\bsynthesis\s+of\b/i,
  /\breaction\s+of\b/i,

  // ── "X to Y" — the most common student phrasing ──────────────
  // Covers: "benzene to benzoic acid", "ethene to ethanol",
  //         "toluene to benzoic acid", "methane to ethane"
  /\b[a-zA-Z][a-zA-Z0-9\-]*\s+to\s+[a-zA-Z][a-zA-Z0-9\-]/i,

  // ── "from X" / "get/make X from Y" ───────────────────────────
  // Covers: "how do i get nitrobenzene from benzene",
  //         "prepare ethanol from ethene"
  /\bfrom\s+[a-zA-Z][a-zA-Z0-9]/i,

  // ── "how can/do I make/get/prepare/convert/obtain" ────────────
  // Covers: "how can i make benzene to benzoic acid"
  /\bhow\s+(?:can|do|can\s+i|do\s+i|can\s+we|to)\s+(?:make|get|convert|prepare|synthesize|obtain|produce|form)\b/i,

  // ── Imperative: "prepare/synthesize/obtain X" ─────────────────
  /\b(?:prepare|synthesize|obtain|produce)\s+\w+/i,

  // ── Passive: "how is X made/prepared/formed/obtained" ─────────
  /\b(?:how\s+(?:is|are|to|do(?:es)?)\s+\w+\s+(?:made|prepared|synthesized|formed|obtained|produced))\b/i,

  // ── Named reaction types ──────────────────────────────────────
  /\b(?:nitration|bromination|chlorination|sulfonation|sulphonation|ozonolysis|hydrogenation|halogenation|alkylation|acylation|esterification|saponification|decarboxylation)\b/i,

  // ── Mechanism keywords ────────────────────────────────────────
  /\bmechanism\s+of\b/i,
  /\bmechanism\s+for\b/i,
  /\bthe\s+mechanism\b/i,
  /\belectrophilic\s+(?:substitution|addition|attack|aromatic)\b/i,
  /\bnucleophilic\s+(?:substitution|addition|attack)\b/i,
  /\bmarkovnikov\b/i,

  // ── Product questions ─────────────────────────────────────────
  /\bwhat\s+(?:is|are)\s+(?:the\s+)?(?:product|major\s+product|main\s+product|products)\b/i,
  /\bproduct\s+(?:of|when|formed)\b/i,

  // ── "when X reacts with Y" ────────────────────────────────────
  /\bwhen\b.{0,40}\breact/i,
  /\b(?:react(?:s|ed)?)\s+with\b/i,

  // ── Chemical equation notation ────────────────────────────────
  /\b\+\s*(?:[A-Z][a-z]|H\d|Br|Cl|HNO|H2SO|AlCl)\b/,
  /→|⟶|-->|->|⟹/,

  // ── Bangla conversion keywords ────────────────────────────────
  /থেকে\s*(?:তৈরি|[a-zA-Z\u0980-\u09FF])/,  // "X থেকে Y" OR "থেকে benzoic"
  /রূপান্তর/,
  /প্রস্তুত/,
  /বিক্রিয়া/,
  /উৎপন্ন/,
  /নাইট্রেশন/,
  /ব্রোমিনেশন/,
  /হ্যালোজিনেশন/,
  /জারণ/,
  /বিজারণ/,
  /পলিমারকরণ/,
  /বিক্রিয়ার\s*পদ্ধতি/,
  /ইলেকট্রোফিলিক/,
  /নিউক্লিওফিলিক/,
  /মার্কনিকভ/,
  /সমীকরণ/,
  /বিক্রিয়ার\s*ধাপ/,
];

// Patterns that STRONGLY signal a description/concept question.
// NOTE: "explain the mechanism" alone is NOT here — if it has "mechanism of X"
// it will match CONVERSION_PATTERNS above (more specific wins).
// These only fire if NO conversion pattern matched first.
const DESCRIPTION_PATTERNS = [
  // English — "what is", "define", "explain X" (without "mechanism of")
  /^(?:what\s+is|what\s+are|define|definition\s+of|describe|state)\b/i,
  /\bwhy\s+is\b/i,
  /\bwhy\s+are\b/i,
  /\bwhat\s+(?:do\s+you\s+mean|does.*mean)\b/i,
  /\bproperties\s+of\b/i,
  /\bstructure\s+of\b/i,
  /\bcharacteristics\s+of\b/i,
  /\buse(?:s)?\s+of\b/i,
  /\bapplication(?:s)?\s+of\b/i,
  /\bdifference\s+between\b/i,
  /\bcompare\b/i,

  // Bangla description keywords
  /কী\s*(?:বলা|বলে|বোঝায়)/,    // "what do you mean by"
  /কাকে\s*বলে/,                  // "what is called"
  /কী\s*ধর্ম/,                   // "what properties"
  /কী\s*বৈশিষ্ট্য/,               // "what characteristics"
  /বর্ণনা\s*কর/,                 // "describe"
  /সংজ্ঞা/,                      // "definition"
  /পার্থক্য/,                    // "difference"
  /তুলনা/,                       // "compare"
  /কেন\s+অ্যাসিডিক/,             // "why acidic"
  /কেন\s+ক্ষারীয়/,               // "why basic/alkaline"
  /ধর্মাবলী/,                    // "properties (plural)"
  /ব্যবহার/,                     // "uses"
  /প্রয়োগ/,                      // "applications"
];

/**
 * Classifies question into CONVERSION or DESCRIPTION.
 *
 * Rules (in priority order):
 *  1. If a strong DESCRIPTION pattern matches → description
 *  2. If a CONVERSION pattern matches         → conversion
 *  3. If question contains a chemical equation or reaction arrow → conversion
 *  4. Default → description (safer: don't draw diagrams unless sure)
 */
function classifyQuestionMode(question) {
  const q = String(question || "");

  // 1. Conversion check FIRST — specific reaction signals always win
  for (const pat of CONVERSION_PATTERNS) {
    if (pat.test(q)) {
      return { isConversion: true, questionMode: "conversion" };
    }
  }

  // 2. Description check second
  for (const pat of DESCRIPTION_PATTERNS) {
    if (pat.test(q)) {
      return { isConversion: false, questionMode: "description" };
    }
  }

  // 3. Default → description (safe: avoid empty diagrams)
  return { isConversion: false, questionMode: "description" };
}


// ═══════════════════════════════════════════════════════════════════
// ██  SYSTEM PROMPTS — PER SUBJECT, BILINGUAL-AWARE
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
// CHEMISTRY SYSTEM PROMPT
// Two modes injected at runtime:
//   MODE A — CONVERSION  : full diagram + mechanism + steps
//   MODE B — DESCRIPTION : explanation + relevant equations only
// ─────────────────────────────────────────────────────────────────
const CHEMISTRY_SYSTEM_PROMPT_BASE = `You are an expert Bangladesh HSC Chemistry tutor (1st and 2nd Paper).
You specialize in Organic Chemistry, Physical Chemistry, and Inorganic Chemistry at HSC level.

━━━ STRICT LANGUAGE RULE ━━━━━━━━━━━━━━━━━━━━━━━━━━
YOU MUST FOLLOW THIS EXACTLY — NO EXCEPTIONS:

  IF the question contains MOSTLY BANGLA text (>30% Bangla unicode characters):
    → Write "answer", mechanism desc, key_points FULLY IN BANGLA.
    → Keep chemistry terms in English inside parentheses: "বেনজিন (benzene)"
    → Example: "নাইট্রেশন বিক্রিয়ায় (nitration) বেনজিন ..."

  IF the question is in ENGLISH or is a chemical formula/equation:
    → Write EVERYTHING in ENGLISH.
    → Do NOT switch to Bangla even partially.

  IF the question is mixed (some Bangla + some English):
    → Answer in BANGLA, keep chemistry terms in English in ().

  JSON keys, SMILES strings, field names → ALWAYS in English regardless.
  "subject" and "category" fields → ALWAYS "chemistry".

━━━ INTERNAL REASONING (do silently) ━━━━━━━━━━━━━━
STEP 1 — Classify:
  reaction_type: conversion_reaction | aromatic_substitution | addition_reaction |
                 elimination_reaction | oxidation_reduction | rearrangement |
                 resonance_concept | acid_base | conceptual_theory | unknown

  question_mode: EITHER "conversion" OR "description"
    conversion  → student wants a reaction, equation, mechanism, or product
    description → student wants a definition, explanation, property, or concept

STEP 2 — Identify substrate_class:
  aromatic | aliphatic | alkene | alkyne | alcohol | acid |
  aldehyde | ketone | ester | amine | halide | unknown

STEP 3 — Track carbon_change:
  carbon_increase | carbon_decrease | carbon_same | unknown

{{MODE_INSTRUCTION}}

VERIFIED SMILES — use ONLY these exact strings:
  benzene       → c1ccccc1       toluene      → Cc1ccccc1
  phenol        → Oc1ccccc1      aniline      → Nc1ccccc1
  nitrobenzene  → O=[N+]([O-])c1ccccc1        chlorobenzene → Clc1ccccc1
  bromobenzene  → Brc1ccccc1     naphthalene  → c1ccc2ccccc2c1
  ethene        → C=C            propene      → CC=C
  ethyne        → C#C            methane      → C
  ethane        → CC             propane      → CCC
  ethanol       → CCO            methanol     → CO
  acetic acid   → CC(=O)O        methanal     → C=O
  ethanal       → CC=O           acetone      → CC(C)=O
  HCl → Cl      HBr → Br         Br2 → BrBr   Cl2 → ClCl
  H2SO4 → OS(=O)(=O)O           HNO3 → O[N+](=O)[O-]
  NaOH → [Na+].[OH-]            H2O → O
  CO2 → O=C=O   NH3 → N         O3 → [O-][O+]=O
  Unknown molecule → smiles: ""

━━━ HARD RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Return ONLY valid JSON. No text before/after. No markdown fences.
2. "answer" must be a real paragraph, NEVER a bullet list.
3. Reactants come ONLY from the student question, never from your training data.
4. If product is uncertain → products: []
5. key_points must have exactly 3 items about this specific question.
6. Unknown SMILES → use "" not a guessed string.
7. is_conversion MUST match question_mode: true for conversion, false for description.`;

// Injected for CONVERSION questions
const CONVERSION_MODE_INSTRUCTION = `━━━ MODE: CONVERSION REACTION ━━━━━━━━━━━━━━━━━━━
This is a CONVERSION / REACTION question. The student wants to know:
how a reaction happens, what product forms, or the mechanism.

STEP 4 — Write answer (8 to 14 lines) covering:
  • What reaction occurs and what product forms
  • Why it occurs (electronic reason: inductive/resonance effect etc.)
  • Role of each reagent
  • Conditions (temperature, catalyst, pressure)
  • Markovnikov/anti-Markovnikov if alkene addition
  • o/p or m-directing if aromatic substitution
  • If carbon count changes, explain why

STEP 5 — Build SMILES diagram:
  reactants: ONLY molecules named in the question
  reagents:  ONLY mentioned OR standard for this reaction type
  products:  ONLY actual products of this reaction
  NEVER invent molecules. Unknown SMILES → ""

STEP 6 — Build mechanism_steps (REQUIRED for conversion):
  Always include 2–4 mechanism steps for conversion reactions.
  Each step: title (short), desc (2–3 sentences in detected language),
  structures (relevant molecules for that step)

OUTPUT JSON:
{
  "question_mode": "conversion",
  "is_conversion": true,
  "reaction_type": "",
  "substrate_class": "",
  "carbon_change": "",
  "answer": "8–14 line explanation in detected language",
  "diagram": {
    "reactants": [{ "name": "", "smiles": "" }],
    "reagents":  [{ "name": "", "smiles": "" }],
    "conditions": "",
    "products":  [{ "name": "", "smiles": "", "type": "major|minor|possible" }]
  },
  "diagram_caption": "One sentence: what reaction is shown.",
  "mechanism_steps": [
    { "step": 1, "title": "", "desc": "", "structures": [{ "name": "", "smiles": "" }] }
  ],
  "equations": [],
  "key_points": ["tip 1", "tip 2", "common mistake"],
  "resonance": null,
  "contextUsed": false,
  "subject": "chemistry",
  "category": "chemistry"
}`;

// Injected for DESCRIPTION questions
const DESCRIPTION_MODE_INSTRUCTION = `━━━ MODE: DESCRIPTION / CONCEPT QUESTION ━━━━━━━━━
This is a DESCRIPTION question. The student wants an explanation,
definition, property, or conceptual understanding — NOT a reaction.

STEP 4 — Write answer (10 to 18 lines) covering:
  • Clear definition or explanation of the concept
  • Physical/chemical properties if relevant
  • Electronic explanation (bonding, hybridization, resonance) if helpful
  • Real examples from HSC syllabus
  • Comparison or contrast if the question asks for it
  • Do NOT force a reaction mechanism unless the concept itself IS a mechanism

STEP 5 — Equations (OPTIONAL — only if they aid explanation):
  If the concept involves a chemical equation (e.g., explaining acidity of phenol,
  explaining resonance, explaining a property by an example reaction):
  → Add 1–3 short equations in the "equations" array as plain text strings.
  → Example: "C6H5OH + NaOH → C6H5ONa + H2O"
  → If no equation is needed → equations: []

STEP 6 — Diagram (OPTIONAL — only if a structure aids explanation):
  If showing a molecular structure helps (e.g., benzene structure for aromaticity):
  → Populate diagram.reactants with that molecule only.
  → Keep diagram.reagents: [], diagram.products: [], diagram.conditions: ""
  → If no structure is needed → leave all diagram arrays empty.

STEP 7 — mechanism_steps:
  → ALWAYS set mechanism_steps: []  for description questions.
  → Do NOT add mechanism steps for descriptions.

OUTPUT JSON:
{
  "question_mode": "description",
  "is_conversion": false,
  "reaction_type": "conceptual_theory",
  "substrate_class": "",
  "carbon_change": "unknown",
  "answer": "10–18 line conceptual explanation in detected language",
  "diagram": {
    "reactants": [],
    "reagents":  [],
    "conditions": "",
    "products":  []
  },
  "diagram_caption": "",
  "mechanism_steps": [],
  "equations": [
    "Optional: C6H5OH + NaOH → C6H5ONa + H2O",
    "Only if an equation genuinely aids the explanation"
  ],
  "key_points": ["tip 1", "tip 2", "common mistake"],
  "resonance": null,
  "contextUsed": false,
  "subject": "chemistry",
  "category": "chemistry"
}`;

function buildChemistrySystemPrompt(isConversion) {
  const modeInstruction = isConversion
    ? CONVERSION_MODE_INSTRUCTION
    : DESCRIPTION_MODE_INSTRUCTION;
  return CHEMISTRY_SYSTEM_PROMPT_BASE.replace("{{MODE_INSTRUCTION}}", modeInstruction);
}


// ─────────────────────────────────────────────────────────────────
// MATHEMATICS SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────
const MATH_SYSTEM_PROMPT = `You are an expert Bangladesh HSC Mathematics tutor (1st and 2nd Paper).

Topics: Algebra, Trigonometry, Calculus, Coordinate Geometry, Vectors,
Probability & Statistics, Complex Numbers, Matrices & Determinants.

━━━ STRICT LANGUAGE RULE ━━━━━━━━━━━━━━━━━━━━━━━━━━
  Bangla question (>30% Bangla chars) → answer, step titles, key_points in BANGLA.
  English question → answer FULLY in ENGLISH.
  Mixed → prefer BANGLA, math notation stays standard.
  DO NOT answer in Bangla if the question is in English.

━━━ SOLVING RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1.  Identify topic and method BEFORE solving.
2.  State formula/theorem first, then apply.
3.  Show EVERY algebraic step — never skip.
4.  Sub-parts (ক/খ/গ/ঘ or a/b/c): answer each separately with its label.
5.  Proofs: separate LHS and RHS clearly.
6.  Integration: always write integral symbol and dx/dt.
7.  Differentiation: write d/dx notation.
8.  Matrix problems: bracket notation.
9.  Word problems: define each variable first.
10. Final answer on its own labelled line.
11. Minimum 3 steps in the steps array.

━━━ OUTPUT — VALID JSON ONLY ━━━━━━━━━━━━━━━━━━━━━
{
  "topic": "",
  "method": "",
  "answer": "Full solution with newlines between steps. End: Final Answer: result",
  "steps": [
    { "step": 1, "title": "", "work": "", "result": "" }
  ],
  "final_answer": "",
  "graph_hint": null,
  "key_points": ["tip 1", "tip 2", "common mistake"],
  "contextUsed": false,
  "subject": "math",
  "category": "math"
}

HARD RULES:
1. Return ONLY valid JSON. No markdown, no preamble.
2. "answer" contains the full solution with newline-separated steps.
3. steps[] mirrors answer. Never skip a step.
4. Proof → final_answer = "Proved — LHS = RHS".
5. Never fabricate formulas.`;


// ─────────────────────────────────────────────────────────────────
// PHYSICS SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────
const PHYSICS_SYSTEM_PROMPT = `You are an expert Bangladesh HSC Physics tutor (1st and 2nd Paper).

Topics: Mechanics, Circular Motion, SHM, Waves, Optics, Thermodynamics,
Electrostatics, Current Electricity, Magnetism, EM Induction, Modern Physics.

━━━ STRICT LANGUAGE RULE ━━━━━━━━━━━━━━━━━━━━━━━━━━
  Bangla question (>30% Bangla chars) → answer, step titles, key_points in BANGLA.
  English question → answer FULLY in ENGLISH.
  Mixed → prefer BANGLA, formulas stay standard notation.
  DO NOT answer in Bangla if the question is in English.

━━━ SOLVING RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1.  State the law/principle first (one sentence).
2.  List ALL given data with SI units in "given" array.
3.  Write formula BEFORE substituting values.
4.  Show unit at EVERY calculation step — never drop units.
5.  Final answer: value + SI unit + direction if vector.
6.  Sub-parts: answer each with its label.
7.  Derivations: first principles, every step shown.
8.  Conceptual (no numbers): explain in 5–9 sentences with real example.
9.  Graph questions: describe axes and shape.
10. Minimum 3 steps for any numerical problem.

SI UNITS: Force N, Pressure Pa, Energy J, Power W,
Charge C, Voltage V, Resistance Ω, Magnetic field T, Frequency Hz.

━━━ OUTPUT — VALID JSON ONLY ━━━━━━━━━━━━━━━━━━━━━
{
  "topic": "",
  "law_or_principle": "",
  "given": [{ "symbol": "", "value": "", "unit": "", "description": "" }],
  "formula": "",
  "answer": "Full solution with newlines. Format: Given→Formula→Steps→Final Answer: value unit direction",
  "steps": [
    { "step": 1, "title": "", "work": "", "result": "" }
  ],
  "final_answer": "",
  "diagram_hint": null,
  "key_points": ["tip 1", "tip 2", "unit mistake to avoid"],
  "contextUsed": false,
  "subject": "physics",
  "category": "physics"
}

HARD RULES:
1. Return ONLY valid JSON. No markdown, no preamble.
2. NEVER omit units in given[], steps[], or final_answer.
3. NEVER invent values not in the question.
4. steps[] mirrors answer.
5. Conceptual: given = [], final_answer = "See explanation above".`;


// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════
function normalizeSlug(value) {
  if (!value || typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasInText(alias, text) {
  if (!alias || !text) return false;
  const escaped = escapeRegExp(alias.trim());
  if (!escaped) return false;
  if (/^[a-z0-9_+\-]+$/i.test(alias.trim())) {
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  }
  return String(text).toLowerCase().includes(alias.toLowerCase());
}

function sentenceWithAlias(text, aliases) {
  if (!text) return "";
  const parts = String(text).split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
  return parts.find((s) => aliases.some((a) => aliasInText(a, s))) || "";
}

function classifyProductType(sentence) {
  if (!sentence) return "major";
  if (/(possible|may|might|can form|could form|depends|সম্ভাব|হতে পারে)/i.test(sentence)) return "possible";
  if (/(minor|স্বল্প|কম পরিমাণ)/i.test(sentence)) return "minor";
  return "major";
}

function inferConditions(text) {
  const conditions = [], seen = new Set();
  const cues = [
    { regex: /conc\.?\s*h2so4|concentrated\s+sulfuric/i, label: "conc. H2SO4"  },
    { regex: /conc\.?\s*hno3|concentrated\s+nitric/i,    label: "conc. HNO3"   },
    { regex: /heat|\b\u0394\b|high\s+temp/i,              label: "heat"          },
    { regex: /uv|hv|\blight\b/i,                          label: "UV/light"      },
    { regex: /\bcatalyst\b|cat\./i,                       label: "catalyst"      },
    { regex: /acidic|acid\s+medium/i,                     label: "acid medium"   },
    { regex: /basic|alkaline|base\s+medium/i,             label: "base medium"   },
    { regex: /\bpressure\b|atm/i,                         label: "pressure"      },
    { regex: /\bo3\b|ozone/i,                             label: "O3"            },
    { regex: /\bzn\b|zinc/i,                              label: "Zn"            },
    { regex: /\bh2o\b|\bwater\b/i,                        label: "H2O"           },
    { regex: /\bh2o2\b|hydrogen\s+peroxide/i,             label: "H2O2"          },
    { regex: /\bdms\b|dimethyl\s+sulfide/i,               label: "DMS"           },
    { regex: /\balcl3\b/i,                                label: "AlCl3"         },
    { regex: /\bfebr3\b/i,                                label: "FeBr3"         },
    { regex: /\bfecl3\b/i,                                label: "FeCl3"         },
    { regex: /\bni\b|nickel/i,                            label: "Ni catalyst"   },
    { regex: /\bpt\b|platinum/i,                          label: "Pt catalyst"   },
    { regex: /\bpd\b|palladium/i,                         label: "Pd catalyst"   },
  ];
  for (const cue of cues) {
    if (cue.regex.test(text) && !seen.has(cue.label)) {
      seen.add(cue.label);
      conditions.push(cue.label);
    }
  }
  return conditions.join(", ");
}

function getConfiguredCollections() {
  return [...new Set([
    DEFAULT_COLLECTION_NAME,
    process.env.QDRANT_COLLECTION_CHEMISTRY,
    process.env.QDRANT_COLLECTION_MATH,
    process.env.QDRANT_COLLECTION_PHYSICS,
  ].map((n) => String(n || "").trim()).filter(Boolean))];
}

function resolveCollectionName(subject, category) {
  const s = pickSubjectHandler(subject, category);
  return (s && SUBJECT_COLLECTION_MAP[s]) ? SUBJECT_COLLECTION_MAP[s] : DEFAULT_COLLECTION_NAME;
}


// ═══════════════════════════════════════════════════════════════════
// RESONANCE LIBRARY
// ═══════════════════════════════════════════════════════════════════
const RESONANCE_LIBRARY = {
  benzene: {
    base:  { name: "benzene", smiles: "c1ccccc1" },
    forms: [
      { name: "benzene (aromatic)",      smiles: "c1ccccc1"    },
      { name: "benzene (Kekule form A)", smiles: "C1=CC=CC=C1" },
    ],
    arrow_steps: [
      { step: 1, type: "pi_shift", desc: "All three pi-bonds shift one position around the ring, giving two equivalent Kekule forms." },
    ],
    note: "HSC: Benzene is a resonance hybrid. Both Kekule forms contribute equally — all C-C bonds are identical (1.40 Å).",
  },
  toluene: {
    base:  { name: "toluene", smiles: "Cc1ccccc1" },
    forms: [
      { name: "toluene (aromatic)", smiles: "Cc1ccccc1"    },
      { name: "toluene (Kekule)",   smiles: "CC1=CC=CC=C1" },
    ],
    arrow_steps: [
      { step: 1, type: "pi_shift", desc: "Same benzene ring pi-bond resonance; CH3 stays attached and activates the ring via +I effect." },
    ],
    note: "HSC: Toluene shows benzene ring resonance. CH3 is +I and o/p-directing in EAS.",
  },
  phenol: {
    base:  { name: "phenol", smiles: "Oc1ccccc1" },
    forms: [
      { name: "phenol (aromatic)", smiles: "Oc1ccccc1"    },
      { name: "phenol (Kekule)",   smiles: "OC1=CC=CC=C1" },
    ],
    arrow_steps: [
      { step: 1, type: "pi_shift",        desc: "Normal benzene ring pi-bond shifting." },
      { step: 2, type: "lone_pair_to_pi", desc: "Oxygen lone pair donates into ring — extra electron density at ortho and para." },
    ],
    note: "HSC: -OH is strongly activating by +M effect, directing EAS to ortho/para.",
  },
  aniline: {
    base:  { name: "aniline", smiles: "Nc1ccccc1" },
    forms: [
      { name: "aniline (aromatic)", smiles: "Nc1ccccc1"    },
      { name: "aniline (Kekule)",   smiles: "NC1=CC=CC=C1" },
    ],
    arrow_steps: [
      { step: 1, type: "pi_shift",        desc: "Normal benzene ring pi-bond shifting." },
      { step: 2, type: "lone_pair_to_pi", desc: "NH2 lone pair delocalizes into ring — ortho and para positions become electron-rich." },
    ],
    note: "HSC: -NH2 is the strongest activating group by +M. Lone pair resonance explains o/p selectivity in EAS.",
  },
};

function isResonanceRequest(q) {
  const s = String(q || "").toLowerCase();
  return (
    s.includes("resonance") || s.includes("delocal") || s.includes("resonance structure") ||
    /\u09B0\u09C7\u099C\u09CB\u09A8\u09CD\u09AF\u09BE\u09A8\u09CD\u09B8/.test(s) ||
    /\u09B0\u09C7\u09B8\u09CB\u09A8\u09CD\u09AF\u09BE\u09A8\u09CD\u09B8/.test(s)
  );
}

function pickResonanceTarget(q) {
  const s = String(q || "").toLowerCase();
  if (s.includes("aniline") || s.includes("c6h5nh2"))        return "aniline";
  if (s.includes("phenol")  || s.includes("c6h5oh"))         return "phenol";
  if (s.includes("toluene") || s.includes("methylbenzene"))  return "toluene";
  if (s.includes("benzene") || s.includes("c6h6"))           return "benzene";
  return "";
}

function buildResonanceBlock(question) {
  if (!isResonanceRequest(question)) return null;
  const target = pickResonanceTarget(question);
  if (!target) return null;
  const entry = RESONANCE_LIBRARY[target];
  if (!entry) return null;
  return {
    target,
    base:        entry.base,
    forms:       (entry.forms || []).filter((f) => f && typeof f.smiles === "string" && f.smiles.trim()),
    arrow_steps: entry.arrow_steps || [],
    note:        entry.note || "",
  };
}


// ═══════════════════════════════════════════════════════════════════
// CHEMISTRY DIAGRAM BUILDER  (fallback when LLM JSON is incomplete)
// Only used for CONVERSION questions
// ═══════════════════════════════════════════════════════════════════
function buildChemDiagram(question, answer) {
  const src        = `${question || ""}\n${answer || ""}`;
  const answerText = String(answer || "");
  const productCue = /(product|products|forms?|formed|gives?|yields?|produces?|obtained|\u09C1\u09CE\u09AA\u09A8\u09CD\u09A8|\u09AA\u09A3\u09CD\u09AF|\u09A4\u09C8\u09B0\u09BF)/i;

  const reactants = [], reagents = [], products = [];
  const seenR = new Set(), seenRg = new Set(), seenP = new Set();

  for (const [name, info] of Object.entries(smilesMap)) {
    if (!info.smiles) continue;
    const aliases     = Array.isArray(info.aliases) ? info.aliases : [name];
    if (!aliases.some((a) => aliasInText(a, src))) continue;

    const sentence    = sentenceWithAlias(answerText, aliases) || sentenceWithAlias(src, aliases);
    const looksProduct= productCue.test(sentence);
    const role        = info.default_role || "reactant";

    if (role === "reagent") {
      if (!seenRg.has(name)) { seenRg.add(name); reagents.push({ name, smiles: info.smiles }); }
    } else if (role === "product" || looksProduct) {
      if (!seenP.has(name))  { seenP.add(name);  products.push({ name, smiles: info.smiles, type: classifyProductType(sentence) }); }
    } else {
      if (!seenR.has(name))  { seenR.add(name);  reactants.push({ name, smiles: info.smiles }); }
    }
  }

  return { reactants, reagents, conditions: inferConditions(src), products };
}

function inferReagentPresets(question, answer) {
  const t = `${question || ""}\n${answer || ""}`.toLowerCase();
  const inferred = [];
  const push = (k) => { const info = smilesMap[k]; if (info && info.smiles) inferred.push({ name: k, smiles: info.smiles }); };

  if (t.includes("nitration") || t.includes("nitro"))          { push("nitric_acid"); push("sulfuric_acid"); return inferred; }
  if (t.includes("bromination") || /\bbr2\b/i.test(t))        { push("bromine"); push("fe_br3"); return inferred; }
  if (t.includes("chlorination") || /\bcl2\b/i.test(t))       { push("chlorine"); push("fe_cl3"); return inferred; }
  if (t.includes("friedel") || t.includes("crafts"))          { push("alcl3"); return inferred; }
  if (t.includes("sulphonation") || t.includes("sulfonation")) { push("sulfuric_acid"); return inferred; }
  if (t.includes("ozonolysis") || /\bo3\b/.test(t)) {
    push("ozone");
    if (/\bzn\b|zinc/.test(t))   push("zinc");
    if (/\bh2o\b|water/.test(t)) push("water");
    if (t.includes("dms"))        push("dms");
    if (t.includes("h2o2"))       push("hydrogen_peroxide");
    return inferred;
  }
  return inferred;
}

function buildMechanismSteps(answer, context, diagram) {
  const t = `${context || ""}\n${answer || ""}`.toLowerCase();
  const steps = [];
  const prodStructs = (diagram.products || []).map((p) => ({ name: p.name, smiles: p.smiles }));

  if (t.includes("nitration")) {
    steps.push({ step: 1, title: "Electrophile formation",          desc: "Mixed acid (HNO3 + H2SO4) generates the nitronium ion NO2+, the active electrophile.", structures: diagram.reagents });
    steps.push({ step: 2, title: "Sigma complex (arenium ion)",     desc: "The aromatic ring attacks NO2+, forming an arenium (sigma) complex. Aromaticity is temporarily lost.", structures: diagram.reactants });
    steps.push({ step: 3, title: "Deprotonation / aromaticity restored", desc: "HSO4- removes H+ from the ring, restoring aromaticity and giving the nitro product.", structures: prodStructs });
    return steps;
  }
  if (t.includes("friedel") || t.includes("crafts") || t.includes("alkylation")) {
    steps.push({ step: 1, title: "Electrophile generation", desc: "AlCl3 (Lewis acid) accepts chloride from the alkyl halide, generating a carbocation-like electrophile.", structures: diagram.reagents });
    steps.push({ step: 2, title: "Electrophilic attack",    desc: "Benzene ring attacks the electrophile, forming a sigma complex.", structures: diagram.reactants });
    steps.push({ step: 3, title: "Deprotonation",           desc: "AlCl4- removes H+, restoring aromaticity and giving the alkylbenzene.", structures: prodStructs });
    return steps;
  }
  if (t.includes("bromination") || t.includes("chlorination") || /\bbr2\b|\bcl2\b/.test(t)) {
    steps.push({ step: 1, title: "Halogen activation",       desc: "Lewis acid (FeBr3/FeCl3) polarizes the halogen — one end becomes delta+ (electrophile).", structures: diagram.reagents });
    steps.push({ step: 2, title: "Sigma complex formation",  desc: "Aromatic ring attacks delta+ halogen — sigma complex (arenium ion) forms.", structures: diagram.reactants });
    steps.push({ step: 3, title: "Aromaticity restoration",  desc: "Loss of H+ restores aromaticity — halo-arene product formed.", structures: prodStructs });
    return steps;
  }
  if (t.includes("ozonolysis") || /\bo3\b/.test(t)) {
    steps.push({ step: 1, title: "Ozone addition",   desc: "O3 adds across the C=C pi bond in a [3+2] cycloaddition — ozonide intermediate forms.", structures: [...diagram.reactants, ...diagram.reagents.filter((m) => m.name === "ozone")] });
    steps.push({ step: 2, title: "Workup / cleavage", desc: "Reductive workup (Zn/H2O or DMS) cleaves the ozonide into carbonyl fragments.", structures: prodStructs });
    return steps;
  }
  // Generic fallback
  steps.push({ step: 1, title: "Identify substrate and reagent", desc: "Classify the reaction type from the substrate and reagent combination.", structures: [...diagram.reactants, ...diagram.reagents] });
  if (prodStructs.length) {
    steps.push({ step: 2, title: "Predict major product", desc: "Apply reaction rules to identify the major product.", structures: prodStructs });
  }
  return steps;
}


// ═══════════════════════════════════════════════════════════════════
// SMILES SANITIZERS
// ═══════════════════════════════════════════════════════════════════
function isPlausibleSmiles(smiles) {
  if (!smiles || typeof smiles !== "string") return false;
  const s = smiles.trim();
  if (!s) return false;
  if (!/[BCNOPSFIcnosp]/.test(s)) return false;
  if ((s.match(/\[/g) || []).length !== (s.match(/\]/g) || []).length) return false;
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function resolveKnownMolecule(item) {
  if (!item || typeof item !== "object") return null;
  const nameKey   = typeof item.name   === "string" ? item.name.trim().toLowerCase()  : "";
  const smilesKey = typeof item.smiles === "string" ? item.smiles.trim()              : "";

  let canonical = "";
  if (nameKey   && aliasToCanonical.has(nameKey))   canonical = aliasToCanonical.get(nameKey);
  else if (smilesKey && smilesToCanonical.has(smilesKey)) canonical = smilesToCanonical.get(smilesKey);

  if (canonical && smilesMap[canonical] && smilesMap[canonical].smiles) {
    return { name: canonical, smiles: smilesMap[canonical].smiles };
  }
  if (nameKey && isPlausibleSmiles(smilesKey)) {
    return { name: item.name.trim(), smiles: smilesKey };
  }
  return null;
}

function mergeUniqueStructures(primary, fallback) {
  const out = [], seen = new Set();
  const push = (arr) => {
    for (const mol of (Array.isArray(arr) ? arr : [])) {
      const key = `${mol.name}||${mol.smiles}`;
      if (!seen.has(key)) { seen.add(key); out.push(mol); }
    }
  };
  push(primary);
  push(fallback);
  return out;
}

function sanitizeMoleculeArray(input, fallback, isProduct = false) {
  const parsed = [];
  for (const item of (Array.isArray(input) ? input : [])) {
    const known = resolveKnownMolecule(item);
    if (!known) continue;
    if (isProduct) {
      const rawType = typeof item.type === "string" ? item.type.trim().toLowerCase() : "major";
      parsed.push({ ...known, type: ["major","minor","possible"].includes(rawType) ? rawType : "major" });
    } else {
      parsed.push(known);
    }
  }
  if (isProduct) {
    const fb = (Array.isArray(fallback) ? fallback : []).map((p) => ({
      name: p.name, smiles: p.smiles,
      type: ["major","minor","possible"].includes(p.type) ? p.type : "major",
    }));
    return mergeUniqueStructures(parsed, fb).map((p) => ({ name: p.name, smiles: p.smiles, type: p.type || "major" }));
  }
  return mergeUniqueStructures(parsed, fallback);
}

function sanitizeMechanismSteps(input, fallback) {
  const chosen = (Array.isArray(input) && input.length > 0) ? input : (Array.isArray(fallback) ? fallback : []);
  return chosen
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => ({
      step:       Number.isFinite(Number(item.step)) ? Number(item.step) : idx + 1,
      title:      typeof item.title === "string" && item.title.trim() ? item.title.trim() : `Step ${idx + 1}`,
      desc:       typeof item.desc  === "string" && item.desc.trim()  ? item.desc.trim()  :
                  typeof item.description === "string"                 ? item.description.trim() : "",
      structures: sanitizeMoleculeArray(item.structures, []),
    }));
}

function safeParseJsonObject(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try { return JSON.parse(stripped); } catch (_) {}
  const start = stripped.indexOf("{"), end = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

function extractAllowedCanonicalsFromQuestion(question) {
  const allowed = new Set();
  for (const [name, info] of Object.entries(smilesMap)) {
    const aliases = Array.isArray(info.aliases) ? info.aliases : [name];
    if (aliases.some((a) => aliasInText(a, question))) allowed.add(name);
  }
  return allowed;
}

function sanitizeDiagramByQuestion(diagram, question, answer) {
  const allowedQ   = extractAllowedCanonicalsFromQuestion(question);
  const inferred   = inferReagentPresets(question, answer);
  const inferredNm = new Set(inferred.map((x) => x.name));

  diagram.reactants = (diagram.reactants || []).filter((m) => m && m.name && allowedQ.has(m.name));
  diagram.reagents  = mergeUniqueStructures(
    (diagram.reagents || []).filter((m) => m && m.name && (allowedQ.has(m.name) || inferredNm.has(m.name))),
    inferred
  );
  if (!String(diagram.conditions || "").trim()) {
    diagram.conditions = inferConditions(`${question}\n${answer}`);
  }
  const reactantNames = new Set((diagram.reactants || []).map((m) => m.name));
  diagram.products = (diagram.products || []).filter((p) => p && p.name && !reactantNames.has(p.name));
  return diagram;
}

function applyOzonolysisOverrides(question, diagram) {
  const q = String(question || "").toLowerCase();
  if (!q.includes("ozone") && !q.includes("o3") && !q.includes("ozonolysis")) return diagram;
  const reductive = /zn|zinc|h2o|water|reductive/.test(q);
  if ((q.includes("ethene") || q.includes("ethylene")) && reductive) {
    diagram.products = [{ name: "methanal", smiles: "C=O", type: "major" }];
  } else if (q.includes("propene") && reductive) {
    diagram.products = [
      { name: "methanal", smiles: "C=O",  type: "major" },
      { name: "ethanal",  smiles: "CC=O", type: "major" },
    ];
  }
  return diagram;
}

function enrichAnswerIfTooShort(answer, question, context) {
  const a = String(answer || "").trim();
  if (a.length >= 200) return a;
  const extra = String(context || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 20 && !/^---\s*অংশ/i.test(l))
    .slice(0, 2)
    .join(" ");
  return extra ? `${a}\n\n(প্রসঙ্গ থেকে) ${extra}` : a;
}

function syncNarrativeWithDiagram(question, response) {
  const products    = response && response.diagram && response.diagram.products ? response.diagram.products : [];
  const pNames      = new Set(products.map((p) => String(p.name || "").toLowerCase()));
  const hasMethanal = pNames.has("methanal") || pNames.has("formaldehyde");
  const hasEthanal  = pNames.has("ethanal")  || pNames.has("acetaldehyde");

  if (hasMethanal && !hasEthanal && typeof response.answer === "string") {
    response.answer = response.answer
      .replace(/\bacetaldehyde\b/gi, "methanal (formaldehyde)")
      .replace(/\bethanal\b/gi,      "methanal (formaldehyde)")
      .replace(/\bCH3CHO\b/g,        "HCHO");
  }

  const q = String(question || "").toLowerCase();
  if ((q.includes("h2o") || q.includes("water")) && response.diagram) {
    const r = response.diagram.reagents || [];
    if (!r.some((x) => x.name === "water") && smilesMap.water && smilesMap.water.smiles) {
      r.push({ name: "water", smiles: smilesMap.water.smiles });
      response.diagram.reagents = r;
    }
  }
  return response;
}


// ═══════════════════════════════════════════════════════════════════
// RESPONSE BUILDERS
// ═══════════════════════════════════════════════════════════════════

// ── Chemistry ──────────────────────────────────────────────────────
function buildChemistryJsonResponse(modelText, context, contextUsed, question, isConversionHint) {
  const parsed      = safeParseJsonObject(modelText);

  // ── Determine is_conversion from LLM response OR our pre-classification hint
  // LLM has final say; our hint is the fallback.
  const llmIsConversion =
    parsed && typeof parsed.is_conversion === "boolean"
      ? parsed.is_conversion
      : (parsed && parsed.question_mode === "conversion") || Boolean(isConversionHint);

  const isConversion = llmIsConversion;

  // ── Build diagram (for conversion) or minimal structure (for description)
  const fallbackDiag  = isConversion
    ? buildChemDiagram(question, modelText)
    : { reactants: [], reagents: [], conditions: "", products: [] };

  const diagramInput  = (parsed && parsed.diagram && typeof parsed.diagram === "object") ? parsed.diagram : {};

  const diagram = {
    reactants:  sanitizeMoleculeArray(diagramInput.reactants, fallbackDiag.reactants),
    reagents:   sanitizeMoleculeArray(diagramInput.reagents,  fallbackDiag.reagents),
    conditions: String(diagramInput.conditions || fallbackDiag.conditions || ""),
    products:   sanitizeMoleculeArray(diagramInput.products,  fallbackDiag.products, true),
  };

  // Only sanitize by question context for conversion questions
  const processedDiag = isConversion
    ? applyOzonolysisOverrides(question, sanitizeDiagramByQuestion(diagram, question, modelText))
    : diagram;

  // ── mechanism_steps: ONLY for conversion; always [] for description
  const mechanism_steps = isConversion
    ? sanitizeMechanismSteps(
        parsed ? parsed.mechanism_steps : null,
        buildMechanismSteps(modelText, context, processedDiag)
      )
    : [];

  // ── equations: plain-text equations array (mainly for description)
  const equations = (parsed && Array.isArray(parsed.equations) ? parsed.equations : [])
    .filter((e) => typeof e === "string" && e.trim())
    .slice(0, 5);

  const rawAnswer =
    parsed && typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() :
    typeof modelText === "string" && modelText.trim()                    ? modelText.trim()      :
    "উত্তর পাওয়া যায়নি।";

  const answer         = enrichAnswerIfTooShort(rawAnswer, question, context);
  const diagram_caption =
    parsed && typeof parsed.diagram_caption === "string" && parsed.diagram_caption.trim()
      ? parsed.diagram_caption.trim()
      : processedDiag.products && processedDiag.products.length
        ? "Skeletal reaction diagram (SMILES)."
        : "";

  const key_points = (parsed && Array.isArray(parsed.key_points) ? parsed.key_points : [])
    .filter((k) => typeof k === "string" && k.trim())
    .slice(0, 4);

  let out = {
    // ── NEW fields for frontend ──────────────────────────────────
    is_conversion:    isConversion,          // boolean — use this on frontend to decide UI mode
    question_mode:    isConversion ? "conversion" : "description",

    // ── Core answer ──────────────────────────────────────────────
    answer,
    reaction_type:   parsed ? (parsed.reaction_type   || null) : null,
    substrate_class: parsed ? (parsed.substrate_class || null) : null,
    carbon_change:   parsed ? (parsed.carbon_change   || null) : null,

    // ── Diagram (conversion: full; description: structure only if needed) ──
    diagram:          processedDiag,
    diagram_caption,

    // ── Mechanism (conversion only; [] for description) ──────────
    mechanism_steps,

    // ── Equations (description mainly; can also appear in conversion) ──
    equations,        // NEW — plain text equations like "C6H6 + HNO3 → C6H5NO2 + H2O"

    // ── HSC tips ─────────────────────────────────────────────────
    key_points,

    // ── Resonance (only if question asks for it) ──────────────────
    resonance:        buildResonanceBlock(question),

    // ── Meta ─────────────────────────────────────────────────────
    detected_language: detectLanguage(question),
    contextUsed:       Boolean(contextUsed),
    subject:  "chemistry",
    category: "chemistry",
  };

  return syncNarrativeWithDiagram(question, out);
}

// ── Mathematics ────────────────────────────────────────────────────
function buildMathJsonResponse(modelText, contextUsed, subject, category) {
  const parsed = safeParseJsonObject(modelText);

  const answer =
    parsed && typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() :
    typeof modelText === "string" && modelText.trim()                    ? modelText.trim()      :
    "উত্তর পাওয়া যায়নি।";

  const steps = (parsed && Array.isArray(parsed.steps) ? parsed.steps : [])
    .filter((s) => s && s.step !== undefined)
    .map((s, i) => ({
      step:   Number.isFinite(Number(s.step)) ? Number(s.step) : i + 1,
      title:  String(s.title  || `ধাপ ${i + 1}`),
      work:   String(s.work   || ""),
      result: String(s.result || ""),
    }));

  const key_points = (parsed && Array.isArray(parsed.key_points) ? parsed.key_points : [])
    .filter((k) => typeof k === "string" && k.trim())
    .slice(0, 4);

  return {
    answer,
    topic:             parsed ? (parsed.topic        || null) : null,
    method:            parsed ? (parsed.method       || null) : null,
    steps,
    final_answer:      parsed ? (parsed.final_answer || null) : null,
    graph_hint:        parsed ? (parsed.graph_hint   || null) : null,
    key_points,
    detected_language: detectLanguage(answer),
    contextUsed:       Boolean(contextUsed),
    subject:           normalizeSlug(subject)  || "math",
    category:          normalizeSlug(category) || "math",
  };
}

// ── Physics ────────────────────────────────────────────────────────
function buildPhysicsJsonResponse(modelText, contextUsed, subject, category) {
  const parsed = safeParseJsonObject(modelText);

  const answer =
    parsed && typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() :
    typeof modelText === "string" && modelText.trim()                    ? modelText.trim()      :
    "উত্তর পাওয়া যায়নি।";

  const given = (parsed && Array.isArray(parsed.given) ? parsed.given : [])
    .filter((g) => g && typeof g.symbol === "string")
    .map((g) => ({
      symbol:      String(g.symbol      || ""),
      value:       String(g.value       || ""),
      unit:        String(g.unit        || ""),
      description: String(g.description || ""),
    }));

  const steps = (parsed && Array.isArray(parsed.steps) ? parsed.steps : [])
    .filter((s) => s && s.step !== undefined)
    .map((s, i) => ({
      step:   Number.isFinite(Number(s.step)) ? Number(s.step) : i + 1,
      title:  String(s.title  || `ধাপ ${i + 1}`),
      work:   String(s.work   || ""),
      result: String(s.result || ""),
    }));

  const key_points = (parsed && Array.isArray(parsed.key_points) ? parsed.key_points : [])
    .filter((k) => typeof k === "string" && k.trim())
    .slice(0, 4);

  return {
    answer,
    topic:             parsed ? (parsed.topic            || null) : null,
    law_or_principle:  parsed ? (parsed.law_or_principle || null) : null,
    given,
    formula:           parsed ? (parsed.formula          || null) : null,
    steps,
    final_answer:      parsed ? (parsed.final_answer     || null) : null,
    diagram_hint:      parsed ? (parsed.diagram_hint     || null) : null,
    key_points,
    detected_language: detectLanguage(answer),
    contextUsed:       Boolean(contextUsed),
    subject:           normalizeSlug(subject)  || "physics",
    category:          normalizeSlug(category) || "physics",
  };
}


// ═══════════════════════════════════════════════════════════════════
// LLM PROVIDER LAYER — Groq first, OpenRouter fallback
// ═══════════════════════════════════════════════════════════════════
async function callGroqWithFallback(input) {
  const apiKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) throw new Error("GROQ_API_KEY missing");
  const messages = Array.isArray(input) ? input : [{ role: "user", content: String(input) }];
  for (const model of GROQ_MODEL_FALLBACKS) {
    try {
      console.log(`[Groq] Trying: ${model}`);
      const res  = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 2000 }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data && data.error ? data.error.message : `HTTP ${res.status}`);
      console.log(`[Groq] OK: ${model}`);
      return data;
    } catch (err) {
      console.log(`[Groq] FAIL ${model}: ${err.message}`);
    }
  }
  throw new Error("All Groq models failed.");
}

async function callOpenRouterWithFallback(input) {
  const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");
  const messages = Array.isArray(input) ? input : [{ role: "user", content: String(input) }];
  for (const model of OPENROUTER_MODEL_FALLBACKS) {
    try {
      console.log(`[OpenRouter] Trying: ${model}`);
      const res  = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3001",
          "X-Title": "HSC AI Tutor",
        },
        body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 2000 }),
      });
      const data = await res.json();
      if (data.error) {
        const code = data.error.code || data.error.type;
        if (code === 404 || (data.error.message && data.error.message.includes("No endpoints"))) continue;
        throw new Error(data.error.message || JSON.stringify(data.error));
      }
      console.log(`[OpenRouter] OK: ${model}`);
      return data;
    } catch (err) {
      console.log(`[OpenRouter] FAIL ${model}: ${err.message}`);
    }
  }
  throw new Error("All OpenRouter models failed.");
}

async function callLlmWithProviderFallback(input) {
  if (String(process.env.GROQ_API_KEY || "").trim()) {
    try   { return await callGroqWithFallback(input); }
    catch (err) { console.log(`[LLM] Groq → OpenRouter: ${err.message}`); }
  } else {
    console.log("[LLM] No GROQ_API_KEY, using OpenRouter.");
  }
  return callOpenRouterWithFallback(input);
}


// ═══════════════════════════════════════════════════════════════════
// EMBEDDING + QDRANT
// ═══════════════════════════════════════════════════════════════════
async function embedOne(text) {
  const res = await ai.models.embedContent({ model: "gemini-embedding-001", contents: text });
  return res.embeddings[0].values;
}

async function getContext(question, subject, category) {
  const qvec           = await embedOne(question);
  const collectionName = resolveCollectionName(subject, category);
  const questionInfo   = detectQuestionType(question);
  const subjectSlug    = normalizeSlug(subject);
  const categorySlug   = normalizeSlug(category);

  const mustFilters = [];
  if (subjectSlug)  mustFilters.push({ key: "subject_slug",  match: { value: subjectSlug  } });
  if (categorySlug) mustFilters.push({ key: "category_slug", match: { value: categorySlug } });
  if (!subjectSlug && !categorySlug && questionInfo.isOrganic) {
    mustFilters.push({ key: "topic", match: { value: "Organic" } });
    console.log(`[Organic] keywords: ${questionInfo.keywords.join(", ")}`);
  }

  const trySearch = async (opts) => {
    try { return await qdrant.search(collectionName, opts); } catch { return []; }
  };

  let hits = await trySearch({
    vector: qvec, limit: 20, score_threshold: 0.3,
    ...(mustFilters.length ? { filter: { must: mustFilters } } : {}),
  });
  if (!hits.length) hits = await trySearch({
    vector: qvec, limit: 20,
    ...(mustFilters.length ? { filter: { must: mustFilters } } : {}),
  });
  if (!hits.length && mustFilters.length) hits = await trySearch({ vector: qvec, limit: 20 });

  console.log(`[Qdrant] collection=${collectionName}, hits=${hits.length}`);

  const examPattern = /^(ক\)|খ\)|গ\)|ঘ\)|অথবা|প্রশ্নঃ|সৃজনশীল)/;
  const filtered    = hits.filter((h) => !examPattern.test(((h.payload && h.payload.text ? h.payload.text : "").split("\n")[0] || "").trim()));
  const selected    = (filtered.length >= 4 ? filtered : hits).slice(0, 8);

  const contextText = selected.map((h, i) => {
    const score = h.score ? ` (relevance: ${(h.score * 100).toFixed(1)}%)` : "";
    return `--- অংশ ${i + 1}${score} ---\n${h.payload && h.payload.text ? h.payload.text : ""}`;
  }).join("\n\n");

  const contextChunks = selected.map((h, i) => ({
    id:            String(h.payload && h.payload.chunk_id   ? h.payload.chunk_id   : h.id || `chunk_${i + 1}`),
    type:          String(h.payload && h.payload.type       ? h.payload.type       : h.payload && h.payload.chunk_type ? h.payload.chunk_type : ""),
    topic:         String(h.payload && h.payload.topic      ? h.payload.topic      : h.payload && h.payload.category   ? h.payload.category   : ""),
    pattern:       String(h.payload && h.payload.pattern    ? h.payload.pattern    : ""),
    text:          String(h.payload && h.payload.text       ? h.payload.text       : ""),
    subject_slug:  String(h.payload && h.payload.subject_slug  ? h.payload.subject_slug  : ""),
    category_slug: String(h.payload && h.payload.category_slug ? h.payload.category_slug : ""),
  }));

  return { contextText, contextChunks, collectionName };
}


// ═══════════════════════════════════════════════════════════════════
// SUBJECT ROUTING
// ═══════════════════════════════════════════════════════════════════
function isChemistryRequest(subject, category) {
  const s = normalizeSlug(subject), c = normalizeSlug(category);
  return s.includes("chem") || c.includes("chem") || c === "organic" || c === "organic_chemistry";
}

function pickSubjectHandler(subject, category) {
  const s = normalizeSlug(subject), c = normalizeSlug(category);
  if (isChemistryRequest(subject, category))                                               return "chemistry";
  if (s.includes("math") || s.includes("mathematics") || c.includes("math"))              return "math";
  if (s.includes("physics") || s === "phy" || c.includes("physics") || c.includes("mechanics")) return "physics";
  return null;
}


// ═══════════════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════════════
function logFinalAiMessage(label, payload) {
  try {
    const a = payload && payload.answer;
    if (typeof a === "string" && a.trim()) console.log(`[AI Final][${label}] ${a.slice(0, 200)}`);
    else console.log(`[AI Final][${label}]`, JSON.stringify(payload).slice(0, 200));
  } catch (e) { console.log(`[AI Final][${label}] log error: ${e.message}`); }
}

function logFinalAiQuestion(label, question) {
  try { console.log(`[AI Question][${label}] ${String(question || "").slice(0, 200)}`); }
  catch (e) { console.log(`[AI Question][${label}] log error: ${e.message}`); }
}


// ═══════════════════════════════════════════════════════════════════
// QDRANT PAYLOAD INDEXES
// ═══════════════════════════════════════════════════════════════════
async function ensurePayloadIndexes() {
  try {
    for (const col of getConfiguredCollections()) {
      for (const field of PAYLOAD_INDEX_FIELDS) {
        try {
          await qdrant.createPayloadIndex(col, { wait: true, field_name: field, field_schema: "keyword" });
          console.log(`[Qdrant] Index created: '${field}' on '${col}'`);
        } catch (err) {
          if ((err.message && err.message.includes("already exists")) || err.status === 409) {
            console.log(`[Qdrant] Index exists: '${field}' on '${col}'`);
          } else {
            console.log(`[Qdrant] Index failed '${field}' on '${col}': ${err.message}`);
          }
        }
      }
    }
  } catch (err) { console.log(`[Qdrant] Index setup failed: ${err.message}`); }
}

ensurePayloadIndexes();


// ═══════════════════════════════════════════════════════════════════
// ██  MAIN ROUTE  POST /ask
// ═══════════════════════════════════════════════════════════════════
router.post("/ask", async (req, res) => {
  try {
    const { question, subject, category } = req.body;

    if (!question || question.trim().length < 3) {
      return res.status(400).json({ error: "প্রশ্ন দিতে হবে।" });
    }

    // ── Detect language and question mode BEFORE calling LLM ─────
    const lang               = detectLanguage(question);
    const { isConversion, questionMode } = classifyQuestionMode(question);

    console.log(`[RAG] lang=${lang} | mode=${questionMode} | is_conversion=${isConversion} | subject=${subject || "auto"}`);

    const { contextText: context, contextChunks, collectionName } = await getContext(question, subject, category);
    console.log(`[Qdrant] collection=${collectionName}`);

    const selectedSubject = pickSubjectHandler(subject, category);

    // ──────────────────────────────────────────────────────────────
    // CHEMISTRY
    // ──────────────────────────────────────────────────────────────
    if (selectedSubject === "chemistry") {
      logFinalAiQuestion("chemistry", question);

      // Pick the right system prompt based on conversion/description
      const CHEMISTRY_SYSTEM_PROMPT = buildChemistrySystemPrompt(isConversion);

      // Language instruction injected into user message
      const langInstruction =
        lang === "bangla"
          ? "প্রশ্নটি বাংলায়। answer, mechanism desc এবং key_points অবশ্যই বাংলায় লেখো। রসায়নের পরিভাষা ইংরেজিতে () এর ভেতর রাখো।"
          : lang === "mixed"
            ? "Question is mixed Bangla-English. Answer mainly in Bangla, chemistry terms in English in ()."
            : "Question is in English. Answer ENTIRELY in English. Do not use Bangla.";

      const modeNote =
        isConversion
          ? `This is a CONVERSION/REACTION question. question_mode = "conversion", is_conversion = true.`
          : `This is a DESCRIPTION/CONCEPT question. question_mode = "description", is_conversion = false. Do NOT include mechanism_steps.`;

      const chemPrompt = [
        { role: "system", content: CHEMISTRY_SYSTEM_PROMPT },
        {
          role: "user",
          content: `${langInstruction}
${modeNote}

পাঠ্যপুস্তকের প্রসঙ্গ (textbook context — use if helpful):
${context || "No context retrieved."}

শিক্ষার্থীর প্রশ্ন:
${question}

শুধুমাত্র valid JSON আউটপুট দাও।`,
        },
      ];

      try {
        const data = await callLlmWithProviderFallback(chemPrompt);
        if (data && data.error) return res.status(500).json({ error: "AI সার্ভিসে সমস্যা হয়েছে।" });
        const modelText = data && data.choices && data.choices[0] && data.choices[0].message
          ? data.choices[0].message.content : "";
        const result = buildChemistryJsonResponse(modelText, context, context.length > 0, question, isConversion);
        logFinalAiMessage("chemistry", result);
        return res.json(result);
      } catch (chemErr) {
        console.log(`[Chemistry] Direct prompt failed (${chemErr.message}), trying handleChemistryQuestion fallback`);
        const result = await handleChemistryQuestion({
          question,
          context,
          callLlmWithProviderFallback,
          CHEMISTRY_SYSTEM_PROMPT,
          buildChemistryJsonResponse: (modelText, ctx, ctxUsed, q) =>
            buildChemistryJsonResponse(modelText, ctx, ctxUsed, q, isConversion),
          buildResonanceBlock,
        });
        logFinalAiMessage("chemistry-fallback", result.body);
        return res.status(result.status).json(result.body);
      }
    }

    // ──────────────────────────────────────────────────────────────
    // MATHEMATICS
    // ──────────────────────────────────────────────────────────────
    if (selectedSubject === "math") {
      logFinalAiQuestion("math", question);

      const langInstruction =
        lang === "bangla"
          ? "শিক্ষার্থীর প্রশ্ন বাংলায়। answer, step titles এবং key_points সম্পূর্ণ বাংলায় লেখো। গাণিতিক প্রতীক স্ট্যান্ডার্ড নোটেশনে রাখো।"
          : lang === "mixed"
            ? "Question is mixed. Answer mainly in Bangla with math notation standard."
            : "Question is in English. Answer FULLY in English. Do not use Bangla.";

      const mathPrompt = [
        { role: "system", content: MATH_SYSTEM_PROMPT },
        {
          role: "user",
          content: `${langInstruction}

পাঠ্যপুস্তকের প্রসঙ্গ:
${context || "No context retrieved."}

শিক্ষার্থীর প্রশ্ন:
${question}

ধাপে ধাপে সমাধান দাও। শুধুমাত্র valid JSON আউটপুট দাও।`,
        },
      ];

      try {
        const data = await callLlmWithProviderFallback(mathPrompt);
        if (data && data.error) return res.status(500).json({ error: "AI সার্ভিসে সমস্যা হয়েছে।" });
        const modelText = data && data.choices && data.choices[0] && data.choices[0].message
          ? data.choices[0].message.content : "";
        const result = buildMathJsonResponse(modelText, context.length > 0, subject, category);
        logFinalAiMessage("math", result);
        return res.json(result);
      } catch (mathErr) {
        console.log(`[Math] Prompt failed (${mathErr.message}), trying handleMathQuestion`);
        const result = await handleMathQuestion({ question, subject, category, context, contextChunks, callLlmWithProviderFallback, normalizeSlug });
        logFinalAiMessage("math-fallback", result.body);
        return res.status(result.status).json(result.body);
      }
    }

    // ──────────────────────────────────────────────────────────────
    // PHYSICS
    // ──────────────────────────────────────────────────────────────
    if (selectedSubject === "physics") {
      logFinalAiQuestion("physics", question);

      const langInstruction =
        lang === "bangla"
          ? "শিক্ষার্থীর প্রশ্ন বাংলায়। answer, step titles এবং key_points সম্পূর্ণ বাংলায় লেখো। ভৌত প্রতীক ও সূত্র স্ট্যান্ডার্ড নোটেশনে রাখো।"
          : lang === "mixed"
            ? "Question is mixed. Answer mainly in Bangla, formulas standard."
            : "Question is in English. Answer FULLY in English. Do not use Bangla.";

      const physicsPrompt = [
        { role: "system", content: PHYSICS_SYSTEM_PROMPT },
        {
          role: "user",
          content: `${langInstruction}

পাঠ্যপুস্তকের প্রসঙ্গ:
${context || "No context retrieved."}

শিক্ষার্থীর প্রশ্ন:
${question}

প্রতিটি ধাপে একক (unit) দাও। শুধুমাত্র valid JSON আউটপুট দাও।`,
        },
      ];

      try {
        const data = await callLlmWithProviderFallback(physicsPrompt);
        if (data && data.error) return res.status(500).json({ error: "AI সার্ভিসে সমস্যা হয়েছে।" });
        const modelText = data && data.choices && data.choices[0] && data.choices[0].message
          ? data.choices[0].message.content : "";
        const result = buildPhysicsJsonResponse(modelText, context.length > 0, subject, category);
        logFinalAiMessage("physics", result);
        return res.json(result);
      } catch (physErr) {
        console.log(`[Physics] Prompt failed (${physErr.message}), trying handlePhysicsQuestion`);
        const result = await handlePhysicsQuestion({ question, subject, category, context, callLlmWithProviderFallback, normalizeSlug });
        logFinalAiMessage("physics-fallback", result.body);
        return res.status(result.status).json(result.body);
      }
    }

    // ──────────────────────────────────────────────────────────────
    // GENERIC (subject not matched)
    // ──────────────────────────────────────────────────────────────
    if (!context || context.length < 100) {
      return res.json({
        answer: lang === "bangla"
          ? "এই প্রশ্নের উত্তর বইয়ের তথ্য থেকে পাওয়া যায়নি। অনুগ্রহ করে বিষয় ও অধ্যায় উল্লেখ করে আবার জিজ্ঞেস করুন।"
          : "No relevant content found. Please specify the subject and chapter.",
        contextUsed:       false,
        detected_language: lang,
        subject:           normalizeSlug(subject)  || null,
        category:          normalizeSlug(category) || null,
      });
    }

    const langNote =
      lang === "bangla"
        ? "প্রশ্নটি বাংলায়। উত্তর বাংলায় দাও, গুরুত্বপূর্ণ পরিভাষা ইংরেজিতে () এর ভেতর দাও।"
        : lang === "mixed"
          ? "Answer mainly in Bangla with key terms in English in ()."
          : "Answer FULLY in English. Do not use Bangla.";

    const genericPrompt =
`You are an expert Bangladesh HSC academic tutor. ${langNote}

Rules:
1. Prioritize the retrieved context if relevant.
2. If not helpful, answer from general knowledge and say so.
3. Use equations, definitions, and examples as needed.
4. Keep answer 8–15 lines.
5. End with 2 HSC exam tips.

Retrieved Context:
${context}

Student Question: ${question}

Answer:`;

    logFinalAiQuestion("generic", question);
    const data = await callLlmWithProviderFallback(genericPrompt);
    if (data && data.error) return res.status(500).json({ error: "AI সার্ভিসে সমস্যা হয়েছে।" });

    const responseBody = {
      answer:            data && data.choices && data.choices[0] && data.choices[0].message
                           ? data.choices[0].message.content : "উত্তর পাওয়া যায়নি।",
      contextUsed:       context.length > 0,
      detected_language: lang,
      subject:           normalizeSlug(subject)  || null,
      category:          normalizeSlug(category) || null,
    };
    logFinalAiMessage("generic", responseBody);
    res.json(responseBody);

  } catch (e) {
    console.error("[RAG Error]", e);
    res.status(500).json({ error: "RAG failed", details: e.message });
  }
});

module.exports = router;