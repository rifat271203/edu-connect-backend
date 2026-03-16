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
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

const PAYLOAD_INDEX_FIELDS = ["topic", "subject_slug", "category_slug"];
const DEFAULT_COLLECTION_NAME = process.env.QDRANT_COLLECTION || "hsc_chem_2nd_paper";
const SUBJECT_COLLECTION_MAP = {
  chemistry:
    process.env.QDRANT_COLLECTION_CHEMISTRY ||
    process.env.QDRANT_COLLECTION ||
    "hsc_chem_2nd_paper",
  math: process.env.QDRANT_COLLECTION_MATH || "hsc_math",
  physics: process.env.QDRANT_COLLECTION_PHYSICS || "hsc_physics",
};

function getConfiguredCollections() {
  const names = [
    DEFAULT_COLLECTION_NAME,
    process.env.QDRANT_COLLECTION_CHEMISTRY,
    process.env.QDRANT_COLLECTION_MATH,
    process.env.QDRANT_COLLECTION_PHYSICS,
  ]
    .map((name) => String(name || "").trim())
    .filter(Boolean);

  return [...new Set(names)];
}

function resolveCollectionName(subject, category) {
  const selectedSubject = pickSubjectHandler(subject, category);
  if (selectedSubject && SUBJECT_COLLECTION_MAP[selectedSubject]) {
    return SUBJECT_COLLECTION_MAP[selectedSubject];
  }
  return DEFAULT_COLLECTION_NAME;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasInText(alias, text) {
  if (!alias || !text) return false;
  const escaped = escapeRegExp(alias.trim());
  if (!escaped) return false;

  if (/^[a-z0-9_+\-]+$/i.test(alias.trim())) {
    const rx = new RegExp(`\\b${escaped}\\b`, "i");
    return rx.test(text);
  }
  return String(text).toLowerCase().includes(alias.toLowerCase());
}

function sentenceWithAlias(text, aliases) {
  if (!text) return "";
  const parts = String(text)
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return parts.find((s) => aliases.some((a) => aliasInText(a, s))) || "";
}

function classifyProductType(sentence) {
  if (!sentence) return "major";
  const possibleCue =
    /(possible|may|might|can form|could form|depends on|depending on|under.*condition|সম্ভাব|হতে পারে|শর্ত)/i;
  const minorCue = /(minor|স্বল্প|কম পরিমাণ)/i;
  if (possibleCue.test(sentence)) return "possible";
  if (minorCue.test(sentence)) return "minor";
  return "major";
}

function inferConditions(text) {
  const conditions = [];
  const seen = new Set();
  const cues = [
    { regex: /conc\.?\s*h2so4|concentrated\s+sulfuric\s+acid/i, label: "conc. H2SO4" },
    { regex: /conc\.?\s*hno3|concentrated\s+nitric\s+acid/i, label: "conc. HNO3" },
    { regex: /heat|\b\u0394\b|temperature|high\s+temp/i, label: "heat" },
    { regex: /uv|hv|light/i, label: "UV/light" },
    { regex: /catalyst|cat\./i, label: "catalyst" },
    { regex: /acidic|acid\s+medium/i, label: "acidic medium" },
    { regex: /basic|alkaline|base\s+medium/i, label: "basic medium" },
    { regex: /pressure|atm/i, label: "pressure" },
    { regex: /\bo3\b|ozone/i, label: "O3" },
    { regex: /\bzn\b|zinc/i, label: "Zn" },
    { regex: /\bh2o\b|water/i, label: "H2O" },
    { regex: /\bh2o2\b|hydrogen\s+peroxide/i, label: "H2O2" },
    { regex: /\bdms\b|dimethyl\s+sulfide/i, label: "DMS" },
    { regex: /\balcl3\b/i, label: "AlCl3" },
    { regex: /\bfebr3\b/i, label: "FeBr3" },
    { regex: /\bfecl3\b/i, label: "FeCl3" },
  ];

  for (const cue of cues) {
    if (cue.regex.test(text) && !seen.has(cue.label)) {
      seen.add(cue.label);
      conditions.push(cue.label);
    }
  }
  return conditions.join(", ");
}

/**
 * ✅ NEW: Resonance library for HSC-level aromatic resonance visualization.
 * We return:
 * - forms: SMILES variants (aromatic + kekule)
 * - arrow_steps: plain descriptions so frontend can overlay arrow animation (no risky atom-index assumptions)
 */
const RESONANCE_LIBRARY = {
  benzene: {
    base: { name: "benzene", smiles: smilesMap.benzene?.smiles || "c1ccccc1" },
    forms: [
      { name: "benzene (aromatic)", smiles: "c1ccccc1" },
      { name: "benzene (kekulé form A)", smiles: "C1=CC=CC=C1" },
      { name: "benzene (kekulé form B)", smiles: "C1=CC=CC=C1" },
    ],
    arrow_steps: [
      {
        step: 1,
        type: "pi_shift",
        desc: "Shift all three π-bonds around the ring (each double bond moves one position).",
      },
    ],
    note:
      "HSC idea: Benzene is a resonance hybrid of two equivalent Kekulé forms; delocalized π-electrons make all C–C bonds equal.",
  },

  toluene: {
    base: { name: "toluene", smiles: smilesMap.toluene?.smiles || "Cc1ccccc1" },
    forms: [
      { name: "toluene (aromatic)", smiles: "Cc1ccccc1" },
      { name: "toluene (kekulé)", smiles: "CC1=CC=CC=C1" },
    ],
    arrow_steps: [
      { step: 1, type: "pi_shift", desc: "Shift π-bonds around the ring (same benzene ring resonance; CH3 stays attached)." },
    ],
    note:
      "HSC idea: Toluene ring resonance is like benzene; CH3 is +I and activates ring (o/p-directing) but resonance drawing mainly shows π-bond shifting.",
  },

  phenol: {
    base: { name: "phenol", smiles: smilesMap.phenol?.smiles || "Oc1ccccc1" },
    forms: [
      { name: "phenol (aromatic)", smiles: "Oc1ccccc1" },
      { name: "phenol (kekulé)", smiles: "OC1=CC=CC=C1" },
    ],
    arrow_steps: [
      { step: 1, type: "pi_shift", desc: "Shift π-bonds around the ring (benzene-like resonance)." },
      {
        step: 2,
        type: "lone_pair_to_pi",
        desc: "Additionally (HSC): oxygen lone pair can donate into the ring → o/p positions gain electron density (show o/p resonance forms in theory).",
      },
    ],
    note:
      "HSC idea: Phenol is strongly activating because O donates by +M (resonance) and directs electrophiles to ortho/para.",
  },

  aniline: {
    base: { name: "aniline", smiles: smilesMap.aniline?.smiles || "Nc1ccccc1" },
    forms: [
      { name: "aniline (aromatic)", smiles: "Nc1ccccc1" },
      { name: "aniline (kekulé)", smiles: "NC1=CC=CC=C1" },
    ],
    arrow_steps: [
      { step: 1, type: "pi_shift", desc: "Shift π-bonds around the ring (benzene-like resonance)." },
      {
        step: 2,
        type: "lone_pair_to_pi",
        desc: "Additionally (HSC): nitrogen lone pair donates into ring → o/p positions become electron-rich (reason for o/p directing).",
      },
    ],
    note:
      "HSC idea: Aniline is very strongly activating by +M effect; its lone pair delocalizes into the ring, stabilizing the σ-complex at ortho/para.",
  },
};

function isResonanceRequest(question) {
  const q = String(question || "").toLowerCase();
  return (
    q.includes("resonance") ||
    q.includes("resonance structure") ||
    q.includes("resonance structures") ||
    q.includes("resonance arrow") ||
    q.includes("electron shifting") ||
    q.includes("delocal") ||
    q.includes("রেজোন্যান্স") ||
    q.includes("রেসোন্যান্স") ||
    q.includes("রেজোনেন্স") ||
    q.includes("রেসোনেন্স")
  );
}

function pickResonanceTarget(question) {
  const q = String(question || "").toLowerCase();
  // prioritize specific substituted rings
  if (q.includes("aniline") || q.includes("aminobenzene") || q.includes("c6h5nh2")) return "aniline";
  if (q.includes("phenol") || q.includes("hydroxybenzene") || q.includes("c6h5oh")) return "phenol";
  if (q.includes("toluene") || q.includes("methylbenzene")) return "toluene";
  if (q.includes("benzene") || q.includes("c6h6")) return "benzene";
  return ""; // none
}

function buildResonanceBlock(question) {
  if (!isResonanceRequest(question)) return null;
  const target = pickResonanceTarget(question);
  if (!target) return null;
  const entry = RESONANCE_LIBRARY[target];
  if (!entry) return null;

  // sanitize: keep only forms that have valid smiles strings
  const forms = (Array.isArray(entry.forms) ? entry.forms : []).filter(
    (f) => f && typeof f.smiles === "string" && f.smiles.trim()
  );

  return {
    target,
    base: entry.base,
    forms,
    arrow_steps: Array.isArray(entry.arrow_steps) ? entry.arrow_steps : [],
    note: typeof entry.note === "string" ? entry.note : "",
  };
}

/**
 * ✅ Build diagram ONLY from (question + answer) to avoid context leakage.
 */
function buildChemDiagram(question, answer) {
  const sourceText = `${question || ""}\n${answer || ""}`;
  const answerText = String(answer || "");

  const reactants = [];
  const reagents = [];
  const products = [];

  const seenReactants = new Set();
  const seenReagents = new Set();
  const seenProducts = new Set();

  const productCue = /(product|products|forms?|formed|gives?|yields?|produces?|obtained|উৎপন্ন|পণ্য|তৈরি)/i;

  for (const [canonicalName, info] of Object.entries(smilesMap)) {
    const aliases = Array.isArray(info.aliases) ? info.aliases : [canonicalName];
    const found = aliases.some((alias) => aliasInText(alias, sourceText));
    if (!found || !info.smiles) continue;

    const sentence = sentenceWithAlias(answerText, aliases) || sentenceWithAlias(sourceText, aliases);
    const sentenceLooksProduct = productCue.test(sentence);
    const defaultRole = info.default_role || "reactant";
    const name = canonicalName;

    if (defaultRole === "reagent") {
      if (!seenReagents.has(name)) {
        seenReagents.add(name);
        reagents.push({ name, smiles: info.smiles });
      }
      continue;
    }

    if (defaultRole === "product" || sentenceLooksProduct) {
      if (!seenProducts.has(name)) {
        seenProducts.add(name);
        products.push({
          name,
          smiles: info.smiles,
          type: classifyProductType(sentence),
        });
      }
      continue;
    }

    if (!seenReactants.has(name)) {
      seenReactants.add(name);
      reactants.push({ name, smiles: info.smiles });
    }
  }

  return {
    reactants,
    reagents,
    conditions: inferConditions(sourceText),
    products,
  };
}

/**
 * ✅ Reaction keyword → default reagent presets (critical for HSC questions).
 */
function inferReagentPresets(question, answer) {
  const text = `${question || ""}\n${answer || ""}`.toLowerCase();
  const inferred = [];

  const push = (canonical) => {
    const info = smilesMap[canonical];
    if (info?.smiles) inferred.push({ name: canonical, smiles: info.smiles });
  };

  // nitration
  if (text.includes("nitration") || text.includes("nitro")) {
    push("nitric_acid");
    push("sulfuric_acid");
    return inferred;
  }

  // bromination / chlorination of aromatics
  if (text.includes("bromination") || /\bbr2\b/i.test(text)) {
    push("bromine");
    push("fe_br3");
    return inferred;
  }
  if (text.includes("chlorination") || /\bcl2\b/i.test(text)) {
    push("chlorine");
    push("fe_cl3");
    return inferred;
  }

  // Friedel–Crafts
  if (text.includes("friedel") || text.includes("crafts")) {
    push("alcl3");
    return inferred;
  }

  // sulphonation
  if (text.includes("sulphonation") || text.includes("sulfonation")) {
    push("sulfuric_acid");
    return inferred;
  }

  // ozonolysis
  if (text.includes("ozonolysis") || text.includes("ozone") || /\bo3\b/.test(text)) {
    push("ozone");
    if (text.includes("zn") || text.includes("zinc")) push("zinc");
    if (text.includes("h2o") || text.includes("water")) push("water");
    if (text.includes("dms")) push("dms");
    if (text.includes("h2o2")) push("hydrogen_peroxide");
    return inferred;
  }

  return inferred;
}

function buildMechanismSteps(answer, context, diagram) {
  const text = `${context || ""}\n${answer || ""}`.toLowerCase();
  const steps = [];

  const productStructures = (Array.isArray(diagram.products) ? diagram.products : []).map((p) => ({
    name: p.name,
    smiles: p.smiles,
  }));

  // --- nitration ---
  if (text.includes("nitration")) {
    steps.push({
      step: 1,
      title: "Electrophile formation",
      desc: "Mixed acid generates nitronium ion (NO2+), the electrophile.",
      structures: diagram.reagents,
    });
    steps.push({
      step: 2,
      title: "Sigma complex formation",
      desc: "Aromatic ring attacks NO2+ forming an arenium (sigma) complex.",
      structures: diagram.reactants,
    });
    steps.push({
      step: 3,
      title: "Aromaticity restoration",
      desc: "Deprotonation restores aromaticity and forms nitro product(s).",
      structures: productStructures,
    });
    return steps;
  }

  // --- Friedel–Crafts alkylation ---
  if (text.includes("friedel") || text.includes("crafts") || text.includes("alkylation")) {
    steps.push({
      step: 1,
      title: "Electrophile generation",
      desc: "AlCl3 helps generate a carbocation-like electrophile from the alkyl halide.",
      structures: diagram.reagents,
    });
    steps.push({
      step: 2,
      title: "Aromatic substitution",
      desc: "Benzene attacks the electrophile to form a sigma complex.",
      structures: diagram.reactants,
    });
    steps.push({
      step: 3,
      title: "Deprotonation",
      desc: "Loss of H+ restores aromaticity and gives alkylbenzene.",
      structures: productStructures,
    });
    return steps;
  }

  // --- Halogenation ---
  if (text.includes("bromination") || text.includes("chlorination") || /\bbr2\b|\bcl2\b/.test(text)) {
    steps.push({
      step: 1,
      title: "Electrophile activation",
      desc: "Lewis acid polarizes halogen to generate a strong electrophile (Br+ / Cl+ equivalent).",
      structures: diagram.reagents,
    });
    steps.push({
      step: 2,
      title: "Sigma complex formation",
      desc: "Aromatic ring attacks the electrophile forming a sigma complex.",
      structures: diagram.reactants,
    });
    steps.push({
      step: 3,
      title: "Aromaticity restoration",
      desc: "Deprotonation restores aromaticity and forms halo-arene.",
      structures: productStructures,
    });
    return steps;
  }

  // --- Ozonolysis ---
  if (text.includes("ozonolysis") || text.includes("o3") || text.includes("ozone")) {
    steps.push({
      step: 1,
      title: "Ozone addition",
      desc: "Ozone adds to the double bond forming ozonide-type intermediates.",
      structures: [...diagram.reactants, ...diagram.reagents.filter((m) => m.name === "ozone")],
    });
    steps.push({
      step: 2,
      title: "Workup / cleavage",
      desc: "Workup cleaves intermediates to carbonyl products depending on conditions.",
      structures: productStructures,
    });
    return steps;
  }

  // Generic fallback
  steps.push({
    step: 1,
    title: "Identify reaction type",
    desc: "Determine substrate + reagent type and classify the reaction.",
    structures: [...diagram.reactants, ...diagram.reagents],
  });
  if (productStructures.length) {
    steps.push({
      step: 2,
      title: "Predict product(s)",
      desc: "Apply the reaction rules to get major/minor products.",
      structures: productStructures,
    });
  }
  return steps;
}

function resolveKnownMolecule(item) {
  if (!item || typeof item !== "object") return null;
  const nameKey = typeof item.name === "string" ? item.name.trim().toLowerCase() : "";
  const smilesKey = typeof item.smiles === "string" ? item.smiles.trim() : "";

  let canonical = "";
  if (nameKey && aliasToCanonical.has(nameKey)) canonical = aliasToCanonical.get(nameKey);
  else if (smilesKey && smilesToCanonical.has(smilesKey)) canonical = smilesToCanonical.get(smilesKey);

  if (!canonical || !smilesMap[canonical]?.smiles) return null;
  return { name: canonical, smiles: smilesMap[canonical].smiles };
}

function mergeUniqueStructures(primary, fallback) {
  const out = [];
  const seen = new Set();
  const push = (arr) => {
    for (const mol of arr) {
      const key = `${mol.name}||${mol.smiles}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(mol);
    }
  };
  push(Array.isArray(primary) ? primary : []);
  push(Array.isArray(fallback) ? fallback : []);
  return out;
}

function sanitizeMoleculeArray(input, fallback, isProduct = false) {
  const arr = Array.isArray(input) ? input : [];
  const parsed = [];

  for (const item of arr) {
    const known = resolveKnownMolecule(item);
    if (!known) continue;

    if (isProduct) {
      const rawType = typeof item.type === "string" ? item.type.trim().toLowerCase() : "major";
      const type = ["major", "minor", "possible"].includes(rawType) ? rawType : "major";
      parsed.push({ ...known, type });
    } else {
      parsed.push(known);
    }
  }

  if (isProduct) {
    const fallbackProducts = (Array.isArray(fallback) ? fallback : []).map((p) => ({
      name: p.name,
      smiles: p.smiles,
      type: ["major", "minor", "possible"].includes(p.type) ? p.type : "major",
    }));
    const merged = mergeUniqueStructures(parsed, fallbackProducts);
    return merged.map((p) => ({ name: p.name, smiles: p.smiles, type: p.type || "major" }));
  }

  return mergeUniqueStructures(parsed, fallback);
}

function sanitizeMechanismSteps(input, fallback) {
  const source = Array.isArray(input) ? input : [];
  const base = Array.isArray(fallback) ? fallback : [];
  const chosen = source.length > 0 ? source : base;
  const out = [];

  for (const item of chosen) {
    if (!item || typeof item !== "object") continue;
    const structures = sanitizeMoleculeArray(item.structures, []);
    out.push({
      step: Number.isFinite(Number(item.step)) ? Number(item.step) : out.length + 1,
      title:
        typeof item.title === "string" && item.title.trim() ? item.title.trim() : `Step ${out.length + 1}`,
      desc:
        typeof item.desc === "string" && item.desc.trim()
          ? item.desc.trim()
          : typeof item.description === "string" && item.description.trim()
            ? item.description.trim()
            : "",
      structures,
    });
  }
  return out;
}

function safeParseJsonObject(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {}

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = raw.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function extractAllowedCanonicalsFromQuestion(question) {
  const q = String(question || "");
  const allowed = new Set();
  for (const [canonicalName, info] of Object.entries(smilesMap)) {
    const aliases = Array.isArray(info.aliases) ? info.aliases : [canonicalName];
    if (aliases.some((a) => aliasInText(a, q))) allowed.add(canonicalName);
  }
  return allowed;
}

/**
 * ✅ allow reagents if they are:
 * - explicitly in the question, OR
 * - inferred from reaction keyword
 */
function sanitizeDiagramByQuestionAndInference(diagram, question, answer) {
  const allowedFromQuestion = extractAllowedCanonicalsFromQuestion(question);

  const inferredReagents = inferReagentPresets(question, answer);
  const inferredNames = new Set(inferredReagents.map((x) => x.name));

  const keepReactants = (arr) =>
    (Array.isArray(arr) ? arr : []).filter((m) => m && typeof m.name === "string" && allowedFromQuestion.has(m.name));

  const keepReagents = (arr) =>
    (Array.isArray(arr) ? arr : []).filter(
      (m) =>
        m &&
        typeof m.name === "string" &&
        (allowedFromQuestion.has(m.name) || inferredNames.has(m.name))
    );

  diagram.reactants = keepReactants(diagram.reactants);
  diagram.reagents = mergeUniqueStructures(keepReagents(diagram.reagents), inferredReagents);

  if (!diagram.conditions || !String(diagram.conditions).trim()) {
    diagram.conditions = inferConditions(`${question || ""}\n${answer || ""}`);
  }

  const reactantNames = new Set((diagram.reactants || []).map((m) => m.name));
  diagram.products = (Array.isArray(diagram.products) ? diagram.products : []).filter(
    (p) => p && typeof p.name === "string" && !reactantNames.has(p.name)
  );

  return diagram;
}

function applyOzonolysisOverrides(question, diagram) {
  const q = String(question || "").toLowerCase();
  const hasO3 = q.includes("ozone") || q.includes("o3") || q.includes("ozonolysis");
  if (!hasO3) return diagram;

  const reductive = q.includes("zn") || q.includes("zinc") || q.includes("h2o") || q.includes("water") || q.includes("reductive");

  if ((q.includes("ethene") || q.includes("ethylene")) && reductive) {
    diagram.products = [{ name: "methanal", smiles: smilesMap.methanal.smiles, type: "major" }];
    return diagram;
  }

  if (q.includes("propene") && reductive) {
    diagram.products = [
      { name: "ethanal", smiles: smilesMap.ethanal.smiles, type: "major" },
      { name: "methanal", smiles: smilesMap.methanal.smiles, type: "major" },
    ];
    return diagram;
  }

  return diagram;
}

function enrichAnswerIfTooShort(answer, question, context) {
  const a = String(answer || "").trim();
  if (a.length >= 220) return a;

  const ctx = String(context || "");
  const lines = ctx
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const infoLines = lines
    .filter((l) => !/^---\s*অংশ\s*\d+/i.test(l))
    .filter((l) => l.length > 20)
    .slice(0, 3);

  const extra = infoLines.length ? `\n\n(From your notes/context) ${infoLines.join(" ")}` : "";
  const hint = extra || "\n\nTip: Mention reagents/conditions to predict products more accurately.";

  return `${a}${hint}`;
}

function syncNarrativeWithDiagram(question, response) {
  const q = String(question || "").toLowerCase();

  const products = Array.isArray(response?.diagram?.products) ? response.diagram.products : [];
  const productNames = new Set(products.map((p) => String(p.name || "").toLowerCase()));

  const hasMethanal = productNames.has("methanal") || productNames.has("formaldehyde");
  const hasEthanal = productNames.has("ethanal") || productNames.has("acetaldehyde");

  if (hasMethanal && !hasEthanal) {
    if (typeof response.answer === "string") {
      response.answer = response.answer
        .replace(/\bacetaldehyde\b/gi, "methanal (formaldehyde)")
        .replace(/\bethanal\b/gi, "methanal (formaldehyde)")
        .replace(/\bCH3CHO\b/gi, "HCHO");
    }

    if (Array.isArray(response.mechanism_steps)) {
      response.mechanism_steps = response.mechanism_steps.map((s) => {
        const step = { ...s };
        if (typeof step.desc === "string") {
          step.desc = step.desc
            .replace(/\bacetaldehyde\b/gi, "methanal")
            .replace(/\bethanal\b/gi, "methanal")
            .replace(/\bCH3CHO\b/gi, "HCHO");
        }
        if (Array.isArray(step.structures) && step.structures.length) {
          step.structures = step.structures.map((m) => {
            const name = String(m?.name || "").toLowerCase();
            if (name === "ethanal" || name === "acetaldehyde") return { name: "methanal", smiles: "C=O" };
            return m;
          });
        }
        return step;
      });
    }
  }

  if (q.includes("h2o") || q.includes("water")) {
    const r = Array.isArray(response.diagram?.reagents) ? response.diagram.reagents : [];
    const hasWater = r.some((x) => String(x.name || "").toLowerCase() === "water");
    if (!hasWater && smilesMap.water?.smiles) {
      r.push({ name: "water", smiles: smilesMap.water.smiles });
      response.diagram.reagents = r;
    }
  }

  return response;
}

function buildChemistryJsonResponse(modelText, context, contextUsed, question) {
  const parsed = safeParseJsonObject(modelText);

  const fallbackDiagram = buildChemDiagram(question, modelText);
  const fallbackMechanism = buildMechanismSteps(modelText, context, fallbackDiagram);

  const diagramInput = parsed && typeof parsed.diagram === "object" ? parsed.diagram : {};
  const diagram = {
    reactants: sanitizeMoleculeArray(diagramInput.reactants, fallbackDiagram.reactants),
    reagents: sanitizeMoleculeArray(diagramInput.reagents, fallbackDiagram.reagents),
    conditions:
      typeof diagramInput.conditions === "string" && diagramInput.conditions.trim()
        ? diagramInput.conditions.trim()
        : typeof fallbackDiagram.conditions === "string"
          ? fallbackDiagram.conditions
          : "",
    products: sanitizeMoleculeArray(diagramInput.products, fallbackDiagram.products, true),
  };

  const gated = sanitizeDiagramByQuestionAndInference(diagram, question, modelText);
  const finalDiagram = applyOzonolysisOverrides(question, gated);

  const fallbackMechanism2 = buildMechanismSteps(modelText, context, finalDiagram);
  const mechanism_steps = sanitizeMechanismSteps(parsed?.mechanism_steps, fallbackMechanism2);

  const rawAnswer =
    typeof parsed?.answer === "string" && parsed.answer.trim()
      ? parsed.answer.trim()
      : typeof modelText === "string" && modelText.trim()
        ? modelText.trim()
        : "উত্তর পাওয়া যায়নি";

  const answer = enrichAnswerIfTooShort(rawAnswer, question, context);

  const diagram_caption =
    typeof parsed?.diagram_caption === "string" && parsed.diagram_caption.trim()
      ? parsed.diagram_caption.trim()
      : finalDiagram.products?.length
        ? "Skeletal reaction diagram (structures drawn from SMILES)."
        : "Diagram not available for this response.";

  // ✅ NEW: Resonance block (only when asked)
  const resonance = buildResonanceBlock(question);

  let out = {
    answer,
    diagram: finalDiagram,
    diagram_caption,
    mechanism_steps,
    resonance, // <= NEW FIELD
    contextUsed: Boolean(contextUsed),
    subject: "chemistry",
    category: "chemistry",
  };

  out = syncNarrativeWithDiagram(question, out);
  return out;
}

function normalizeSlug(value) {
  if (!value || typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function logFinalAiMessage(label, payload) {
  try {
    const answer = payload?.answer;
    if (typeof answer === "string" && answer.trim()) {
      console.log(`[AI Final][${label}] ${answer}`);
      return;
    }
    console.log(`[AI Final][${label}]`, JSON.stringify(payload));
  } catch (error) {
    console.log(`[AI Final][${label}] log failed: ${error.message}`);
  }
}

function logFinalAiQuestion(label, question) {
  try {
    const q = String(question || "").trim();
    console.log(`[AI Question][${label}] ${q}`);
  } catch (error) {
    console.log(`[AI Question][${label}] log failed: ${error.message}`);
  }
}

function isChemistryRequest(subject, category) {
  const subjectSlug = normalizeSlug(subject);
  const categorySlug = normalizeSlug(category);
  return (
    subjectSlug.includes("chem") ||
    categorySlug.includes("chem") ||
    categorySlug === "organic" ||
    categorySlug === "organic_chemistry"
  );
}

function pickSubjectHandler(subject, category) {
  const subjectSlug = normalizeSlug(subject);
  const categorySlug = normalizeSlug(category);

  if (isChemistryRequest(subject, category)) return "chemistry";
  if (subjectSlug.includes("math") || subjectSlug.includes("mathematics") || categorySlug.includes("math")) {
    return "math";
  }
  if (
    subjectSlug.includes("physics") ||
    subjectSlug === "phy" ||
    categorySlug.includes("physics") ||
    categorySlug.includes("mechanics")
  ) {
    return "physics";
  }
  return null;
}

async function ensurePayloadIndexes() {
  try {
    const collectionNames = getConfiguredCollections();
    if (collectionNames.length === 0) {
      console.log("[Qdrant] No Qdrant collections configured, skipping payload index setup");
      return;
    }

    for (const collectionName of collectionNames) {
      for (const fieldName of PAYLOAD_INDEX_FIELDS) {
        try {
          await qdrant.createPayloadIndex(collectionName, {
            wait: true,
            field_name: fieldName,
            field_schema: "keyword",
          });
          console.log(`[Qdrant] Created keyword index for '${fieldName}' on '${collectionName}'`);
        } catch (error) {
          if (error.message?.includes("already exists") || error.status === 409) {
            console.log(`[Qdrant] Index for '${fieldName}' already exists on '${collectionName}'`);
          } else {
            console.log(
              `[Qdrant] Could not create '${fieldName}' index on '${collectionName}': ${error.message}`
            );
          }
        }
      }
    }
  } catch (error) {
    console.log(`[Qdrant] Payload index setup failed: ${error.message}`);
  }
}

ensurePayloadIndexes();

const GROQ_MODEL_FALLBACKS = [
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

/**
 * ✅ UPDATED: JSON schema now includes optional "resonance".
 * The model may omit it, but our server adds it when the user asks for resonance.
 */
const CHEMISTRY_SYSTEM_PROMPT = `You are an expert Bangladesh HSC Organic Chemistry tutor.

Your job is to analyze the question and classify the reaction BEFORE answering.

Always follow this reasoning pipeline internally:

STEP 1 — Identify Reaction Mode

Determine if the question is:

1. conversion_reaction
2. aromatic_substitution
3. addition_reaction
4. elimination_reaction
5. oxidation_reduction
6. rearrangement
7. resonance_concept
8. conceptual_theory

Return this as "reaction_type".

---

STEP 2 — Identify Molecular Class

Determine substrate type:

- aromatic
- aliphatic
- alkene
- alkyne
- alcohol
- acid
- aldehyde
- ketone
- ester
- unknown

Return this as "substrate_class".

---

STEP 3 — Detect Carbon Skeleton Change

Compare reactant carbon count with product carbon count.

Return:

- carbon_increase
- carbon_decrease
- carbon_same
- unknown

Rules:

carbon_increase examples
• Grignard reactions
• CN → COOH
• Friedel–Crafts alkylation
• benzene → toluene

carbon_decrease examples
• decarboxylation
• ozonolysis
• oxidative cleavage

carbon_same examples
• substitution
• addition
• functional group conversion

Return this as "carbon_change".

---

STEP 4 — Decide If Mechanism Is Needed

mechanism_steps should ONLY appear when:

reaction_type = conversion_reaction
OR
reaction_type = aromatic_substitution
OR
reaction_type = addition_reaction

Otherwise:

mechanism_steps = []

---

STEP 5 — Generate Student Answer

Write a **6–12 line clear explanation** suitable for HSC exam.

Must include:
• what reaction occurs
• why it occurs
• reagents role
• conditions if relevant
• final product

If carbon increases or decreases,
explicitly explain the carbon skeleton change.

---

OUTPUT FORMAT (JSON ONLY)

{
  "reaction_type": "",
  "substrate_class": "",
  "carbon_change": "",

  "answer": "",

  "diagram": {
    "reactants": [{ "name": "", "smiles": "" }],
    "reagents": [{ "name": "", "smiles": "" }],
    "conditions": "",
    "products": [{ "name": "", "smiles": "", "type": "major"|"minor"|"possible" }]
  },

  "diagram_caption": "",

  "mechanism_steps": [
    {
      "step": 1,
      "title": "",
      "desc": "",
      "structures": [{ "name": "", "smiles": "" }]
    }
  ],

  "resonance": null,

  "contextUsed": false,
  "subject": "chemistry",
  "category": "chemistry"
}

CRITICAL RULES

1. Return ONLY valid JSON.
2. Reactants must come from the user question only.
3. Do NOT add molecules from external examples.
4. Only include SMILES you are confident about.
5. If the question is conceptual, return:
   mechanism_steps = []
6. If unsure about product, return products: [].`;

// Try Groq models first when GROQ_API_KEY is available
async function callGroqWithFallback(input) {
  const apiKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) throw new Error("GROQ_API_KEY is missing");

  const messages = Array.isArray(input)
    ? input
    : [{ role: "user", content: String(input || "") }];

  for (const model of GROQ_MODEL_FALLBACKS) {
    try {
      console.log(`[Groq] Trying model: ${model}`);

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          max_tokens: 1024,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        const message = data?.error?.message || `${response.status} ${response.statusText}`;
        throw new Error(message);
      }

      console.log(`[Groq] Successfully used model: ${model}`);
      return data;
    } catch (error) {
      console.log(`[Groq] Model ${model} failed: ${error.message}`);
    }
  }

  throw new Error("All Groq models failed.");
}

// Then try OpenRouter free-ish fallback models
async function callOpenRouterWithFallback(input) {
  const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing");

  const messages = Array.isArray(input)
    ? input
    : [{ role: "user", content: String(input || "") }];

  for (const model of OPENROUTER_MODEL_FALLBACKS) {
    try {
      console.log(`[OpenRouter] Trying model: ${model}`);

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3001",
          "X-Title": "HSC Chemistry Assistant",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          max_tokens: 1024,
        }),
      });

      const data = await response.json();

      if (data.error) {
        const errorCode = data.error.code || data.error.type;
        if (errorCode === 404 || data.error.message?.includes("No endpoints found")) {
          console.log(`[OpenRouter] Model ${model} not available, trying next...`);
          continue;
        }
        throw new Error(data.error.message || JSON.stringify(data.error));
      }

      console.log(`[OpenRouter] Successfully used model: ${model}`);
      return data;
    } catch (error) {
      console.log(`[OpenRouter] Model ${model} failed: ${error.message}`);
    }
  }

  throw new Error("All OpenRouter models failed. Please check your API key and try again later.");
}

async function callLlmWithProviderFallback(input) {
  const hasGroq = String(process.env.GROQ_API_KEY || "").trim().length > 0;

  if (hasGroq) {
    try {
      return await callGroqWithFallback(input);
    } catch (error) {
      console.log(`[LLM] Groq failed, falling back to OpenRouter: ${error.message}`);
    }
  } else {
    console.log("[LLM] GROQ_API_KEY not found, skipping Groq and using OpenRouter fallback");
  }

  return callOpenRouterWithFallback(input);
}

async function embedOne(text) {
  const response = await ai.models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
  });

  return response.embeddings[0].values;
}

async function getContext(question, subject, category) {
  const qvec = await embedOne(question);
  const collectionName = resolveCollectionName(subject, category);

  const questionInfo = detectQuestionType(question);
  const subjectSlug = normalizeSlug(subject);
  const categorySlug = normalizeSlug(category);

  const searchOptions = {
    vector: qvec,
    limit: 20,
    score_threshold: 0.3,
  };

  const mustFilters = [];

  if (subjectSlug) mustFilters.push({ key: "subject_slug", match: { value: subjectSlug } });
  if (categorySlug) mustFilters.push({ key: "category_slug", match: { value: categorySlug } });

  if (!subjectSlug && !categorySlug && questionInfo.isOrganic) {
    mustFilters.push({ key: "topic", match: { value: "Organic" } });
    console.log(`[Organic Query Detected] Keywords: ${questionInfo.keywords.join(", ")}`);
  }

  if (mustFilters.length > 0) searchOptions.filter = { must: mustFilters };

  let hits = [];
  try {
    hits = await qdrant.search(collectionName, searchOptions);
    console.log(
      `[Qdrant search] collection=${collectionName}, results=${hits.length} (filtered: ${mustFilters.length > 0})`
    );

    if (hits.length === 0) {
      console.log(
        `[Qdrant search] No hits with score_threshold=0.3 for collection=${collectionName}. Retrying without score threshold...`
      );

      const relaxedOptions = {
        vector: qvec,
        limit: 20,
      };
      if (mustFilters.length > 0) relaxedOptions.filter = { must: mustFilters };

      hits = await qdrant.search(collectionName, relaxedOptions);
      console.log(
        `[Qdrant search][relaxed] collection=${collectionName}, results=${hits.length} (filtered: ${mustFilters.length > 0})`
      );
    }

    if (hits.length === 0 && mustFilters.length > 0) {
      console.log(
        `[Qdrant search] No hits with subject/category filters for collection=${collectionName}. Retrying collection-only search...`
      );
      hits = await qdrant.search(collectionName, {
        vector: qvec,
        limit: 20,
      });
      console.log(`[Qdrant search][collection-only] collection=${collectionName}, results=${hits.length}`);
    }
  } catch (filterError) {
    console.log(`[Filter failed: ${filterError.message}] Falling back to unfiltered search`);
    hits = await qdrant.search(collectionName, {
      vector: qvec,
      limit: 20,
    });
    console.log(`[Fallback search] collection=${collectionName}, results=${hits.length}`);
  }

  const examQuestionPattern = /^(ক\)|খ\)|গ\)|ঘ\)|অথবা|প্রশ্নঃ|সৃজনশীল)/;
  const filtered = hits.filter((h) => {
    const text = h.payload?.text || "";
    const firstLine = text.split("\n")[0] || "";
    return !examQuestionPattern.test(firstLine.trim());
  });

  const selected = (filtered.length >= 4 ? filtered : hits).slice(0, 8);

  const context = selected
    .map((h, i) => {
      const score = h.score ? ` (relevance: ${(h.score * 100).toFixed(1)}%)` : "";
      return `--- অংশ ${i + 1}${score} ---\n${h.payload?.text || ""}`;
    })
    .join("\n\n");

  const contextChunks = selected.map((h, i) => ({
    id: String(h.payload?.chunk_id ?? h.id ?? `chunk_${i + 1}`),
    type: String(h.payload?.type || h.payload?.chunk_type || h.payload?.kind || ""),
    topic: String(h.payload?.topic || h.payload?.category || ""),
    pattern: String(h.payload?.pattern || ""),
    text: String(h.payload?.text || ""),
    subject_slug: String(h.payload?.subject_slug || ""),
    category_slug: String(h.payload?.category_slug || ""),
  }));

  return {
    contextText: context,
    contextChunks,
    collectionName,
  };
}

router.post("/ask", async (req, res) => {
  try {
    const { question, subject, category } = req.body;

    if (!question || question.trim().length < 3) {
      return res.status(400).json({ error: "প্রশ্ন দিতে হবে" });
    }

    const { contextText: context, contextChunks, collectionName } = await getContext(question, subject, category);
    console.log(`[Qdrant] Active collection for request: ${collectionName}`);
    const selectedSubject = pickSubjectHandler(subject, category);

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

    if (selectedSubject === "math") {
      logFinalAiQuestion("math", question);
      const result = await handleMathQuestion({
        question,
        subject,
        category,
        context,
        contextChunks,
        callLlmWithProviderFallback,
        normalizeSlug,
      });
      logFinalAiMessage("math", result.body);
      return res.status(result.status).json(result.body);
    }

    if (selectedSubject === "physics") {
      logFinalAiQuestion("physics", question);
      const result = await handlePhysicsQuestion({
        question,
        subject,
        category,
        context,
        callLlmWithProviderFallback,
        normalizeSlug,
      });
      logFinalAiMessage("physics", result.body);
      return res.status(result.status).json(result.body);
    }

    if (!context || context.length < 100) {
      const fallbackAnswer = "এই প্রশ্নের উত্তর বইয়ের তথ্য থেকে পাওয়া যায়নি। অনুগ্রহ করে অন্য প্রশ্ন করুন।";
      const fallbackBody = {
        answer: fallbackAnswer,
        contextUsed: false,
        subject: normalizeSlug(subject) || null,
        category: normalizeSlug(category) || null,
      };
      logFinalAiMessage("fallback", fallbackBody);
      return res.json(fallbackBody);
    }

    // Generic response when subject is not explicitly chemistry/math/physics.
    const prompt = `You are an academic tutor.

Use the retrieved context below to answer the student's question clearly.

Instructions for Answering:
1) Use the book chunks as context or hints. Prioritize them if relevant.
2) If chunks are not helpful, answer using general knowledge but say it's not directly from the book.
3) Explain clearly with equations/definitions when needed.
4) Match the user's language (Bangla or English) naturally.
5) Use examples when helpful.

The Book Information:
${context}

প্রশ্ন: ${question}

Provide a clear final answer:`;

    logFinalAiQuestion("generic", question);

    const data = await callLlmWithProviderFallback(prompt);
    if (data.error) {
      console.error("LLM API error:", data.error);
      return res.status(500).json({ error: "AI সার্ভিসে সমস্যা হয়েছে" });
    }

    const answer = data?.choices?.[0]?.message?.content || "উত্তর পাওয়া যায়নি";

    const responseBody = {
      answer,
      contextUsed: context.length > 0,
      subject: normalizeSlug(subject) || null,
      category: normalizeSlug(category) || null,
    };
    logFinalAiMessage("generic", responseBody);
    res.json(responseBody);
  } catch (e) {
    console.error("RAG Error:", e);
    res.status(500).json({ error: "RAG failed", details: e.message });
  }
});

module.exports = router;
