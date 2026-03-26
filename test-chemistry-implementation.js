#!/usr/bin/env node
/**
 * IMPLEMENTATION TEST SUITE
 * Test the Chemistry AI Tutor response builder with sample LLM outputs
 * Run: node test-chemistry-implementation.js
 */

// Mock the SMILES map and language detection since we're testing independently
const mockSmilesMap = {
  benzene: { smiles: "c1ccccc1", svg_type: "benzene_ring" },
  nitrobenzene: { smiles: "c1cc(ccc1)[N+](=O)[O-]", svg_type: "nitrobenzene_structure" },
  phenol: { smiles: "Oc1ccccc1", svg_type: "phenol_structure" },
};

// Simulate helper functions (these come from ai.js)
function buildChemistryTags(isConversion, reactionType, topicKeywords, contextUsed, parsed) {
  const tags = ["Chemistry"];
  tags.push(isConversion ? "conversion" : "description");
  
  if (reactionType && typeof reactionType === "string") {
    const cleanType = reactionType.toLowerCase().replace(/_/g, " ");
    tags.push(cleanType);
  }
  
  // Extract keywords from parsed response if available
  if (parsed && typeof parsed === "object") {
    if (parsed.substrate_class && !tags.includes(parsed.substrate_class)) {
      tags.push(parsed.substrate_class.toLowerCase().replace(/_/g, " "));
    }
    if (parsed.related_concepts && Array.isArray(parsed.related_concepts)) {
      parsed.related_concepts.slice(0, 1).forEach(concept => {
        if (concept && !tags.includes(concept)) tags.push(concept);
      });
    }
  }
  
  if (topicKeywords && Array.isArray(topicKeywords)) {
    topicKeywords.slice(0, 2).forEach(kw => {
      if (kw && !tags.includes(kw)) tags.push(kw);
    });
  }
  
  if (contextUsed) tags.push("context used");
  
  return tags.slice(0, 6);
}

function buildChemistryOverview(parsed, isConversion) {
  if (!parsed) return { title: "", text: "" };
  
  const title = parsed.overview && typeof parsed.overview.title === "string" 
    ? parsed.overview.title.trim().slice(0, 100)
    : (isConversion ? "Reaction Overview" : "Concept Explanation");
    
  const text = parsed.overview && typeof parsed.overview.text === "string"
    ? parsed.overview.text.trim()
    : (parsed.answer ? String(parsed.answer).slice(0, 500) : "");
    
  return { title, text };
}

function buildChemistryReactionPathway(parsed, isConversion) {
  if (!isConversion || !parsed || !parsed.reaction_pathway) return null;
  
  const compounds = Array.isArray(parsed.reaction_pathway.compounds)
    ? parsed.reaction_pathway.compounds.map(c => ({
        name: c.name || "",
        role: c.role || "reactant",
        smiles: c.smiles || c.formula || "",
        svg_type: c.svg_type || "custom_structure",
        display_formula: c.display_formula || c.formula || ""
      }))
    : [];
    
  return { compounds };
}

function buildChemistrySteps(parsed, isConversion) {
  if (!parsed || !Array.isArray(parsed.steps)) return [];
  
  return parsed.steps.map((step, idx) => ({
    step_num: step.step_num || idx + 1,
    title: step.title || `Step ${idx + 1}`,
    subtitle: step.subtitle || "",
    description: step.description || step.desc || "",
    molecules: Array.isArray(step.molecules) ? step.molecules.map(m => ({
      name: m.name || "",
      role: m.role || "reactant",
      smiles: m.smiles || "",
      svg_type: m.svg_type || "custom_structure",
      formula: m.formula || ""
    })) : [],
    conditions: step.conditions || "",
    mechanism_type: step.mechanism_type || (isConversion ? "unknown" : "description_only")
  })).slice(0, 4);
}

