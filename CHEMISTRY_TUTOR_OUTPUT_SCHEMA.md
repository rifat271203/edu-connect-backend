# Chemistry AI Tutor — Frontend Output Format & Schema

## 📐 Complete JSON Response Schema

This is the **exact structure** your frontend should expect and consume from the backend.

```json
{
  "question_mode": "conversion | description",
  "is_conversion": true | false,
  
  "metadata": {
    "reaction_type": "aromatic_substitution | oxidation | addition | elimination | etc",
    "substrate_class": "aromatic | aliphatic | alkene | alcohol | etc",
    "carbon_change": "carbon_increase | carbon_decrease | carbon_same | unknown",
    "difficulty_level": "basic | intermediate | advanced",
    "context_used": true | false
  },

  "tags": [
    "Chemistry",
    "conversion",
    "aromatic substitution",
    "oxidation",
    "context used"
  ],

  "overview": {
    "title": "optional brief title",
    "text": "8-14 sentence paragraph explaining the overall concept, strategy, and key points"
  },

  "reaction_pathway": {
    "diagram": "linear flow showing compound → compound → compound",
    "compounds": [
      {
        "name": "benzene",
        "role": "reactant",
        "smiles": "c1ccccc1",
        "svg_type": "benzene_ring" | "generic_aromatic" | "structure_custom",
        "display_formula": "C₆H₆"
      },
      {
        "name": "methyl chloride",
        "role": "reagent",
        "formula": "CH₃Cl",
        "display_formula": "CH₃Cl"
      },
      {
        "name": "toluene",
        "role": "intermediate",
        "smiles": "Cc1ccccc1",
        "svg_type": "benzene_ring_with_methyl",
        "display_formula": "C₇H₈"
      },
      {
        "name": "potassium permanganate",
        "role": "oxidizing_agent",
        "formula": "KMnO₄",
        "shorthand": "KMnO₄"
      },
      {
        "name": "benzoic acid",
        "role": "product",
        "smiles": "O=C(O)c1ccccc1",
        "svg_type": "benzoic_acid",
        "display_formula": "C₇H₆O₂"
      }
    ]
  },

  "steps": [
    {
      "step_num": 1,
      "title": "Friedel–Crafts Alkylation",
      "subtitle": "Benzene → Toluene",
      "description": "Benzene reacts with methyl chloride (CH₃Cl) in the presence of aluminium chloride (AlCl₃) as a Lewis acid catalyst. The catalyst generates an electrophilic methyl carbocation (CH₃⁺), which then attacks the benzene ring via electrophilic aromatic substitution to produce toluene.",
      "molecules": [
        { "name": "benzene", "role": "reactant", "smiles": "c1ccccc1", "svg_type": "benzene_ring" },
        { "name": "methyl chloride / AlCl₃", "role": "reagent", "formula": "CH₃Cl / AlCl₃" },
        { "name": "toluene", "role": "product", "smiles": "Cc1ccccc1", "svg_type": "benzene_ring_with_methyl" }
      ],
      "conditions": "room temperature or mild heating",
      "mechanism_type": "electrophilic_aromatic_substitution",
      "mechanism_explanation": "Long detailed mechanism explanation if conversion mode"
    },
    {
      "step_num": 2,
      "title": "Oxidation of Toluene",
      "subtitle": "Toluene → Benzoic acid",
      "description": "Toluene is oxidised using potassium permanganate (KMnO₄) under acidic or neutral conditions with heating. The methyl group (–CH₃) is fully oxidised to a carboxylic acid group (–COOH).",
      "molecules": [
        { "name": "toluene", "role": "reactant", "smiles": "Cc1ccccc1", "svg_type": "benzene_ring_with_methyl" },
        { "name": "KMnO₄ / H⁺", "role": "reagent", "formula": "KMnO₄ / H⁺" },
        { "name": "benzoic acid", "role": "product", "smiles": "O=C(O)c1ccccc1", "svg_type": "benzoic_acid" }
      ],
      "conditions": "heating, acidic medium",
      "mechanism_type": "oxidation",
      "mechanism_explanation": "Optional mechanism details"
    }
  ],

  "equations": [
    "C₆H₆ + CH₃Cl → C₇H₈ + HCl (Friedel–Crafts alkylation)",
    "C₇H₈ + 2KMnO₄ + 3H₂SO₄ → C₇H₆O₂ + K₂SO₄ + 2MnSO₄ + 4H₂O (oxidation)"
  ],

  "key_points": [
    "Friedel–Crafts alkylation is stopped after one alkylation because toluene is more activated than benzene",
    "Strong oxidising agents like KMnO₄ convert ANY alkyl side-chain to –COOH (full oxidation)",
    "This is a good preparative route for aromatic carboxylic acids from benzene derivatives"
  ],

  "warning_or_tip": "Optional: Common student mistake — using weak oxidising agents like Cr₂O₇²⁻ won't fully oxidise the methyl group",

  "related_concepts": [
    "Electrophilic aromatic substitution",
    "Lewis acid catalysis",
    "Oxidation of alkyl groups",
    "Friedel–Crafts reaction"
  ],

  "subject": "chemistry",
  "category": "chemistry"
}
```

