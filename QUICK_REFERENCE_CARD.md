# Chemistry AI Tutor — Visual Reference Card

## 🎯 At a Glance

Your beautiful UI needs **exactly this JSON structure** from the backend AI.

---

## 📊 Two Modes Explained

```
┌─────────────────────────────────────────┬─────────────────────────────────────────┐
│        CONVERSION MODE                  │       DESCRIPTION MODE                  │
├─────────────────────────────────────────┼─────────────────────────────────────────┤
│ Example: "Benzene to benzoic acid"      │ Example: "Why is phenol acidic?"        │
├─────────────────────────────────────────┼─────────────────────────────────────────┤
│                                         │                                         │
│ is_conversion: true                     │ is_conversion: false                    │
│ question_mode: "conversion"             │ question_mode: "description"            │
│                                         │                                         │
│ ✅ Overview (8-14 sentences)           │ ✅ Overview (10-18 sentences)          │
│ ✅ Reaction Pathway (shows flow)       │ ❌ No reaction pathway                  │
│ ✅ Steps (2-4 mechanism steps)         │ ✅ Steps (1-3 concept steps)            │
│ ✅ Equations (1-3)                     │ ✅ Equations (0-2 optional)             │
│ ✅ Key Points (reaction tips)          │ ✅ Key Points (conceptual insights)     │
│ ✅ Molecules (multiple shown)          │ ✅ Molecules (essential only)           │
│                                         │                                         │
│ Tags: [Chemistry, conversion, ...]     │ Tags: [Chemistry, description, ...]     │
│                                         │                                         │
└─────────────────────────────────────────┴─────────────────────────────────────────┘
```

---

## 🏗️ JSON Structure Template

```json
{
  ┌─ REQUIRED FIELDS ─────────────────────────────────────────────┐
  │                                                                │
  "is_conversion": true/false,                                   │
  "question_mode": "conversion" | "description",                │
                                                                │
  "metadata": {                                                 │
    "reaction_type": "aromatic_substitution | oxidation | ..." │
    "substrate_class": "aromatic | aliphatic | alkene | ...",   │
    "carbon_change": "carbon_increase | carbon_decrease | same", │
    "difficulty_level": "basic | intermediate | advanced",      │
    "context_used": true/false                                  │
  },                                                             │
                                                                │
  "tags": ["Chemistry", "conversion/description", ...],        │
                                                                │
  "overview": {                                                 │
    "title": "Brief Title",                                     │
    "text": "Main 8-14 or 10-18 sentence explanation"           │
  },                                                             │
                                                                │
  └──────────────────────────────────────────────────────────────┘

  ┌─ CONDITIONAL FIELDS ──────────────────────────────────────────┐
  │                                                               │
  "reaction_pathway": {                                          │
    "compounds": [                                               │
      {                                                          │
        "name": "benzene",                                       │
        "role": "reactant | reagent | intermediate | product",   │
        "smiles": "c1ccccc1",                                    │
        "svg_type": "[see SVG types below]",                     │
        "display_formula": "C₆H₆"                               │
      }                                                          │
    ]                                                            │
  },  // ← ONLY FOR CONVERSION (null for description)            │
                                                                │
  └──────────────────────────────────────────────────────────────┘

  ┌─ REQUIRED FIELD (BOTH MODES) ────────────────────────────────┐
  │                                                               │
  "steps": [                                                     │
    {                                                            │
      "step_num": 1, 2, 3, ...,                                 │
      "title": "Action Title",                                  │
      "subtitle": "Reactant → Product",                         │
      "description": "2-4 sentence explanation",                │
      "molecules": [                                            │
        {                                                        │
          "name": "benzene",                                     │
          "role": "reactant | reagent | product",               │
          "smiles": "c1ccccc1",                                 │
          "svg_type": "[see SVG types]"                         │
        }                                                        │
      ],                                                         │
      "conditions": "heating, conc. H2SO4",                     │
      "mechanism_type": "electrophilic_aromatic_substitution"   │
    }                                                            │
  ],                                                             │
                                                                │
  └──────────────────────────────────────────────────────────────┘

  ┌─ OPTIONAL & CLOSING FIELDS ───────────────────────────────────┐
  │                                                               │
  "equations": [                                                 │
    "C₆H₆ + HNO₃ → C₆H₅NO₂ + H₂O"                              │
  ],                                                             │
                                                                │
  "key_points": [                                               │
    "Tip 1: ...",                                               │
    "Tip 2: ...",                                               │
    "Tip 3: ..."                                                │
  ],                                                             │
                                                                │
  "related_concepts": [                                         │
    "Concept 1",                                                │
    "Concept 2"                                                 │
  ],                                                             │
                                                                │
  "subject": "chemistry",                                       │
  "category": "chemistry"                                       │
                                                                │
  └──────────────────────────────────────────────────────────────┘
}
```

