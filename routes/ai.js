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
const PAYLOAD_INDEX_FIELDS    = ["topic", "subject_slug", "category_slug"];
const DEFAULT_COLLECTION_NAME  = process.env.QDRANT_COLLECTION || "hsc_chem_2nd_paper";

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
// ██  SYSTEM PROMPTS  — one per subject, all bilingual-aware
// ═══════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────
// CHEMISTRY — fixes wrong SMILES, weak answers, missing mechanisms
// ───────────────────────────────────────────────────────────────────
const CHEMISTRY_SYSTEM_PROMPT = `You are an expert Bangladesh HSC Chemistry tutor (1st and 2nd Paper).
You specialize in Organic Chemistry, Physical Chemistry, and Inorganic Chemistry at HSC level.

━━━ LANGUAGE RULE ━━━━━━━━━━━━━━━━━━━━━━━━━
Detect the student language from their question.
  Bangla question  → write "answer", step desc, key_points fully in BANGLA.
                     Keep chemistry terms in English in parentheses when needed.
                     Example: "বেনজিন (benzene) একটি সুগন্ধি যৌগ।"
  English question → write everything in ENGLISH.
  Mixed question   → prefer BANGLA, chemistry terms in English in ().
All JSON keys, SMILES strings, and field names stay in English regardless.

━━━ INTERNAL REASONING (do silently before answering) ━━━━━━━━━━━━━
STEP 1 — Classify reaction_type:
  conversion_reaction | aromatic_substitution | addition_reaction |
  elimination_reaction | oxidation_reduction | rearrangement |
  resonance_concept | acid_base | conceptual_theory | unknown

STEP 2 — Identify substrate_class:
  aromatic | aliphatic | alkene | alkyne | alcohol | acid |
  aldehyde | ketone | ester | amine | halide | unknown

STEP 3 — Track carbon_change (count carbons in reactant vs product):
  carbon_increase  → Grignard, CN to COOH, Friedel-Crafts alkylation
  carbon_decrease  → decarboxylation, ozonolysis, oxidative cleavage
  carbon_same      → substitution, addition, functional group conversion

STEP 4 — Decide mechanism necessity:
  Include mechanism_steps ONLY when reaction_type is:
    conversion_reaction OR aromatic_substitution OR addition_reaction
  Otherwise set: mechanism_steps = []

STEP 5 — Write student answer (8 to 14 lines):
  State WHAT reaction occurs.
  Explain WHY it occurs (electronic reason if possible).
  Explain the role of each REAGENT.
  Mention CONDITIONS (temperature, catalyst, pressure).
  Name the FINAL PRODUCT clearly.
  If Markovnikov or anti-Markovnikov rule applies, state it.
  If ortho/para or meta directing, explain why.
  If carbon count changes, explicitly say so and explain why.

STEP 6 — Build SMILES diagram:
  reactants: ONLY molecules explicitly named in the student question.
  reagents:  ONLY reagents clearly mentioned OR standard for this reaction type.
  products:  ONLY what this specific reaction actually produces.
  NEVER add molecules not in the question or not standard to the reaction.
  NEVER guess SMILES. If not 100% sure, set smiles as empty string "".
  NEVER reuse a reactant as a product.

VERIFIED SMILES REFERENCE — use exactly these strings, nothing else:
  benzene          → c1ccccc1
  toluene          → Cc1ccccc1
  phenol           → Oc1ccccc1
  aniline          → Nc1ccccc1
  nitrobenzene     → O=[N+]([O-])c1ccccc1
  chlorobenzene    → Clc1ccccc1
  bromobenzene     → Brc1ccccc1
  naphthalene      → c1ccc2ccccc2c1
  ethene           → C=C
  propene          → CC=C
  ethyne           → C#C
  methane          → C
  ethane           → CC
  propane          → CCC
  ethanol          → CCO
  methanol         → CO
  acetic acid      → CC(=O)O
  methanal HCHO    → C=O
  ethanal CH3CHO   → CC=O
  acetone          → CC(C)=O
  HCl              → Cl
  HBr              → Br
  Br2              → BrBr
  Cl2              → ClCl
  H2SO4            → OS(=O)(=O)O
  HNO3             → O[N+](=O)[O-]
  NaOH             → [Na+].[OH-]
  H2O              → O
  CO2              → O=C=O
  NH3              → N
  O3 ozone         → [O-][O+]=O
  If molecule is NOT in this list and you are unsure, use smiles: ""

━━━ OUTPUT — VALID JSON ONLY, NO MARKDOWN FENCES ━━━━━━━━━━━━━━━━━
{
  "reaction_type": "",
  "substrate_class": "",
  "carbon_change": "carbon_same or carbon_increase or carbon_decrease or unknown",
  "answer": "8 to 14 line explanation in detected language (Bangla or English)",
  "diagram": {
    "reactants": [{ "name": "", "smiles": "" }],
    "reagents":  [{ "name": "", "smiles": "" }],
    "conditions": "e.g. conc. H2SO4, heat, UV/light, AlCl3",
    "products":  [{ "name": "", "smiles": "", "type": "major or minor or possible" }]
  },
  "diagram_caption": "One sentence describing what reaction is shown.",
  "mechanism_steps": [
    {
      "step": 1,
      "title": "Short step title",
      "desc": "2 to 3 sentences in detected language",
      "structures": [{ "name": "", "smiles": "" }]
    }
  ],
  "key_points": [
    "HSC exam tip 1 (in detected language)",
    "HSC exam tip 2 (in detected language)",
    "Common mistake to avoid"
  ],
  "resonance": null,
  "contextUsed": false,
  "subject": "chemistry",
  "category": "chemistry"
}

HARD RULES:
1. Return ONLY valid JSON. No text before or after. No markdown fences.
2. "answer" must be a real paragraph, never a bullet list.
3. Reactants come ONLY from the student question, not from training examples.
4. If product is uncertain, set products: []
5. key_points must have exactly 3 items directly about this question.
6. If SMILES is unknown, use "" not a guessed string.`;


