let baseSmilesMap = require("../smiles_map.json");

/**
 * Chemistry-only SMILES and chemistry-only helper logic moved here.
 */
const EXTRA_SMILES = {
  ozone: { smiles: "O=[O+][O-]", aliases: ["O3", "ozone"], default_role: "reagent" },
  zinc: { smiles: "[Zn]", aliases: ["Zn", "zinc"], default_role: "reagent" },
  water: { smiles: "O", aliases: ["H2O", "water"], default_role: "reagent" },
  hydrogen_peroxide: { smiles: "OO", aliases: ["H2O2", "hydrogen peroxide"], default_role: "reagent" },
  dms: { smiles: "CS", aliases: ["DMS", "dimethyl sulfide"], default_role: "reagent" },

  nitric_acid: { smiles: "O=[N+]([O-])O", aliases: ["HNO3", "nitric acid", "conc. HNO3"], default_role: "reagent" },
  sulfuric_acid: { smiles: "OS(=O)(=O)O", aliases: ["H2SO4", "sulfuric acid", "conc. H2SO4"], default_role: "reagent" },

  bromine: { smiles: "BrBr", aliases: ["Br2", "bromine"], default_role: "reagent" },
  chlorine: { smiles: "ClCl", aliases: ["Cl2", "chlorine"], default_role: "reagent" },
  fe_br3: { smiles: "[Fe+3].Br.Br.Br", aliases: ["FeBr3", "ferric bromide"], default_role: "reagent" },
  fe_cl3: { smiles: "[Fe+3].Cl.Cl.Cl", aliases: ["FeCl3", "ferric chloride"], default_role: "reagent" },
  alcl3: { smiles: "[Al](Cl)(Cl)Cl", aliases: ["AlCl3", "aluminium chloride"], default_role: "reagent" },

  chloromethane: { smiles: "CCl", aliases: ["CH3Cl", "chloromethane", "methyl chloride"], default_role: "reactant" },

  benzene: { smiles: "c1ccccc1", aliases: ["benzene", "C6H6"], default_role: "reactant" },
  toluene: { smiles: "Cc1ccccc1", aliases: ["toluene", "methylbenzene"], default_role: "reactant" },
  nitrobenzene: { smiles: "O=[N+]([O-])c1ccccc1", aliases: ["nitrobenzene"], default_role: "product" },

  benzene_kekule_a: {
    smiles: "C1=CC=CC=C1",
    aliases: ["benzene kekule", "benzene resonance form", "kekule benzene"],
    default_role: "reactant",
  },
  benzene_kekule_b: {
    smiles: "C1=CC=CC=C1",
    aliases: ["benzene kekule 2", "benzene resonance 2"],
    default_role: "reactant",
  },
  toluene_kekule: {
    smiles: "CC1=CC=CC=C1",
    aliases: ["toluene kekule", "kekule toluene", "toluene resonance form"],
    default_role: "reactant",
  },
  phenol: { smiles: "Oc1ccccc1", aliases: ["phenol", "hydroxybenzene", "C6H5OH"], default_role: "reactant" },
  phenol_kekule: {
    smiles: "OC1=CC=CC=C1",
    aliases: ["phenol kekule", "kekule phenol", "phenol resonance form"],
    default_role: "reactant",
  },
  aniline: { smiles: "Nc1ccccc1", aliases: ["aniline", "aminobenzene", "C6H5NH2"], default_role: "product" },
  aniline_kekule: {
    smiles: "NC1=CC=CC=C1",
    aliases: ["aniline kekule", "kekule aniline", "aniline resonance form"],
    default_role: "reactant",
  },

  o_nitrotoluene: {
    smiles: "Cc1ccccc1[N+](=O)[O-]",
    aliases: ["ortho-nitrotoluene", "o-nitrotoluene", "2-nitrotoluene"],
    default_role: "product",
  },
  p_nitrotoluene: {
    smiles: "Cc1ccc(cc1)[N+](=O)[O-]",
    aliases: ["para-nitrotoluene", "p-nitrotoluene", "4-nitrotoluene"],
    default_role: "product",
  },

  methanal: { smiles: "C=O", aliases: ["formaldehyde", "methanal", "HCHO"], default_role: "product" },
  ethanal: { smiles: "CC=O", aliases: ["acetaldehyde", "ethanal", "CH3CHO"], default_role: "product" },

  ethene: { smiles: "C=C", aliases: ["ethene", "ethylene", "C2H4"], default_role: "reactant" },
  propene: { smiles: "CC=C", aliases: ["propene", "propylene", "C3H6"], default_role: "reactant" },

  ethylbenzene: { smiles: "CCc1ccccc1", aliases: ["ethylbenzene"], default_role: "product" },
  styrene: { smiles: "C=Cc1ccccc1", aliases: ["styrene", "vinylbenzene", "phenylethene"], default_role: "product" },
  cumene: { smiles: "CC(C)c1ccccc1", aliases: ["cumene", "isopropylbenzene"], default_role: "product" },
  o_xylene: { smiles: "Cc1ccccc1C", aliases: ["o-xylene", "ortho-xylene", "1,2-dimethylbenzene"], default_role: "product" },
  m_xylene: { smiles: "Cc1cccc(C)c1", aliases: ["m-xylene", "meta-xylene", "1,3-dimethylbenzene"], default_role: "product" },
  p_xylene: { smiles: "Cc1ccc(C)cc1", aliases: ["p-xylene", "para-xylene", "1,4-dimethylbenzene"], default_role: "product" },
  biphenyl: { smiles: "c1ccc(cc1)c2ccccc2", aliases: ["biphenyl", "diphenyl"], default_role: "product" },
  naphthalene: { smiles: "c1ccc2ccccc2c1", aliases: ["naphthalene", "C10H8"], default_role: "reactant" },
  anthracene: { smiles: "c1ccc2cc3ccccc3cc2c1", aliases: ["anthracene"], default_role: "reactant" },
  phenanthrene: { smiles: "c1ccc2c(c1)ccc3ccccc23", aliases: ["phenanthrene"], default_role: "reactant" },

  fluorobenzene: { smiles: "Fc1ccccc1", aliases: ["fluorobenzene", "C6H5F"], default_role: "product" },
  chlorobenzene: { smiles: "Clc1ccccc1", aliases: ["chlorobenzene", "C6H5Cl"], default_role: "product" },
  bromobenzene: { smiles: "Brc1ccccc1", aliases: ["bromobenzene", "C6H5Br"], default_role: "product" },
  iodobenzene: { smiles: "Ic1ccccc1", aliases: ["iodobenzene", "C6H5I"], default_role: "product" },

  anisole: { smiles: "COc1ccccc1", aliases: ["anisole", "methoxybenzene"], default_role: "reactant" },
  benzyl_alcohol: { smiles: "OCc1ccccc1", aliases: ["benzyl alcohol", "phenylmethanol"], default_role: "product" },
  benzaldehyde: { smiles: "O=Cc1ccccc1", aliases: ["benzaldehyde", "C6H5CHO"], default_role: "product" },
  benzoic_acid: { smiles: "O=C(O)c1ccccc1", aliases: ["benzoic acid", "C6H5COOH"], default_role: "product" },
  acetophenone: { smiles: "CC(=O)c1ccccc1", aliases: ["acetophenone", "methyl phenyl ketone"], default_role: "product" },
  benzophenone: { smiles: "O=C(c1ccccc1)c2ccccc2", aliases: ["benzophenone", "diphenyl ketone"], default_role: "product" },

  benzonitrile: { smiles: "N#Cc1ccccc1", aliases: ["benzonitrile", "cyanobenzene", "C6H5CN"], default_role: "product" },
  azobenzene: { smiles: "c1ccc(cc1)N=Nc2ccccc2", aliases: ["azobenzene"], default_role: "product" },
};