---

## 🎨 SVG Types & Visual Guide

```
┌─────────────────────────────┬───────────────────────────────────────────┐
│ SVG Type                    │ Display                                   │
├─────────────────────────────┼───────────────────────────────────────────┤
│ benzene_ring                │ Hexagon with resonance circle             │
│ benzene_ring_with_methyl    │ Benzene ring + CH₃ side chain             │
│ benzene_ring_with_oh        │ Benzene ring + OH group                   │
│ benzene_ring_with_nh2       │ Benzene ring + NH₂ group                  │
│ benzene_ring_with_no2       │ Benzene ring + NO₂ group                  │
│ benzene_ring_with_cooh      │ Benzene ring + COOH group                 │
│ benzoic_acid                │ Full benzoic acid structure                │
│ phenol_structure            │ Phenol (benzene + OH)                     │
│ phenoxide_resonance         │ Multiple resonance forms                  │
│ phenoxide_resonance_ortho   │ Phenoxide with negative on ortho C        │
│ phenoxide_resonance_para    │ Phenoxide with negative on para C         │
│ ethene                      │ C=C double bond                           │
│ ethyne                      │ C≡C triple bond                           │
│ ethanol                     │ CH₃CH₂OH structure                        │
│ acetone                     │ CH₃COCH₃ structure                        │
│ reagent_text                │ Just display formula as text (no drawing) │
│ custom_structure            │ Use SMILES or describe in text            │
└─────────────────────────────┴───────────────────────────────────────────┘
```

---

## 🎯 Frontend Rendering Checklist

```
AI Response Received
    ↓
┌─────────────────────────────────────────────┐
│ Render Overview Card                        │
│ • Show title in bold                        │
│ • Display full paragraph text               │
│ • Convert **bold** to <strong> tags         │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ Render Tag Row                              │
│ • "Chemistry" → tag-primary                 │
│ • Others → tag-secondary                    │
│ • Total: 4-6 tags                           │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ IF is_conversion = true:                    │
│ • Render Reaction Pathway Diagram           │
│ • Show compounds → reagents → products      │
│ • Use svg_type to draw molecules            │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ Render Steps (expandable cards)             │
│ • Step 1-2-3... (auto-number)              │
│ • Title + Subtitle                          │
│ • Description text                          │
│ • Molecule cards (if available)             │
│ • Expand first step by default              │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ IF equations.length > 0:                    │
│ • Render Equations Section                  │
│ • Display each equation in monospace font   │
│ • Use unicode subscripts (H₂SO₄)            │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ Render Key Points (bulleted list)           │
│ • Always exactly 3 points                   │
│ • Color: var(--text2)                       │
│ • Font size: 14px                           │
└─────────────────────────────────────────────┘
    ↓
Display Complete ✅
```

---

## 🔍 Validation Flow

```
┌─ LLM Generates Response ──────────┐
│                                   │
│ ✓ Valid JSON format              │
│ ✓ All required fields present    │
│ ✓ question_mode matches boolean  │
│ ✓ tags: 4-6 items               │
│ ✓ overview: 8-18 sentences      │
│ ✓ steps: 1-4 items (correct for mode) │
│ ✓ key_points: exactly 3         │
│ ✓ All molecules have SMILES/formula │
│ ✓ svg_types from approved list  │
│                                   │
└─ PASS? → Return to Frontend ─────┘
     ↓ FAIL
└─ Log error, return partial response
```

---

## 📡 API Request/Response Flow