// ───────────────────────────────────────────────────────────────────
// MATHEMATICS — fixes unclear steps, missing algebra, wrong answers
// ───────────────────────────────────────────────────────────────────
const MATH_SYSTEM_PROMPT = `You are an expert Bangladesh HSC Mathematics tutor (1st and 2nd Paper).

Topics you master:
  Algebra: polynomials, equations, inequalities, series, binomial theorem, matrices, determinants
  Trigonometry: identities, inverse trig, general solutions, height and distance
  Calculus: limits, differentiation, integration, applications
  Coordinate Geometry: lines, circles, parabola, ellipse, hyperbola
  Vectors: 2D and 3D, dot product, cross product
  Probability and Statistics: permutation, combination, probability, mean, variance
  Complex Numbers

━━━ LANGUAGE RULE ━━━━━━━━━━━━━━━━━━━━━━━━━
  Bangla question  → write "answer", step titles, key_points fully in BANGLA.
                     Keep mathematical notation standard (integral, derivative, sin theta etc).
  English question → write everything in ENGLISH.
  Mixed question   → prefer BANGLA, math notation stays standard.
  Example Bangla opening: "প্রথমে আমরা সূত্রটি লিখি: f'(x) = lim(h to 0) [f(x+h) - f(x)] / h"

━━━ SOLVING RULES — never skip any rule ━━━━━━━━━━━━━━━━━━━━━━━
1.  Identify the topic and method BEFORE solving.
2.  State the formula or theorem you will use, then apply it.
3.  Show EVERY algebraic manipulation. Never skip steps.
4.  If question has sub-parts (ka, kha, ga, gha or a, b, c):
    Answer EACH part separately with its label as a heading.
5.  For proofs: clearly separate LHS and RHS and work on each side.
6.  For integration: always write the integral symbol and dx or dt.
7.  For differentiation: write d/dx notation clearly.
8.  For matrix problems: write matrices in bracket notation.
9.  For word problems: define each variable before using it.
10. State the FINAL ANSWER on its own clearly labelled line.
11. After solution: add 2 to 3 HSC exam tips for this topic.
12. steps array must have at MINIMUM 3 entries for any problem.

━━━ OUTPUT — VALID JSON ONLY, NO MARKDOWN ━━━━━━━━━━━━━━━━━━━━
{
  "topic": "e.g. Integration by substitution or Trigonometric identity or Matrix inverse",
  "method": "e.g. u-substitution or LHS=RHS proof or Row reduction",
  "answer": "Complete readable solution as one string. Use newline characters between steps. Format: Step 1 label then work then result then Step 2 label etc. End with: Final Answer: result",
  "steps": [
    {
      "step": 1,
      "title": "Step title in detected language",
      "work": "Mathematical work shown here using plain text math like x^2 or sqrt(x)",
      "result": "Result after this step"
    }
  ],
  "final_answer": "Single clean final answer e.g. x = 3 or integral = x squared over 2 plus C or Proved LHS equals RHS",
  "graph_hint": "Optional one sentence about what the graph looks like or null",
  "key_points": [
    "HSC tip 1 specific to this problem type in detected language",
    "HSC tip 2 specific to this problem type",
    "Common mistake students make in this topic"
  ],
  "contextUsed": false,
  "subject": "math",
  "category": "math"
}

HARD RULES:
1. Return ONLY valid JSON. No preamble, no markdown, no trailing text.
2. "answer" must contain the FULL solution with all steps as newline-separated text.
3. "steps" array must mirror "answer". Never skip an algebraic step.
4. If question is a proof, final_answer = "Proved — LHS = RHS".
5. Never fabricate formulas. If genuinely uncertain, say so in the answer field.`;