const smilesMap = { ...EXTRA_SMILES, ...baseSmilesMap };
const aliasToCanonical = new Map();
const smilesToCanonical = new Map();

for (const [canonical, info] of Object.entries(smilesMap)) {
  const canonicalKey = canonical.toLowerCase();
  aliasToCanonical.set(canonicalKey, canonical);

  if (typeof info?.smiles === "string" && info.smiles.trim()) {
    smilesToCanonical.set(info.smiles.trim(), canonical);
  }

  const aliases = Array.isArray(info?.aliases) ? info.aliases : [];
  for (const alias of aliases) {
    if (typeof alias === "string" && alias.trim()) {
      aliasToCanonical.set(alias.trim().toLowerCase(), canonical);
    }
  }
}

function getChemistryMaps() {
  return { smilesMap, aliasToCanonical, smilesToCanonical };
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
    note: "HSC idea: Phenol is strongly activating because O donates by +M (resonance) and directs electrophiles to ortho/para.",
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
  if (q.includes("aniline") || q.includes("aminobenzene") || q.includes("c6h5nh2")) return "aniline";
  if (q.includes("phenol") || q.includes("hydroxybenzene") || q.includes("c6h5oh")) return "phenol";
  if (q.includes("toluene") || q.includes("methylbenzene")) return "toluene";
  if (q.includes("benzene") || q.includes("c6h6")) return "benzene";
  return "";
}