---

## 🎯 CONVERSION MODE - Full Example

```json
{
  "question_mode": "conversion",
  "is_conversion": true,
  
  "metadata": {
    "reaction_type": "aromatic_substitution_oxidation",
    "substrate_class": "aromatic",
    "carbon_change": "carbon_same",
    "difficulty_level": "intermediate",
    "context_used": true
  },

  "tags": [
    "Chemistry",
    "conversion",
    "aromatic substitution",
    "oxidation",
    "Friedel–Crafts",
    "context used"
  ],

  "overview": {
    "title": "Benzene to Benzoic Acid Synthesis",
    "text": "Benzene can be converted to benzoic acid through a **two-step process**. First, benzene undergoes **Friedel–Crafts alkylation** using methyl chloride and AlCl₃ as catalyst to form toluene (methylbenzene). The strong Lewis acid AlCl₃ activates the CH₃Cl, generating a methyl carbocation that attacks the benzene ring in an electrophilic aromatic substitution. Then, toluene is **oxidised to benzoic acid** using potassium permanganate (KMnO₄) under heating in acidic conditions. The methyl group is completely oxidised to a carboxylic acid group (–COOH), yielding benzoic acid after acidification. This route bypasses the direct halogenation-oxidation path and is experimentally reliable for HSC-level chemistry."
  },

  "reaction_pathway": {
    "compounds": [
      {
        "name": "benzene",
        "role": "reactant",
        "smiles": "c1ccccc1",
        "svg_type": "benzene_ring",
        "display_formula": "C₆H₆"
      },
      {
        "name": "methyl chloride",
        "role": "reagent",
        "formula": "CH₃Cl",
        "display_formula": "CH₃Cl"
      },
      {
        "name": "toluene",
        "role": "intermediate",
        "smiles": "Cc1ccccc1",
        "svg_type": "benzene_ring_with_methyl",
        "display_formula": "C₇H₈"
      },
      {
        "name": "potassium permanganate",
        "role": "oxidizing_agent",
        "formula": "KMnO₄",
        "shorthand": "KMnO₄"
      },
      {
        "name": "benzoic acid",
        "role": "product",
        "smiles": "O=C(O)c1ccccc1",
        "svg_type": "benzoic_acid",
        "display_formula": "C₇H₆O₂"
      }
    ]
  },

  "steps": [
    {
      "step_num": 1,
      "title": "Friedel–Crafts Alkylation",
      "subtitle": "Benzene → Toluene",
      "description": "Benzene reacts with methyl chloride (CH₃Cl) in the presence of aluminium chloride (AlCl₃) as a Lewis acid catalyst. The catalyst accepts the chloride from CH₃Cl, leaving a methyl carbocation (CH₃⁺) — the electrophile. This carbocation attacks the π-electrons of the benzene ring, forming a sigma complex (arenium ion). Loss of a proton restores aromaticity, yielding toluene. The reaction is highly selective for monosubstitution because AlCl₃ complexes with the product toluene, deactivating it toward further reaction.",
      "molecules": [
        { "name": "benzene", "role": "reactant", "smiles": "c1ccccc1", "svg_type": "benzene_ring" },
        { "name": "CH₃Cl / AlCl₃", "role": "reagent", "formula": "CH₃Cl / AlCl₃", "svg_type": "reagent_text" },
        { "name": "toluene", "role": "product", "smiles": "Cc1ccccc1", "svg_type": "benzene_ring_with_methyl" }
      ],
      "conditions": "room temperature or mild heating",
      "mechanism_type": "electrophilic_aromatic_substitution"
    },
    {
      "step_num": 2,
      "title": "Oxidation of Toluene",
      "subtitle": "Toluene → Benzoic acid",
      "description": "Toluene is oxidised using potassium permanganate (KMnO₄) in the presence of dilute acid (or neutral water) and heat. Strong oxidising agents attack the benzylic C–H bonds of the methyl group. The –CH₃ is progressively oxidised through intermediates (–CH₂OH → –CHO → –COOH). The carboxylic acid is the thermodynamic end-product because it cannot be oxidised further under mild conditions. Heating accelerates the oxidation.",
      "molecules": [
        { "name": "toluene", "role": "reactant", "smiles": "Cc1ccccc1", "svg_type": "benzene_ring_with_methyl" },
        { "name": "KMnO₄ / H⁺ / Δ", "role": "reagent", "formula": "KMnO₄ / H⁺ / Δ", "svg_type": "reagent_text" },
        { "name": "benzoic acid", "role": "product", "smiles": "O=C(O)c1ccccc1", "svg_type": "benzoic_acid" }
      ],
      "conditions": "heating, dilute acid, sunlight optional (not required)",
      "mechanism_type": "oxidation_benzylic"
    }
  ],

  "equations": [
    "C₆H₆ + CH₃Cl —[AlCl₃]→ C₇H₈ + HCl  (Friedel–Crafts alkylation)",
    "C₇H₈ + 2KMnO₄ + 3H₂SO₄ —[Δ]→ C₇H₆O₂ + K₂SO₄ + 2MnSO₄ + 4H₂O  (oxidation)"
  ],

  "key_points": [
    "AlCl₃ acts as a Lewis acid throughout — it leaves the reaction as a complex salt AlCl₃•C₇H₈, which prevents over-alkylation.",
    "Benzoic acid (–COOH) cannot be further oxidised under these conditions; it is the thermodynamic sink.",
    "This is a two-step synthesis and is preferred over one-step routes because it achieves selective C-substitution at specific carbon."
  ],

  "related_concepts": [
    "Electrophilic aromatic substitution",
    "Lewis acid-base catalysis",
    "Benzylic oxidation",
    "Friedel–Crafts reaction variants",
    "Carboxylic acid preparation"
  ],

  "subject": "chemistry",
  "category": "chemistry"
}
```