// ───────────────────────────────────────────────────────────────────
// PHYSICS — fixes missing units, no formula shown, vague answers
// ───────────────────────────────────────────────────────────────────
const PHYSICS_SYSTEM_PROMPT = `You are an expert Bangladesh HSC Physics tutor (1st and 2nd Paper).

Topics you master:
  Mechanics: Newton's laws, work-energy, momentum, rotation, gravitation
  Circular Motion and SHM: period, frequency, amplitude, restoring force
  Waves and Sound: types, interference, Doppler effect, resonance
  Optics: reflection, refraction, lenses, mirrors, wave optics, diffraction
  Heat and Thermodynamics: gas laws, first and second law, Carnot cycle
  Electrostatics: Coulomb's law, electric field, potential, capacitance
  Current Electricity: Ohm's law, Kirchhoff's laws, circuits, power
  Magnetism and EM Induction: Faraday's law, Lenz's law, transformers
  Modern Physics: photoelectric effect, Bohr model, nuclear reactions, radioactivity

━━━ LANGUAGE RULE ━━━━━━━━━━━━━━━━━━━━━━━━━
  Bangla question  → write "answer", step titles, key_points fully in BANGLA.
                     Physical symbols and formulas stay in standard notation (F, m, a, v etc).
  English question → write everything in ENGLISH.
  Mixed question   → prefer BANGLA, formulas stay standard.
  Example Bangla opening: "নিউটনের দ্বিতীয় সূত্র থেকে জানি: F = ma"

━━━ SOLVING RULES — never skip any rule ━━━━━━━━━━━━━━━━━━━━━━━
1.  State the relevant LAW or PRINCIPLE first in one sentence.
2.  List ALL given data with SI units in the "given" array.
3.  Write the FORMULA before substituting any values.
4.  Show the UNIT at every single calculation step. Never drop units.
5.  State the FINAL ANSWER with value, correct SI unit, and direction if vector.
6.  If question has sub-parts (ka, kha, ga, gha or a, b, c):
    Answer EACH part separately with its label.
7.  For derivations: start from first principles, show every mathematical step.
8.  For conceptual questions with no numbers: explain physical meaning in 5 to 9 sentences.
    Mention what quantity changes, why, what effect it has, and a real-world example.
9.  For graph questions: describe what is on each axis and what the shape means.
10. Always specify direction for vector quantities.
11. After solution: add 2 to 3 HSC exam tips for this topic.
12. steps array must have at MINIMUM 3 entries for any numerical problem.

SI UNITS REMINDER:
  Force N, Pressure Pa, Energy J, Power W
  Charge C, Voltage V, Resistance Ohm
  Magnetic field T, Frequency Hz, Wavelength m

━━━ OUTPUT — VALID JSON ONLY, NO MARKDOWN ━━━━━━━━━━━━━━━━━━━━
{
  "topic": "e.g. Projectile Motion or Lens Formula or RC Circuit or Radioactive Decay",
  "law_or_principle": "One sentence naming the law or principle used",
  "given": [
    { "symbol": "m",  "value": "5",  "unit": "kg",  "description": "mass of the object" },
    { "symbol": "v0", "value": "20", "unit": "m/s", "description": "initial velocity"   }
  ],
  "formula": "Write the main formula used, e.g. v squared = u squared + 2as",
  "answer": "Complete solution as one readable string with newlines between steps. Format: Given data then Formula then Step 1 then Step 2 then Final Answer with unit and direction",
  "steps": [
    {
      "step": 1,
      "title": "Step title in detected language",
      "work": "Calculation shown e.g. F = ma = 5 times 2",
      "result": "F = 10 N"
    }
  ],
  "final_answer": "10 N downward — always include value plus unit plus direction if vector",
  "diagram_hint": "Describe a free-body or ray or circuit diagram if helpful or null",
  "key_points": [
    "HSC exam tip 1 specific to this topic in detected language",
    "HSC exam tip 2 specific to this topic",
    "Common unit mistake or conceptual error to avoid"
  ],
  "contextUsed": false,
  "subject": "physics",
  "category": "physics"
}

HARD RULES:
1. Return ONLY valid JSON. No preamble, no markdown fences.
2. NEVER omit units in "given", "steps", or "final_answer".
3. NEVER invent numerical values not given in the question.
4. "steps" must mirror "answer". Every step must appear in both.
5. For purely conceptual questions: given = [], final_answer = "See explanation above".`;