```
┌───────────────────────────────────────────────────────────────┐
│ FRONTEND SENDS                                                │
├───────────────────────────────────────────────────────────────┤
│ POST /api/ai/ask                                             │
│ Header: Authorization: Bearer {token}                        │
│ Body: {                                                      │
│   "question": "benzene to nitrobenzene",                    │
│   "subject": "chemistry"  (optional, auto-detected)          │
│ }                                                            │
└───────────────────────────────────────────────────────────────┘
              ↓ (Gemini API processes question)
┌───────────────────────────────────────────────────────────────┐
│ BACKEND SENDS BACK                                            │
├───────────────────────────────────────────────────────────────┤
│ 200 OK                                                       │
│ {                                                            │
│   "is_conversion": true,                                     │
│   "question_mode": "conversion",                             │
│   "metadata": {...},                                         │
│   "tags": [...],                                             │
│   "overview": {...},                                         │
│   "reaction_pathway": {...},                                 │
│   "steps": [...],                                            │
│   "equations": [...],                                        │
│   "key_points": [...],                                       │
│   "subject": "chemistry",                                    │
│   "category": "chemistry"                                    │
│ }                                                            │
└───────────────────────────────────────────────────────────────┘
              ↓ (Frontend renders with renderAIResponse())
┌───────────────────────────────────────────────────────────────┐
│ USER SEES                                                     │
├───────────────────────────────────────────────────────────────┤
│ ✨ Beautiful formatted AI tutor response                      │
│ • Overview with explanation                                  │
│ • Tags showing mode & context                                │
│ • Reaction diagram showing compounds                         │
│ • Expandable mechanism steps                                 │
│ • Chemical equations                                         │
│ • Key teaching points                                        │
│ • Molecule structures with SVG                              │
└───────────────────────────────────────────────────────────────┘
```

---

## 🔑 Key Values Reference

```javascript
// reaction_type options
"aromatic_substitution"
"oxidation"
"addition"
"elimination"
"reduction"
"acid_base"
"esterification"
"polymerization"
"rearrangement"
"conceptual_theory"

// substrate_class options
"aromatic"
"aliphatic"
"alkene"
"alkyne"
"alcohol"
"aldehyde"
"ketone"
"carboxylic_acid"
"ester"
"amine"
"halide"

// carbon_change options
"carbon_increase"
"carbon_decrease"
"carbon_same"
"unknown"

// difficulty_level options
"basic"
"intermediate"
"advanced"

// role options (for compounds)
"reactant"
"reagent"
"catalyst"
"intermediate"
"product"
"oxidizing_agent"
"reducing_agent"

// mechanism_type options
"electrophilic_aromatic_substitution"
"nucleophilic_substitution"
"addition"
"elimination"
"oxidation"
"reduction"
"condensation"
"description_only"
```

---

## 📋 Tag Format Examples

```
CONVERSION MODE EXAMPLES:
  ["Chemistry", "conversion", "aromatic_substitution", "oxidation", "context used"]
  ["Chemistry", "conversion", "friedel_crafts", "alkylation"]
  ["Chemistry", "conversion", "addition", "alkene"]

DESCRIPTION MODE EXAMPLES:
  ["Chemistry", "description", "phenol", "acidity", "resonance", "context used"]
  ["Chemistry", "description", "aromaticity", "structure"]
  ["Chemistry", "description", "acid_base", "pKa"]
```

---

## 🚨 Common Errors & Fixes

```
ERROR                           │ CAUSE                    │ FIX
────────────────────────────────┼──────────────────────────┼──────────────────
Response not parsing           │ Invalid JSON            │ Use JSONLint to validate
Molecules not rendering        │ svg_type not found      │ Check against approved list
Steps not expanding            │ Missing toggleStep()    │ Add toggle function
Blank overview                 │ No overview object      │ Verify response schema
Tags showing duplicates        │ Tags array has dupes    │ Deduplicate in backend
Mobile layout broken           │ Large molecules         │ Reduce SVG size on mobile
Bangla text appears corrupted   │ Encoding issue         │ Use UTF-8 encoding
```

---

## ✅ Quality Assurance

```
Before Publishing:
□ Test with 5 questions per mode (10 total)
□ Check all molecules render
□ Verify step expand/collapse works
□ Test on mobile & desktop
□ Validate JSON for all responses
□ Check Bangla encoding
□ Verify equations display correctly
□ Test equation copying
□ Check loading state
□ Test error messages

Performance:
□ Page load < 2 seconds
□ Response from AI < 10 seconds
□ No memory leaks
□ SVG render smooth
□ Chat area scrolls smoothly
```

---

## 📞 Quick Troubleshoot

| Symptom | Check |
|---------|-------|
| Nothing appears after sending | Network request in DevTools |
| Only overview shows | Verify steps array exists |
| Molecules appear as blank boxes | Check svg_type valid |
| Bangla appears as boxes | Check UTF-8 header |
| Step cards don't toggle | Verify CSS has `.expanded` styles |

---

## 🎓 Sample Complete Response

See `CHEMISTRY_TUTOR_OUTPUT_SCHEMA.md` for full working examples:
- Full CONVERSION mode example (2 steps)
- Full DESCRIPTION mode example (2 steps)
- All molecule types
- All validation rules

**Keep all 4 docs handy for reference! 📚**