function validateChemistryResponse(response) {
  const checks = [
    response.question_mode && (response.question_mode === "conversion" || response.question_mode === "description"),
    response.is_conversion === (response.question_mode === "conversion"),
    Array.isArray(response.tags) && response.tags.length >= 4 && response.tags.length <= 6,
    response.overview && typeof response.overview.text === "string" && response.overview.text.length > 50,
    Array.isArray(response.steps) && response.steps.length >= 1,
    Array.isArray(response.key_points) && response.key_points.length === 3,
    response.subject === "chemistry",
    response.category === "chemistry"
  ];
  
  return checks.every(c => c === true);
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

function buildChemistryJsonResponse(modelText, context, contextUsed, question, isConversionHint) {
  const parsed = safeParseJsonObject(modelText);

  const llmIsConversion =
    parsed && typeof parsed.is_conversion === "boolean"
      ? parsed.is_conversion
      : (parsed && parsed.question_mode === "conversion") || Boolean(isConversionHint);

  const isConversion = llmIsConversion;

  const question_mode = isConversion ? "conversion" : "description";
  
  const metadata = {
    reaction_type: parsed?.reaction_type || "unknown",
    substrate_class: parsed?.substrate_class || "",
    carbon_change: parsed?.carbon_change || "unknown",
    difficulty_level: parsed?.metadata?.difficulty_level || "intermediate",
    context_used: Boolean(contextUsed)
  };

  const tags = buildChemistryTags(isConversion, metadata.reaction_type, [], contextUsed, parsed);
  const overview = buildChemistryOverview(parsed, isConversion);
  const reaction_pathway = buildChemistryReactionPathway(parsed, isConversion);
  const steps = buildChemistrySteps(parsed, isConversion);

  const equations = (parsed?.equations || [])
    .filter(e => typeof e === "string" && e.trim())
    .slice(0, 3);

  const key_points = (parsed?.key_points || [])
    .filter(k => typeof k === "string" && k.trim())
    .slice(0, 3);
  
  while (key_points.length < 3) {
    key_points.push("Important point");
  }

  const related_concepts = (parsed?.related_concepts || [])
    .filter(c => typeof c === "string" && c.trim())
    .slice(0, 3);

  const response = {
    question_mode,
    is_conversion: isConversion,
    
    metadata,
    tags,
    overview,
    reaction_pathway,
    steps,
    
    equations,
    key_points,
    related_concepts,
    
    subject: "chemistry",
    category: "chemistry",
    
    answer: overview.text || "",
    contextUsed: metadata.context_used,
    detected_language: "english"
  };

  if (!validateChemistryResponse(response)) {
    console.warn("[WARN] Validation issues detected but returning response");
  }

  return response;
}

// ─────────────────────────────────────────────────────────────────
// TEST SUITE
// ─────────────────────────────────────────────────────────────────

const tests = [];

// TEST 1: CONVERSION Question (Benzene to Nitrobenzene)
tests.push({
  name: "CONVERSION: Benzene to Nitrobenzene",
  llmResponse: `{
    "is_conversion": true,
    "question_mode": "conversion",
    "reaction_type": "electrophilic_substitution",
    "substrate_class": "aromatic_hydrocarbon",
    "carbon_change": "none",
    "metadata": { "difficulty_level": "intermediate" },
    "overview": {
      "title": "Nitration of Benzene",
      "text": "Nitration is an electrophilic aromatic substitution reaction where the hydrogen atom on benzene is replaced by a nitro group. This is accomplished using a mixture of concentrated nitric acid and sulfuric acid. The sulfuric acid acts as a catalyst and protonates the nitric acid to form the nitronium ion (NO₂⁺), which is the actual electrophile. The reaction proceeds through a sigma-complex intermediate."
    },
    "reaction_pathway": {
      "compounds": [
        { "name": "benzene", "role": "reactant", "smiles": "c1ccccc1", "svg_type": "benzene_ring", "formula": "C₆H₆" },
        { "name": "nitrobenzene", "role": "product", "smiles": "c1cc(ccc1)[N+](=O)[O-]", "svg_type": "nitrobenzene_structure", "formula": "C₆H₅NO₂" }
      ]
    },
    "steps": [
      {
        "step_num": 1,
        "title": "Formation of Electrophile",
        "subtitle": "Nitronium ion generation",
        "description": "Concentrated nitric acid is protonated by sulfuric acid to form the nitronium ion (NO₂⁺), which is the electrophilic species.",
        "molecules": [],
        "conditions": "conc. H2SO4, conc. HNO3"
      },
      {
        "step_num": 2,
        "title": "Electrophilic Attack",
        "subtitle": "Formation of sigma complex",
        "description": "The benzene pi electrons attack the nitronium ion, forming a sigma complex (arenium ion) where the aromaticity is lost.",
        "molecules": [],
        "conditions": "heat"
      }
    ],
    "equations": ["C₆H₆ + HNO₃ → C₆H₅NO₂ + H₂O"],
    "key_points": ["Nitronium ion (NO₂⁺) is the true electrophile", "Sulfuric acid is a catalyst that facilitates electrophile formation", "The reaction is an electrophilic aromatic substitution"],
    "related_concepts": ["Benzene reactivity", "Electrophilic aromatic substitution", "Resonance stabilization"]
  }`,
  context: ["Some context about benzene nitration"],
  contextUsed: true,
  question: "How does benzene react with HNO3 to form nitrobenzene?",
  isConversionHint: true
});

// TEST 2: DESCRIPTION Question (Why is Phenol Acidic?)
tests.push({
  name: "DESCRIPTION: Why is Phenol Acidic?",
  llmResponse: `{
    "is_conversion": false,
    "question_mode": "description",
    "reaction_type": "acid_base_property",
    "substrate_class": "hydroxyl_compound",
    "carbon_change": "unknown",
    "metadata": { "difficulty_level": "intermediate" },
    "overview": {
      "title": "Acidity of Phenol",
      "text": "Phenol is acidic because the hydroxyl group (-OH) bonded to the aromatic ring experiences electron withdrawal by the pi system of the benzene ring. This inductive effect, combined with the resonance stabilization of the phenoxide anion, makes phenol significantly more acidic than aliphatic alcohols. The phenoxide ion is stabilized by distributing the negative charge across the aromatic ring through resonance structures."
    },
    "steps": [
      {
        "step_num": 1,
        "title": "Withdrawal of Electron Density",
        "subtitle": "Inductive effect",
        "description": "The benzene ring withdraws electron density from the oxygen atom, weakening the O-H bond and making the hydrogen more acidic.",
        "molecules": [{"name": "phenol", "role": "example", "smiles": "Oc1ccccc1", "svg_type": "phenol_structure"}],
        "mechanism_type": "description_only"
      },
      {
        "step_num": 2,
        "title": "Stabilization of Phenoxide Anion",
        "subtitle": "Resonance effect",
        "description": "The negative charge on the phenoxide ion is delocalized across the aromatic ring through resonance structures, making the anion stable and favoring ionization.",
        "molecules": [],
        "mechanism_type": "resonance_structure"
      }
    ],
    "equations": ["C₆H₅OH ⇌ C₆H₅O⁻ + H⁺"],
    "key_points": ["Phenol is more acidic than aliphatic alcohols due to resonance stabilization of the phenoxide anion", "The aromatic ring withdraws electron density from the oxygen, weakening the O-H bond", "Phenol has a pKa around 10, making it weakly acidic but much stronger than ethanol (pKa ~16)"],
    "related_concepts": ["Acidity and basicity", "Resonance stabilization", "Electron withdrawal"]
  }`,
  context: [],
  contextUsed: false,
  question: "Why is phenol acidic?",
  isConversionHint: false
});

// Run Tests
console.log("\n" + "=".repeat(70));
console.log("CHEMISTRY AI TUTOR - IMPLEMENTATION TEST SUITE");
console.log("=".repeat(70) + "\n");

let passCount = 0;
let failCount = 0;

tests.forEach((test, idx) => {
  console.log(`\n[TEST ${idx + 1}] ${test.name}`);
  console.log("-".repeat(70));
  
  try {
    const result = buildChemistryJsonResponse(
      test.llmResponse,
      test.context,
      test.contextUsed,
      test.question,
      test.isConversionHint
    );
    
    // Validation checks
    const isValid = validateChemistryResponse(result);
    const tagCheck = result.tags.length >= 4 && result.tags.length <= 6;
    const overviewCheck = result.overview.text.length > 50;
    const keyPointsCheck = result.key_points.length === 3;
    const stepsCheck = result.steps.length >= 1;
    const modeCheck = result.is_conversion === (result.question_mode === "conversion");
    
    console.log(`✓ Response generated successfully`);
    console.log(`  - question_mode: "${result.question_mode}"`);
    console.log(`  - is_conversion: ${result.is_conversion}`);
    console.log(`  - tags (${result.tags.length}): [${result.tags.join(", ")}]`);
    console.log(`  - overview.text length: ${result.overview.text.length} chars`);
    console.log(`  - steps: ${result.steps.length} steps`);
    console.log(`  - key_points: ${result.key_points.length} items`);
    console.log(`  - related_concepts: ${result.related_concepts.length} items`);
    console.log(`  - reaction_pathway: ${result.reaction_pathway ? "populated" : "null"}`);
    
    console.log(`\n  Validation Checks:`);
    console.log(`  ${tagCheck ? "✓" : "✗"} Tags count: ${result.tags.length} (expected 4-6)`);
    console.log(`  ${overviewCheck ? "✓" : "✗"} Overview length: ${result.overview.text.length} (expected >50)`);
    console.log(`  ${keyPointsCheck ? "✓" : "✗"} Key points: ${result.key_points.length} (expected exactly 3)`);
    console.log(`  ${stepsCheck ? "✓" : "✗"} Steps: ${result.steps.length} (expected ≥1)`);
    console.log(`  ${modeCheck ? "✓" : "✗"} Mode consistency: is_conversion=${result.is_conversion}, question_mode="${result.question_mode}"`);
    console.log(`  ${isValid ? "✓" : "✗"} Overall validation: ${isValid ? "PASS" : "FAIL"}`);
    
    if (tagCheck && overviewCheck && keyPointsCheck && stepsCheck && modeCheck && isValid) {
      console.log(`\n✅ TEST PASSED`);
      passCount++;
    } else {
      console.log(`\n❌ TEST FAILED - Some checks did not pass`);
      failCount++;
    }
  } catch (err) {
    console.log(`❌ ERROR: ${err.message}`);
    failCount++;
  }
});

// Summary
console.log("\n" + "=".repeat(70));
console.log("SUMMARY");
console.log("=".repeat(70));
console.log(`Passed: ${passCount}/${tests.length}`);
console.log(`Failed: ${failCount}/${tests.length}`);
console.log(`Status: ${failCount === 0 ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}`);
console.log("=".repeat(70) + "\n");

process.exit(failCount === 0 ? 0 : 1);