// ═══════════════════════════════════════════════════════════════════
// LANGUAGE DETECTOR
// Detects whether the question is Bangla, English, or mixed
// ═══════════════════════════════════════════════════════════════════
function detectLanguage(text) {
  if (!text) return "english";
  const banglaChars = (text.match(/[\u0980-\u09FF]/g) || []).length;
  const totalChars  = text.replace(/\s/g, "").length || 1;
  const ratio = banglaChars / totalChars;
  if (ratio > 0.15) return "bangla";
  if (ratio > 0.05) return "mixed";
  return "english";
}


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
    { regex: /conc\.?\s*h2so4|concentrated\s+sulfuric/i,  label: "conc. H2SO4"  },
    { regex: /conc\.?\s*hno3|concentrated\s+nitric/i,      label: "conc. HNO3"   },
    { regex: /heat|\b\u0394\b|high\s+temp/i,                label: "heat"          },
    { regex: /uv|hv|\blight\b/i,                            label: "UV/light"      },
    { regex: /\bcatalyst\b|cat\./i,                         label: "catalyst"      },
    { regex: /acidic|acid\s+medium/i,                       label: "acid medium"   },
    { regex: /basic|alkaline|base\s+medium/i,               label: "base medium"   },
    { regex: /\bpressure\b|atm/i,                           label: "pressure"      },
    { regex: /\bo3\b|ozone/i,                               label: "O3"            },
    { regex: /\bzn\b|zinc/i,                                label: "Zn"            },
    { regex: /\bh2o\b|\bwater\b/i,                          label: "H2O"           },
    { regex: /\bh2o2\b|hydrogen\s+peroxide/i,               label: "H2O2"          },
    { regex: /\bdms\b|dimethyl\s+sulfide/i,                 label: "DMS"           },
    { regex: /\balcl3\b/i,                                  label: "AlCl3"         },
    { regex: /\bfebr3\b/i,                                  label: "FeBr3"         },
    { regex: /\bfecl3\b/i,                                  label: "FeCl3"         },
    { regex: /\bni\b|nickel/i,                              label: "Ni catalyst"   },
    { regex: /\bpt\b|platinum/i,                            label: "Pt catalyst"   },
    { regex: /\bpd\b|palladium/i,                           label: "Pd catalyst"   },
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
      { step: 1, type: "pi_shift", desc: "All three pi-bonds shift one position around the ring, giving the two equivalent Kekule forms." },
    ],
    note: "HSC: Benzene is a resonance hybrid. Both Kekule forms contribute equally, making all C-C bonds identical (1.40 angstrom).",
  },
  toluene: {
    base:  { name: "toluene", smiles: "Cc1ccccc1" },
    forms: [
      { name: "toluene (aromatic)", smiles: "Cc1ccccc1"    },
      { name: "toluene (Kekule)",   smiles: "CC1=CC=CC=C1" },
    ],
    arrow_steps: [
      { step: 1, type: "pi_shift", desc: "Same benzene ring pi-bond resonance; the CH3 group stays attached and activates the ring via +I effect." },
    ],
    note: "HSC: Toluene shows benzene ring resonance. CH3 is +I and o/p-directing in EAS reactions.",
  },
  phenol: {
    base:  { name: "phenol", smiles: "Oc1ccccc1" },
    forms: [
      { name: "phenol (aromatic)", smiles: "Oc1ccccc1"    },
      { name: "phenol (Kekule)",   smiles: "OC1=CC=CC=C1" },
    ],
    arrow_steps: [
      { step: 1, type: "pi_shift",        desc: "Normal benzene ring pi-bond shifting." },
      { step: 2, type: "lone_pair_to_pi", desc: "Oxygen lone pair donates into ring, giving extra electron density at ortho and para positions." },
    ],
    note: "HSC: -OH is strongly activating by +M resonance effect, directing EAS to ortho/para positions.",
  },
  aniline: {
    base:  { name: "aniline", smiles: "Nc1ccccc1" },
    forms: [
      { name: "aniline (aromatic)", smiles: "Nc1ccccc1"    },
      { name: "aniline (Kekule)",   smiles: "NC1=CC=CC=C1" },
    ],
    arrow_steps: [
      { step: 1, type: "pi_shift",        desc: "Normal benzene ring pi-bond shifting." },
      { step: 2, type: "lone_pair_to_pi", desc: "NH2 nitrogen lone pair delocalizes into ring, making ortho and para positions very electron-rich." },
    ],
    note: "HSC: -NH2 is the strongest activating group by +M effect. Lone pair resonance explains ortho/para selectivity in EAS.",
  },
};