function buildResonanceBlock(question) {
  if (!isResonanceRequest(question)) return null;
  const target = pickResonanceTarget(question);
  if (!target) return null;
  const entry = RESONANCE_LIBRARY[target];
  if (!entry) return null;

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
        products.push({ name, smiles: info.smiles, type: classifyProductType(sentence) });
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

function inferReagentPresets(question, answer) {
  const text = `${question || ""}\n${answer || ""}`.toLowerCase();
  const inferred = [];
  const push = (canonical) => {
    const info = smilesMap[canonical];
    if (info?.smiles) inferred.push({ name: canonical, smiles: info.smiles });
  };

  if (text.includes("nitration") || text.includes("nitro")) {
    push("nitric_acid");
    push("sulfuric_acid");
    return inferred;
  }
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
  if (text.includes("friedel") || text.includes("crafts")) {
    push("alcl3");
    return inferred;
  }
  if (text.includes("sulphonation") || text.includes("sulfonation")) {
    push("sulfuric_acid");
    return inferred;
  }
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

function sanitizeDiagramByQuestionAndInference(diagram, question, answer) {
  const allowedFromQuestion = extractAllowedCanonicalsFromQuestion(question);
  const inferredReagents = inferReagentPresets(question, answer);
  const inferredNames = new Set(inferredReagents.map((x) => x.name));

  const keepReactants = (arr) =>
    (Array.isArray(arr) ? arr : []).filter((m) => m && typeof m.name === "string" && allowedFromQuestion.has(m.name));

  const keepReagents = (arr) =>
    (Array.isArray(arr) ? arr : []).filter(
      (m) => m && typeof m.name === "string" && (allowedFromQuestion.has(m.name) || inferredNames.has(m.name))
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

  if (hasMethanal && !hasEthanal && typeof response.answer === "string") {
    response.answer = response.answer
      .replace(/\bacetaldehyde\b/gi, "methanal (formaldehyde)")
      .replace(/\bethanal\b/gi, "methanal (formaldehyde)")
      .replace(/\bCH3CHO\b/gi, "HCHO");
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

  const resonance = buildResonanceBlock(question);

  let out = {
    answer,
    diagram: finalDiagram,
    diagram_caption,
    mechanism_steps: [],
    resonance,
    contextUsed: Boolean(contextUsed),
    subject: "chemistry",
    category: "chemistry",
  };

  out = syncNarrativeWithDiagram(question, out);
  return out;
}

const CHEMISTRY_SYSTEM_PROMPT = `You are a chemistry tutor for students.

You must output ONLY valid JSON.

Schema:
{
  "answer": string,
  "diagram": {
    "reactants": [{ "name": string, "smiles": string }],
    "reagents": [{ "name": string, "smiles": string }],
    "conditions": string,
    "products": [{ "name": string, "smiles": string, "type": "major"|"minor"|"possible" }]
  },
  "diagram_caption": string,
  "resonance": null | {
    "target": string,
    "base": { "name": string, "smiles": string },
    "forms": [{ "name": string, "smiles": string }],
    "arrow_steps": [{ "step": number, "type": string, "desc": string }],
    "note": string
  },
  "contextUsed": boolean,
  "subject": "chemistry",
  "category": "chemistry"
}

Return ONLY JSON.`;

async function handleChemistryQuestion({
  question,
  context,
  callLlmWithProviderFallback,
  CHEMISTRY_SYSTEM_PROMPT: externalChemistrySystemPrompt,
  buildChemistryJsonResponse: externalBuildChemistryJsonResponse,
  buildResonanceBlock: externalBuildResonanceBlock,
}) {
  const systemPrompt = externalChemistrySystemPrompt || CHEMISTRY_SYSTEM_PROMPT;
  const buildChemResponse =
    typeof externalBuildChemistryJsonResponse === "function"
      ? externalBuildChemistryJsonResponse
      : buildChemistryJsonResponse;
  const buildResonance =
    typeof externalBuildResonanceBlock === "function"
      ? externalBuildResonanceBlock
      : buildResonanceBlock;

  if (!context || context.length < 100) {
    return {
      status: 200,
      body: {
        answer: "এই প্রশ্নের উত্তর বইয়ের তথ্য থেকে পাওয়া যায়নি। অনুগ্রহ করে অন্য প্রশ্ন করুন।",
        diagram: { reactants: [], reagents: [], conditions: "", products: [] },
        diagram_caption: "No diagram (no context).",
        mechanism_steps: [],
        resonance: buildResonance(question),
        contextUsed: false,
        subject: "chemistry",
        category: "chemistry",
      },
    };
  }

  const chemistryUserPrompt = `retrieved_context:\n${context}\n\nquestion:\n${question}\n\nReturn only valid JSON as per schema.`;
  const chemistryData = await callLlmWithProviderFallback([
    { role: "system", content: systemPrompt },
    { role: "user", content: chemistryUserPrompt },
  ]);

  if (chemistryData.error) {
    return { status: 500, body: { error: "AI সার্ভিসে সমস্যা হয়েছে" } };
  }

  const chemistryText = chemistryData?.choices?.[0]?.message?.content || "";
  const chemistryResponse = buildChemResponse(chemistryText, context, context.length > 0, question);
  return { status: 200, body: chemistryResponse };
}

module.exports = { getChemistryMaps, handleChemistryQuestion };