---

## 📖 DESCRIPTION MODE - Full Example

```json
{
  "question_mode": "description",
  "is_conversion": false,
  
  "metadata": {
    "reaction_type": "conceptual_theory",
    "substrate_class": "phenol",
    "carbon_change": "unknown",
    "difficulty_level": "intermediate",
    "context_used": true
  },

  "tags": [
    "Chemistry",
    "description",
    "phenol",
    "acidity",
    "resonance",
    "context used"
  ],

  "overview": {
    "title": "Why is Phenol Acidic?",
    "text": "Phenol (C₆H₅OH) is **significantly more acidic** than typical aliphatic alcohols (like ethanol), with a pKa ≈ 10. This unusual acidity arises from the **resonance stabilisation** of the phenoxide anion (C₆H₅O⁻). When phenol loses a proton, the resulting negative charge on the oxygen delocalises into the aromatic π-electron system through resonance structures. This delocalization spreads the negative charge across multiple atoms (the ortho and para carbons of the ring), making the anion much more stable than it would be if the charge were localised solely on the oxygen. In contrast, the alkoxide of an alcohol (R–O⁻) cannot delocalise the charge because the carbon is sp³-hybridised and not part of a conjugated π-system. Therefore, phenoxide anions are much more stable than alkoxide anions, making phenols easier to deprotonate."
  },

  "reaction_pathway": null,

  "steps": [
    {
      "step_num": 1,
      "title": "Phenol Deprotonation",
      "subtitle": "Formation of Phenoxide Anion",
      "description": "When phenol (C₆H₅OH) reacts with a strong base (e.g., NaOH), the O–H proton is easily removed because the resulting phenoxide anion is resonance-stabilised. The negative charge on the oxygen can shift into the aromatic ring, creating resonance structures where the negative charge sits on the ortho and para carbons.",
      "molecules": [
        { "name": "phenol", "role": "acid", "smiles": "Oc1ccccc1", "svg_type": "phenol_structure" },
        { "name": "NaOH", "role": "base", "formula": "NaOH" },
        { "name": "phenoxide", "role": "conjugate_base", "smiles": "[O-]c1ccccc1", "svg_type": "phenoxide_resonance" }
      ],
      "mechanism_type": "description_only"
    },
    {
      "step_num": 2,
      "title": "Resonance Stabilisation",
      "subtitle": "Charge Delocalisation in Phenoxide",
      "description": "The phenoxide anion (~180 pm resonance structures) delocalises the negative charge across the oxygen, and the ortho/para positions on the benzene ring. This spatial spread of electron density lowers the energy of the anion, making it more stable. Contrast this to alkoxide anions (R–O⁻), which cannot form resonance structures because alkyl groups are sp³-hybridised and not conjugated with π-systems.",
      "molecules": [
        { "name": "phenoxide (resonance A)", "role": "resonance", "smiles": "[O-]c1ccccc1" },
        { "name": "phenoxide (resonance B — o-anionic)", "role": "resonance", "svg_type": "phenoxide_resonance_ortho" },
        { "name": "phenoxide (resonance C — p-anionic)", "role": "resonance", "svg_type": "phenoxide_resonance_para" }
      ],
      "mechanism_type": "description_only"
    }
  ],

  "equations": [
    "C₆H₅OH + NaOH → C₆H₅ONa + H₂O  (phenol + sodium hydroxide)",
    "C₆H₅OH + H₂O ⇌ C₆H₅O⁻ + H₃O⁺  (phenol ionisation equilibrium, pKa ≈ 10)"
  ],

  "key_points": [
    "Phenol is acidic (pKa ≈ 10) because the phenoxide anion is resonance-stabilised; charge delocalises into the aromatic ring.",
    "Aliphatic alcohols (pKa ≈ 16) are much weaker acids because their alkoxide ions cannot delocalise the negative charge.",
    "Phenol reacts readily with strong bases (NaOH, Na₂CO₃) but NOT with weak bases (NaHCO₃) — use this test to distinguish phenols from carboxylic acids."
  ],

  "warning_or_tip": "Common mistake: Students think phenol is acidic because of the –OH group alone. The key is that –OH groups attached to sp² carbons (aromatic or carbonyl) are more acidic than those on sp³ carbons.",

  "related_concepts": [
    "Resonance structures",
    "Conjugation",
    "Electron delocalisation",
    "pKa and acid strength",
    "Distinction: phenol vs carboxylic acid vs alcohol"
  ],

  "subject": "chemistry",
  "category": "chemistry"
}
```