function isResonanceRequest(q) {
  const s = String(q || "").toLowerCase();
  return s.includes("resonance") || s.includes("delocal") ||
         s.includes("resonance structure") ||
         s.includes("\u09B0\u09C7\u099C\u09CB\u09A8\u09CD\u09AF\u09BE\u09A8\u09CD\u09B8") ||
         s.includes("\u09B0\u09C7\u09B8\u09CB\u09A8\u09CD\u09AF\u09BE\u09A8\u09CD\u09B8");
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
// ═══════════════════════════════════════════════════════════════════
function buildChemDiagram(question, answer) {
  const src        = `${question || ""}\n${answer || ""}`;
  const answerText = String(answer || "");
  const productCue = /(product|products|forms?|formed|gives?|yields?|produces?|obtained|\u09C1\u09CE\u09AA\u09A8\u09CD\u09A8|\u09AA\u09A3\u09CD\u09AF|\u09A4\u09C8\u09B0\u09BF)/i;

  const reactants = [], reagents = [], products = [];
  const seenR = new Set(), seenRg = new Set(), seenP = new Set();

  for (const [name, info] of Object.entries(smilesMap)) {
    if (!info.smiles) continue;
    const aliases = Array.isArray(info.aliases) ? info.aliases : [name];
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

  if (t.includes("nitration") || t.includes("nitro"))         { push("nitric_acid"); push("sulfuric_acid"); return inferred; }
  if (t.includes("bromination") || /\bbr2\b/i.test(t))       { push("bromine"); push("fe_br3"); return inferred; }
  if (t.includes("chlorination") || /\bcl2\b/i.test(t))      { push("chlorine"); push("fe_cl3"); return inferred; }
  if (t.includes("friedel") || t.includes("crafts"))         { push("alcl3"); return inferred; }
  if (t.includes("sulphonation") || t.includes("sulfonation")){ push("sulfuric_acid"); return inferred; }
  if (t.includes("ozonolysis") || /\bo3\b/.test(t)) {
    push("ozone");
    if (/\bzn\b|zinc/.test(t))    push("zinc");
    if (/\bh2o\b|water/.test(t))  push("water");
    if (t.includes("dms"))         push("dms");
    if (t.includes("h2o2"))        push("hydrogen_peroxide");
    return inferred;
  }
  return inferred;
}

function buildMechanismSteps(answer, context, diagram) {
  const t = `${context || ""}\n${answer || ""}`.toLowerCase();
  const steps = [];
  const prodStructs = (diagram.products || []).map((p) => ({ name: p.name, smiles: p.smiles }));

  if (t.includes("nitration")) {
    steps.push({ step: 1, title: "Electrophile formation",           desc: "Mixed acid (HNO3 + H2SO4) generates the nitronium ion NO2+, the active electrophile.", structures: diagram.reagents });
    steps.push({ step: 2, title: "Sigma complex (arenium ion)",      desc: "The aromatic ring attacks NO2+, forming an arenium (sigma) complex. Aromaticity is temporarily lost.", structures: diagram.reactants });
    steps.push({ step: 3, title: "Deprotonation / aromaticity restored", desc: "HSO4- removes H+ from the ring, restoring aromaticity and giving the nitro product.", structures: prodStructs });
    return steps;
  }
  if (t.includes("friedel") || t.includes("crafts") || t.includes("alkylation")) {
    steps.push({ step: 1, title: "Electrophile generation",  desc: "AlCl3 (Lewis acid) accepts chloride from the alkyl halide, generating a carbocation-like electrophile.", structures: diagram.reagents });
    steps.push({ step: 2, title: "Electrophilic attack",     desc: "Benzene ring attacks the electrophile, forming a sigma complex.", structures: diagram.reactants });
    steps.push({ step: 3, title: "Deprotonation",            desc: "AlCl4- removes H+, restoring aromaticity and giving the alkylbenzene product.", structures: prodStructs });
    return steps;
  }
  if (t.includes("bromination") || t.includes("chlorination") || /\bbr2\b|\bcl2\b/.test(t)) {
    steps.push({ step: 1, title: "Halogen activation",        desc: "Lewis acid (FeBr3/FeCl3) polarizes the halogen molecule, making one halogen delta+ (the electrophile).", structures: diagram.reagents });
    steps.push({ step: 2, title: "Sigma complex formation",   desc: "Aromatic ring attacks the delta+ halogen, forming a sigma complex (arenium ion).", structures: diagram.reactants });
    steps.push({ step: 3, title: "Aromaticity restoration",   desc: "Loss of H+ restores aromaticity, giving the halo-arene product.", structures: prodStructs });
    return steps;
  }
  if (t.includes("ozonolysis") || /\bo3\b/.test(t)) {
    steps.push({ step: 1, title: "Ozone addition",   desc: "O3 adds across the C=C pi bond in a [3+2] cycloaddition to form a molozonide, which rearranges to an ozonide.", structures: [...diagram.reactants, ...diagram.reagents.filter((m) => m.name === "ozone")] });
    steps.push({ step: 2, title: "Workup / cleavage", desc: "Reductive workup (Zn/H2O or DMS) cleaves the ozonide into two carbonyl fragments (aldehyde or ketone depending on substitution).", structures: prodStructs });
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
// Prevents hallucinated or invalid SMILES from reaching the frontend
// ═══════════════════════════════════════════════════════════════════

function isPlausibleSmiles(smiles) {
  if (!smiles || typeof smiles !== "string") return false;
  const s = smiles.trim();
  if (!s) return false;
  // Must contain at least one organic atom character
  if (!/[BCNOPSFIcnosp]/.test(s)) return false;
  // Balanced square brackets
  if ((s.match(/\[/g) || []).length !== (s.match(/\]/g) || []).length) return false;
  // Balanced parentheses
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
  const nameKey   = typeof item.name   === "string" ? item.name.trim().toLowerCase() : "";
  const smilesKey = typeof item.smiles === "string" ? item.smiles.trim()             : "";

  // Try known lookup first (most reliable)
  let canonical = "";
  if (nameKey   && aliasToCanonical.has(nameKey))   canonical = aliasToCanonical.get(nameKey);
  else if (smilesKey && smilesToCanonical.has(smilesKey)) canonical = smilesToCanonical.get(smilesKey);

  if (canonical && smilesMap[canonical] && smilesMap[canonical].smiles) {
    return { name: canonical, smiles: smilesMap[canonical].smiles };
  }

  // Accept LLM-supplied SMILES only if it passes plausibility check
  if (nameKey && isPlausibleSmiles(smilesKey)) {
    return { name: item.name.trim(), smiles: smilesKey };
  }

  return null; // reject bad entries
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
      parsed.push({ ...known, type: ["major", "minor", "possible"].includes(rawType) ? rawType : "major" });
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
                  typeof item.description === "string"                ? item.description.trim() : "",
      structures: sanitizeMoleculeArray(item.structures, []),
    }));
}

function safeParseJsonObject(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  // Strip accidental markdown fences from LLM output
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
// RESPONSE BUILDERS  — one per subject
// ═══════════════════════════════════════════════════════════════════

// ── Chemistry ──────────────────────────────────────────────────────
function buildChemistryJsonResponse(modelText, context, contextUsed, question) {
  const parsed       = safeParseJsonObject(modelText);
  const fallbackDiag = buildChemDiagram(question, modelText);
  const diagramInput = (parsed && parsed.diagram && typeof parsed.diagram === "object") ? parsed.diagram : {};

  const diagram = {
    reactants:  sanitizeMoleculeArray(diagramInput.reactants, fallbackDiag.reactants),
    reagents:   sanitizeMoleculeArray(diagramInput.reagents,  fallbackDiag.reagents),
    conditions: String(diagramInput.conditions || fallbackDiag.conditions || ""),
    products:   sanitizeMoleculeArray(diagramInput.products,  fallbackDiag.products, true),
  };

  const gated     = sanitizeDiagramByQuestion(diagram, question, modelText);
  const finalDiag = applyOzonolysisOverrides(question, gated);

  const mechanism_steps = sanitizeMechanismSteps(
    parsed ? parsed.mechanism_steps : null,
    buildMechanismSteps(modelText, context, finalDiag)
  );

  const rawAnswer =
    parsed && typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() :
    typeof modelText === "string" && modelText.trim()                    ? modelText.trim()      :
    "উত্তর পাওয়া যায়নি।";

  const answer         = enrichAnswerIfTooShort(rawAnswer, question, context);
  const diagram_caption=
    parsed && typeof parsed.diagram_caption === "string" && parsed.diagram_caption.trim()
      ? parsed.diagram_caption.trim()
      : finalDiag.products && finalDiag.products.length
        ? "Skeletal reaction diagram (SMILES)."
        : "Diagram not available.";

  const key_points = (parsed && Array.isArray(parsed.key_points) ? parsed.key_points : [])
    .filter((k) => typeof k === "string" && k.trim())
    .slice(0, 4);

  let out = {
    answer,
    diagram:          finalDiag,
    diagram_caption,
    mechanism_steps,
    key_points,
    resonance:        buildResonanceBlock(question),
    reaction_type:    parsed ? (parsed.reaction_type   || null) : null,
    substrate_class:  parsed ? (parsed.substrate_class || null) : null,
    carbon_change:    parsed ? (parsed.carbon_change   || null) : null,
    detected_language: detectLanguage(question),
    contextUsed:      Boolean(contextUsed),
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
        body: JSON.stringify({ model, messages, temperature: 0.25, max_tokens: 1800 }),
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
        body: JSON.stringify({ model, messages, temperature: 0.25, max_tokens: 1800 }),
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
    catch (err) { console.log(`[LLM] Groq failed, trying OpenRouter: ${err.message}`); }
  } else {
    console.log("[LLM] No GROQ_API_KEY found, using OpenRouter.");
  }
  return callOpenRouterWithFallback(input);
}


// ═══════════════════════════════════════════════════════════════════
// EMBEDDING + QDRANT CONTEXT RETRIEVAL
// ═══════════════════════════════════════════════════════════════════
async function embedOne(text) {
  const res = await ai.models.embedContent({ model: "gemini-embedding-001", contents: text });
  return res.embeddings[0].values;
}

async function getContext(question, subject, category) {
  const qvec          = await embedOne(question);
  const collectionName= resolveCollectionName(subject, category);
  const questionInfo  = detectQuestionType(question);
  const subjectSlug   = normalizeSlug(subject);
  const categorySlug  = normalizeSlug(category);

  const mustFilters = [];
  if (subjectSlug)  mustFilters.push({ key: "subject_slug",  match: { value: subjectSlug  } });
  if (categorySlug) mustFilters.push({ key: "category_slug", match: { value: categorySlug } });
  if (!subjectSlug && !categorySlug && questionInfo.isOrganic) {
    mustFilters.push({ key: "topic", match: { value: "Organic" } });
    console.log(`[Organic detected] keywords: ${questionInfo.keywords.join(", ")}`);
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
  if (isChemistryRequest(subject, category))                                              return "chemistry";
  if (s.includes("math") || s.includes("mathematics") || c.includes("math"))             return "math";
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

    const lang = detectLanguage(question);
    const { contextText: context, contextChunks, collectionName } = await getContext(question, subject, category);
    console.log(`[RAG] collection=${collectionName} | lang=${lang} | subject=${subject || "auto"}`);

    const selectedSubject = pickSubjectHandler(subject, category);

    // ─────────────────────────────────────────
    // CHEMISTRY
    // ─────────────────────────────────────────
    if (selectedSubject === "chemistry") {
      logFinalAiQuestion("chemistry", question);
      const result = await handleChemistryQuestion({
        question,
        context,
        callLlmWithProviderFallback,
        CHEMISTRY_SYSTEM_PROMPT,
        buildChemistryJsonResponse,
        buildResonanceBlock,
      });
      logFinalAiMessage("chemistry", result.body);
      return res.status(result.status).json(result.body);
    }

    // ─────────────────────────────────────────
    // MATHEMATICS
    // ─────────────────────────────────────────
    if (selectedSubject === "math") {
      logFinalAiQuestion("math", question);

      const langInstruction = lang === "bangla"
        ? "শিক্ষার্থীর প্রশ্ন বাংলায়। answer, step titles এবং key_points সম্পূর্ণ বাংলায় লেখো। গাণিতিক প্রতীক স্ট্যান্ডার্ড নোটেশনে রাখো।"
        : lang === "mixed"
          ? "Question is mixed Bangla-English. Answer mainly in Bangla with math notation standard."
          : "Question is in English. Answer fully in English.";

      const mathPrompt = [
        { role: "system", content: MATH_SYSTEM_PROMPT },
        {
          role: "user",
          content: `${langInstruction}

পাঠ্যপুস্তকের প্রসঙ্গ (use if helpful):
${context || "No context retrieved."}

শিক্ষার্থীর প্রশ্ন:
${question}

ধাপে ধাপে সমাধান দাও। শুধুমাত্র valid JSON আউটপুট দাও।`,
        },
      ];

      try {
        const data = await callLlmWithProviderFallback(mathPrompt);
        if (data.error) return res.status(500).json({ error: "AI সার্ভিসে সমস্যা হয়েছে।" });
        const result = buildMathJsonResponse(
          data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "",
          context.length > 0, subject, category
        );
        logFinalAiMessage("math", result);
        return res.json(result);
      } catch (mathErr) {
        console.log(`[Math] Direct prompt failed (${mathErr.message}), trying handleMathQuestion fallback`);
        const result = await handleMathQuestion({ question, subject, category, context, contextChunks, callLlmWithProviderFallback, normalizeSlug });
        logFinalAiMessage("math-fallback", result.body);
        return res.status(result.status).json(result.body);
      }
    }

    // ─────────────────────────────────────────
    // PHYSICS
    // ─────────────────────────────────────────
    if (selectedSubject === "physics") {
      logFinalAiQuestion("physics", question);

      const langInstruction = lang === "bangla"
        ? "শিক্ষার্থীর প্রশ্ন বাংলায়। answer, step titles এবং key_points সম্পূর্ণ বাংলায় লেখো। ভৌত প্রতীক ও সূত্র স্ট্যান্ডার্ড নোটেশনে রাখো।"
        : lang === "mixed"
          ? "Question is mixed. Answer mainly in Bangla with formulas in standard notation."
          : "Question is in English. Answer fully in English.";

      const physicsPrompt = [
        { role: "system", content: PHYSICS_SYSTEM_PROMPT },
        {
          role: "user",
          content: `${langInstruction}

পাঠ্যপুস্তকের প্রসঙ্গ (use if helpful):
${context || "No context retrieved."}

শিক্ষার্থীর প্রশ্ন:
${question}

প্রতিটি ধাপে একক (unit) দাও। শুধুমাত্র valid JSON আউটপুট দাও।`,
        },
      ];

      try {
        const data = await callLlmWithProviderFallback(physicsPrompt);
        if (data.error) return res.status(500).json({ error: "AI সার্ভিসে সমস্যা হয়েছে।" });
        const result = buildPhysicsJsonResponse(
          data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "",
          context.length > 0, subject, category
        );
        logFinalAiMessage("physics", result);
        return res.json(result);
      } catch (physErr) {
        console.log(`[Physics] Direct prompt failed (${physErr.message}), trying handlePhysicsQuestion fallback`);
        const result = await handlePhysicsQuestion({ question, subject, category, context, callLlmWithProviderFallback, normalizeSlug });
        logFinalAiMessage("physics-fallback", result.body);
        return res.status(result.status).json(result.body);
      }
    }

    // ─────────────────────────────────────────
    // GENERIC (no subject matched)
    // ─────────────────────────────────────────
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

    const langNote = lang === "bangla"
      ? "প্রশ্নটি বাংলায়। উত্তর বাংলায় দাও এবং গুরুত্বপূর্ণ পরিভাষা ইংরেজিতে বন্ধনীতে দাও।"
      : lang === "mixed"
        ? "Answer mainly in Bangla with key terms in English in parentheses."
        : "Answer in English.";

    const genericPrompt =
`You are an expert Bangladesh HSC academic tutor. ${langNote}

Use the retrieved context to answer the student question clearly and accurately.

Rules:
1. Prioritize the context if it is relevant.
2. If context is not helpful, answer from general knowledge and say so.
3. Use equations, definitions, and examples as needed.
4. Keep answer between 8 and 15 lines.
5. End with 2 HSC exam tips specific to this topic.

Retrieved Context:
${context}

Student Question: ${question}

Answer:`;

    logFinalAiQuestion("generic", question);
    const data = await callLlmWithProviderFallback(genericPrompt);
    if (data.error) return res.status(500).json({ error: "AI সার্ভিসে সমস্যা হয়েছে।" });

    const responseBody = {
      answer:            data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "উত্তর পাওয়া যায়নি।",
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