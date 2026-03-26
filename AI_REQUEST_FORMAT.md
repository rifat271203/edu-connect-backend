# Chemistry AI Tutor - Request Format Documentation

## 📡 API Endpoint

**POST** `/api/ai/ask`

**Base URL:** `http://localhost:3001`

---

## 🔐 Authentication

```
Header: Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

---

## 📝 Request Body Format

```json
{
  "question": "string (required)",
  "subject": "string (optional)",
  "category": "string (optional)"
}
```

### Parameters:

| Parameter  | Type     | Required | Description                                      |
|-----------|----------|----------|--------------------------------------------------|
| `question` | string   | ✅ Yes   | The student's question (min 3 chars). Can be English or Bangla. |
| `subject`  | string   | ❌ No    | Pre-specify subject: `"chemistry"`, `"math"`, or `"physics"`. If omitted, auto-detected. |
| `category` | string   | ❌ No    | Pre-specify category: `"chemistry"`, `"math"`, or `"physics"`. |

---

## 💡 Example Requests

### Example 1: Simple Chemistry Question (English)
```json
{
  "question": "How is benzene converted to nitrobenzene?",
  "subject": "chemistry"
}
```

### Example 2: Chemistry Question (Bangla)
```json
{
  "question": "বেনজিন থেকে নাইট্রোবেনজিন কীভাবে প্রস্তুত করা হয়?",
  "subject": "chemistry"
}
```

### Example 3: Chemistry Question (Mixed Bangla-English)
```json
{
  "question": "benzene কে HNO3 দিলে কী হয়? এটি কী ধরনের বিক্রিয়া?",
  "subject": "chemistry"
}
```

### Example 4: Mechanism Question
```json
{
  "question": "Mechanism of nitration of benzene",
  "subject": "chemistry"
}
```

### Example 5: Conceptual Question
```json
{
  "question": "Why is phenol acidic?",
  "subject": "chemistry"
}
```

### Example 6: Organic Synthesis Question
```json
{
  "question": "Prepare ethanol from ethene. Give the reaction and mechanism.",
  "subject": "chemistry"
}
```

---

## 🎯 Question Types Recognized

The system automatically classifies questions into two modes:

### **MODE 1: CONVERSION/REACTION Questions**
Returns: full reaction diagram, mechanism steps, chemical equations

**Triggers (keywords):**
- "convert benzene to X"
- "preparation of X from Y"
- "synthesis of X"
- "reaction of X with Y"
- "what is the product when X reacts with Y"
- "mechanism of [reaction type]"
- "X to Y" (most common pattern)
- Named reactions: nitration, bromination, sulfonation, ozonolysis, etc.

**Example Bangla triggers:**
- "X থেকে Y তৈরি করো"
- "X এর সাথে Y এর বিক্রিয়া"
- "নাইট্রেশনের বিক্রিয়া"

---

### **MODE 2: DESCRIPTION/CONCEPT Questions**
Returns: detailed explanation, properties, relevant equations (optional), no mechanisms

**Triggers (keywords):**
- "What is benzene?"
- "Define aromatic compound"
- "Why is phenol acidic?"
- "What are the properties of toluene?"
- "Explain aromaticity"
- "Compare phenol and alcohol"

**Example Bangla triggers:**
- "বেনজিন কী?"
- "বেনজিনের ধর্ম কী?"
- "ফেনল কেন অ্যাসিডিক?"
- "কাকে aromatic compound বলে?"

---

## 🔄 Language Detection

The system automatically detects:

| Detection | Threshold | Response Language |
|-----------|-----------|------------------|
| **Bangla** | >30% Bangla Unicode | Full Bangla answer, chemistry terms in English in () |
| **Mixed** | 10-30% Bangla Unicode | Primarily Bangla, chemistry terms in English |
| **English** | <10% Bangla Unicode | Full English answer |

---

## 📤 Response Format - CONVERSION MODE

```json
{
  "question_mode": "conversion",
  "is_conversion": true,
  "reaction_type": "aromatic_substitution",
  "substrate_class": "aromatic",
  "carbon_change": "carbon_same",
  
  "answer": "Full 8-14 line explanation describing the reaction mechanism, reagent roles, conditions, and key concepts.",
  
  "diagram": {
    "reactants": [
      { "name": "benzene", "smiles": "c1ccccc1" }
    ],
    "reagents": [
      { "name": "nitric_acid", "smiles": "O=[N+]([O-])O" },
      { "name": "sulfuric_acid", "smiles": "OS(=O)(=O)O" }
    ],
    "conditions": "heat, conc. H2SO4",
    "products": [
      { 
        "name": "nitrobenzene", 
        "smiles": "O=[N+]([O-])c1ccccc1", 
        "type": "major"
      }
    ]
  },
  
  "diagram_caption": "Electrophilic aromatic substitution: nitration of benzene with concentrated nitric acid and sulfuric acid catalyst.",
  
  "mechanism_steps": [
    {
      "step": 1,
      "title": "Electrophile formation",
      "desc": "Mixed acid (HNO3 + H2SO4) generates the nitronium ion NO2+, the active electrophile.",
      "structures": [
        { "name": "nitric_acid", "smiles": "O=[N+]([O-])O" }
      ]
    },
    {
      "step": 2,
      "title": "Sigma complex (arenium ion)",
      "desc": "The aromatic ring attacks NO2+, forming an arenium (sigma) complex. Aromaticity is temporarily lost.",
      "structures": [
        { "name": "benzene", "smiles": "c1ccccc1" }
      ]
    },
    {
      "step": 3,
      "title": "Deprotonation / aromaticity restored",
      "desc": "HSO4- removes H+ from the ring, restoring aromaticity and giving the nitro product.",
      "structures": [
        { "name": "nitrobenzene", "smiles": "O=[N+]([O-])c1ccccc1" }
      ]
    }
  ],
  
  "equations": [],
  
  "key_points": [
    "Nitration is electrophilic aromatic substitution; requires electrophile generation by mixed acid.",
    "Aromatic ring deactivation by NO2 group means further nitration is slower (ortho/para blocked).",
    "Concentrated H2SO4 is NOT the electrophile itself; it protonates HNO3 to form NO2+."
  ],
  
  "resonance": null,
  "contextUsed": true,
  "subject": "chemistry",
  "category": "chemistry"
}
```

---

## 📤 Response Format - DESCRIPTION MODE

```json
{
  "question_mode": "description",
  "is_conversion": false,
  "reaction_type": "conceptual_theory",
  "substrate_class": "",
  "carbon_change": "unknown",
  
  "answer": "Full 10-18 line conceptual explanation covering the definition, properties, examples, and electronic structure.",
  
  "diagram": {
    "reactants": [
      { "name": "phenol", "smiles": "Oc1ccccc1" }
    ],
    "reagents": [],
    "conditions": "",
    "products": []
  },
  
  "diagram_caption": "Structure of phenol showing OH group attached to benzene ring",
  
  "mechanism_steps": [],
  
  "equations": [
    "C6H5OH + NaOH → C6H5ONa + H2O",
    "C6H5OH has Pka ≈ 10 (similar to weak acids)"
  ],
  
  "key_points": [
    "Phenol is acidic because the -OH oxygen's lone pair delocalizes into the ring (resonance effect).",
    "Phenol is much more acidic than alcohols; the phenoxide ion is stabilized by resonance.",
    "Phenol does NOT readily form esters with acid anhydrides (unlike simple alcohols) due to resonance stabilization."
  ],
  
  "resonance": null,
  "contextUsed": true,
  "subject": "chemistry",
  "category": "chemistry"
}
```

---

## 🧪 Supported Chemistry Topics

### Organic Chemistry:
- Aromatic compounds (benzene, toluene, phenol, aniline, etc.)
- Aromatic substitutions (nitration, bromination, chlorination, halogenation)
- Named reactions (Friedel-Crafts, ozonolysis, sulfonation)
- Alkene & alkyne reactions
- Alcohols, aldehydes, ketones, carboxylic acids, esters
- Resonance structures and electron delocalization

### Physical Chemistry:
- Thermodynamics, acids/bases, equilibrium
- Kinetics and reaction rates

### Inorganic Chemistry:
- Metal complexes, transition metals
- Oxidation-reduction reactions

---

## ⚙️ Configuration & Internal Processing

### Question Classification:
1. **Language Detection**: Determines input language (Bangla/English/Mixed)
2. **Question Mode Classification**: Determines conversion vs description mode
3. **RAG Context Retrieval**: Fetches relevant context from Qdrant vector database
4. **LLM Processing**: Sends to Gemini API (with fallbacks to Groq/OpenRouter)
5. **JSON Response Building**: Validates and structures output

### System Prompts Used:
- **Chemistry System Prompt**: Specialized for HSC chemistry with SMILES validation
- **Language Instructions**: Injected into each request for language consistency
- **Mode Instructions**: Different prompts for conversion vs description modes

---

## 🔍 SMILES Dictionary (Sample)

Common molecules auto-detected and mapped to SMILES:

```
benzene       → c1ccccc1
toluene       → Cc1ccccc1
phenol        → Oc1ccccc1
aniline       → Nc1ccccc1
nitrobenzene  → O=[N+]([O-])c1ccccc1
chlorobenzene → Clc1ccccc1
naphthalene   → c1ccc2ccccc2c1
ethene        → C=C
acetone       → CC(C)=O
```

---

## 🚨 Error Handling

### Invalid Requests:
```json
{
  "error": "প্রশ্ন দিতে হবে।" // (Please provide a question)
}
```

### AI Service Errors:
```json
{
  "error": "AI সার্ভিসে সমস্যা হয়েছে।" // (Problem with AI service)
}
```

---

## 📋 Response Status Codes

| Code | Meaning |
|------|---------|
| 200  | Success - valid response returned |
| 400  | Bad request - missing or invalid parameters |
| 500  | Server error - AI service or database issue |

---

## 🔗 Related Endpoints

- **Math Tutor**: Same `/api/ai/ask` endpoint (auto-detects math questions)
- **Physics Tutor**: Same `/api/ai/ask` endpoint (auto-detects physics questions)
- **Subject Routing**: Automatic based on question keywords or explicit `subject` parameter

---

## 📚 Related Documentation

- System architecture in `eduSocial.js`
- Vector database (Qdrant) configuration
- LLM provider fallback chains (Gemini → Groq → OpenRouter)