---

## 🎨 SVG Type Hints for Frontend

When rendering molecules, use these `svg_type` hints to select the appropriate SVG template:

```json
{
  "svg_types": {
    "benzene_ring": "Hexagon with resonance circle inside (aromatic)",
    "benzene_ring_with_methyl": "Benzene ring with methyl group (–CH₃) attached",
    "benzene_ring_with_oh": "Benzene ring with –OH (phenol)",
    "benzene_ring_with_nh2": "Benzene ring with –NH₂ (aniline)",
    "benzene_ring_with_no2": "Benzene ring with –NO₂ (nitrobenzene)",
    "benzene_ring_with_cooh": "Benzene ring with –COOH (benzoic acid)",
    "benzoic_acid": "Benzene ring + –COOH group",
    "phenol_structure": "Benzene ring + –OH",
    "phenoxide_resonance": "Show multiple resonance forms",
    "phenoxide_resonance_ortho": "Phenoxide with negative on ortho carbon",
    "phenoxide_resonance_para": "Phenoxide with negative on para carbon",
    "ethene": "C=C double bond",
    "ethyne": "C≡C triple bond",
    "ethanol": "CH₃CH₂OH",
    "acetone": "CH₃COCH₃",
    "reagent_text": "Just display reagent formula as text (not graphical)"
  }
}
```

---

## 🔗 Frontend Integration Checklist

```javascript
// PSEUDO-CODE for frontend integration

const response = await fetch('/api/ai/ask', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    question: userQuestion,
    subject: 'chemistry'
  })
});

const data = await response.json();

// Render overview
document.querySelector('.overview-card').innerHTML = `
  <strong>${data.overview.title}</strong><br>${data.overview.text}
`;

// Render tags
const tagRow = document.querySelector('.tag-row');
tagRow.innerHTML = data.tags.map(tag => 
  `<span class="tag tag-primary">${tag}</span>`
).join('');

// Render reaction pathway
if (data.reaction_pathway) {
  // Build linear flow diagram from data.reaction_pathway.compounds
  renderReactionDiagram(data.reaction_pathway);
}

// Render steps
data.steps.forEach((step, i) => {
  const stepCard = createStepCard(step);
  document.querySelector('.steps-container').appendChild(stepCard);
});

// Render key points
document.querySelector('.key-points').innerHTML = data.key_points
  .map(pt => `<li>${pt}</li>`)
  .join('');

// Handle CONVERSION vs DESCRIPTION mode
if (data.is_conversion) {
  // Show: reaction diagram, mechanism steps, equations
  showElement('.reaction-diagram');
  showElement('.equations-section');
} else {
  // Hide: mechanism details
  hideElement('.mechanism-steps');
}
```

---

## ✅ Validation Checklist for Backend

When generating AI response, verify:

- [ ] `question_mode` is either "conversion" or "description"
- [ ] `is_conversion` matches `question_mode`
- [ ] `tags` array has 4-6 tags
- [ ] `overview.text` is 8-14 sentences
- [ ] All `steps` have `step_num` (1, 2, 3...)
- [ ] All molecule entries have `smiles` OR `formula` (never empty)
- [ ] `equations` array has 1-3 chemical equations
- [ ] `key_points` array has exactly 3 items
- [ ] `svg_type` matches one of the predefined types
- [ ] For CONVERSION: `reaction_pathway` is populated & `steps.length >= 2`
- [ ] For DESCRIPTION: `steps.length <= 3` and mechanism_type = "description_only"
- [ ] No markdown syntax in response (plain text only in descriptions)
- [ ] `subject` = "chemistry" and `category` = "chemistry"

---

## 🚀 Quick Reference: What to Show Where

| Element | Conversion | Description |
|---------|-----------|-------------|
| Overview | ✅ Main strategy | ✅ Concept explanation |
| Reaction Pathway | ✅ Show full flow | ❌ Hide or minimal |
| Steps | ✅ 2-4 mechanism steps | ✅ 1-3 concept steps |
| Equations | ✅ 1-3 reactions | ✅ 0-2 supporting equations |
| Key Points | ✅ Reaction tips | ✅ Conceptual insights |
| Molecules | ✅ Multiple compounds | ✅ Key structures only |

