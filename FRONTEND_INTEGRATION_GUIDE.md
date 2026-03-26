# Frontend Integration Guide — Chemistry AI Tutor UI

## 🎯 Overview

Your beautiful UI expects structured JSON from the backend. This guide shows exactly how to render each section.

---

## 📋 Data Flow

```
User Question
     ↓
[POST /api/ai/ask]
     ↓
Chemistry AI (optimized prompt)
     ↓
Structured JSON Response ← (See schema doc)
     ↓
Frontend HTML Rendering
     ↓
Beautiful UI Display
```

---

## 🎨 Rendering Guide by Section

### 1. TAGS ROW

**Data:** `response.tags` (array of strings)

**HTML Structure:**
```html
<div class="tag-row">
  <!-- Generate from response.tags -->
</div>
```

**JavaScript:**
```javascript
function renderTags(tags) {
  const tagRow = document.querySelector('.tag-row');
  tagRow.innerHTML = tags.map(tag => {
    // Auto-detect tag type
    let tagClass = 'tag-secondary';
    if (tag === 'Chemistry') tagClass = 'tag-primary';
    if (tag === 'context used') tagClass = 'tag-secondary';
    
    return `<span class="tag ${tagClass}">${tag}</span>`;
  }).join('');
}

// Call it
renderTags(response.tags);
```

---

### 2. OVERVIEW CARD

**Data:** `response.overview` (object with title & text)

**HTML:**
```html
<div class="overview-card">
  <strong style="color:var(--gold2);">{{ overview.title }}</strong><br>
  {{ overview.text }}
</div>
```

**Notes:**
- `overview.text` is plain paragraph text (may contain **bold** markdown)
- Convert `**bold text**` to HTML `<strong>`:
  ```javascript
  function formatBoldText(text) {
    return text.replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--gold2);">$1</strong>');
  }
  
  overview.textHTML = formatBoldText(response.overview.text);
  ```

---

### 3. REACTION PATHWAY DIAGRAM

**Data:** `response.reaction_pathway.compounds` (array)

**HTML Structure:**
```html
<div class="overview-card" style="padding: 16px 20px;">
  <div class="reaction-diagram">
    <!-- Compounds and arrows generated here -->
  </div>
</div>
```

**JavaScript:**
```javascript
function renderReactionPathway(compounds) {
  const diagram = document.querySelector('.reaction-diagram');
  
  compounds.forEach((compound, index) => {
    // Render compound
    if (compound.role === 'reagent') {
      // Special styling for reagents
      diagram.innerHTML += `
        <div class="rxn-arrow-seg">
          <div class="rxn-arrow-reagent">${compound.formula || compound.name}</div>
          <div class="rxn-arrow-line"></div>
        </div>
      `;
    } else {
      // Reactant/product/intermediate
      diagram.innerHTML += `
        <div class="rxn-compound">
          <div class="rxn-compound-box">
            ${renderMoleculeSVG(compound)}
          </div>
          <div class="rxn-compound-name">${compound.name}</div>
        </div>
      `;
    }
    
    // Add arrow after each non-final compound
    if (index < compounds.length - 1 && compound.role !== 'reagent') {
      diagram.innerHTML += `
        <div class="rxn-arrow-seg">
          <div class="rxn-arrow-line"></div>
        </div>
      `;
    }
  });
}
```

---

### 4. MOLECULE SVG RENDERING

**Data:** Each molecule has `svg_type` and `smiles`

**JavaScript with SVG Templates:**
```javascript
function renderMoleculeSVG(molecule) {
  const { svg_type, smiles, name, formula } = molecule;
  
  // Template library
  const svgTemplates = {
    benzene_ring: () => `
      <svg class="mol-svg" width="52" height="50" viewBox="0 0 52 50">
        <polygon points="26,4 46,16 46,36 26,48 6,36 6,16" 
                 fill="none" stroke="rgba(212,168,67,0.7)" stroke-width="1.5"/>
        <circle cx="26" cy="26" r="10" 
                fill="none" stroke="rgba(212,168,67,0.4)" stroke-width="1.2"/>
      </svg>
    `,
    
    benzene_ring_with_methyl: () => `
      <svg class="mol-svg" width="60" height="50" viewBox="0 0 60 50">
        <polygon points="26,4 46,16 46,36 26,48 6,36 6,16" 
                 fill="none" stroke="rgba(212,168,67,0.7)" stroke-width="1.5"/>
        <circle cx="26" cy="26" r="10" 
                fill="none" stroke="rgba(212,168,67,0.4)" stroke-width="1.2"/>
        <line x1="46" y1="26" x2="58" y2="26" stroke="rgba(232,200,100,0.8)" stroke-width="1.5"/>
        <text x="52" y="23" font-size="8" fill="rgba(232,200,100,0.8)" 
              font-family="DM Mono, monospace">CH₃</text>
      </svg>
    `,
    
    benzoic_acid: () => `
      <svg class="mol-svg" width="72" height="50" viewBox="0 0 72 50">
        <polygon points="26,4 46,16 46,36 26,48 6,36 6,16" 
                 fill="none" stroke="rgba(212,168,67,0.7)" stroke-width="1.5"/>
        <circle cx="26" cy="26" r="10" 
                fill="none" stroke="rgba(212,168,67,0.4)" stroke-width="1.2"/>
        <line x1="46" y1="26" x2="56" y2="26" stroke="rgba(232,200,100,0.9)" stroke-width="1.5"/>
        <text x="55" y="24" font-size="7.5" fill="rgba(45,212,191,0.9)" 
              font-family="DM Mono,monospace">C</text>
        <text x="61" y="24" font-size="7.5" fill="rgba(232,200,100,0.9)" 
              font-family="DM Mono,monospace">OOH</text>
      </svg>
    `,
    
    phenol_structure: () => `
      <svg class="mol-svg" width="52" height="50" viewBox="0 0 52 50">
        <polygon points="26,4 46,16 46,36 26,48 6,36 6,16" 
                 fill="none" stroke="rgba(212,168,67,0.7)" stroke-width="1.5"/>
        <circle cx="26" cy="26" r="10" 
                fill="none" stroke="rgba(212,168,67,0.4)" stroke-width="1.2"/>
        <line x1="6" y1="16" x2="2" y2="8" stroke="rgba(200,150,100,0.9)" stroke-width="1.5"/>
        <text x="0" y="10" font-size="8" fill="rgba(200,150,100,0.9)" 
              font-family="DM Mono">OH</text>
      </svg>
    `,
    
    reagent_text: () => `
      <svg class="mol-svg" width="56" height="52" viewBox="0 0 56 52">
        <text x="4" y="24" font-size="10" fill="rgba(232,200,100,0.9)" 
              font-family="DM Mono,monospace">${formula || name}</text>
      </svg>
    `,
    
    // Add more templates as needed...
  };
  
  const renderer = svgTemplates[svg_type] || (() => `<!-- Unknown SVG type: ${svg_type} -->`);
  return renderer();
}
```

---

### 5. STEP CARDS

**Data:** `response.steps` (array of step objects)

**HTML Structure:**
```html
<div style="margin-top:16px;">
  <div class="steps-label">Step-by-step breakdown</div>
  <!-- Steps rendered here -->
</div>
```

**JavaScript:**
```javascript
function renderSteps(steps) {
  const container = document.querySelector('.steps-container') 
                    || document.querySelector('[data-steps]');
  
  steps.forEach((step, index) => {
    const stepCard = document.createElement('div');
    stepCard.className = 'step-card';
    stepCard.id = `step${step.step_num}`;
    stepCard.innerHTML = `
      <div class="step-header" onclick="toggleStep('step${step.step_num}')">
        <div class="step-num">${String(step.step_num).padStart(2, '0')}</div>
        <div class="step-title-block">
          <div class="step-title">${step.title}</div>
          <div class="step-subtitle">${step.subtitle}</div>
        </div>
        <svg class="step-chevron" width="16" height="16" viewBox="0 0 24 24" 
             fill="none" stroke="currentColor" stroke-width="2" 
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="step-body">
        <div class="step-body-inner">
          <div class="step-desc">${step.description}</div>
          ${step.molecules ? `
            <div class="molecules-row">
              ${step.molecules.map(mol => `
                <div class="molecule-card">
                  <div class="molecule-canvas">
                    ${renderMoleculeSVG(mol)}
                  </div>
                  <div class="molecule-name">${mol.name}</div>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
    
    container.appendChild(stepCard);
  });
  
  // Expand first step by default
  if (steps.length > 0) {
    document.getElementById(`step${steps[0].step_num}`).classList.add('expanded');
  }
}

// Toggle function
function toggleStep(id) {
  document.getElementById(id)?.classList.toggle('expanded');
}
```

---

### 6. KEY POINTS SECTION

**Data:** `response.key_points` (array of 3 strings)

**HTML:**
```html
<div style="margin-top: 20px;">
  <div class="steps-label">Key Insights</div>
  <ul class="key-points-list">
    <!-- Generated from response.key_points -->
  </ul>
</div>
```

**JavaScript:**
```javascript
function renderKeyPoints(keyPoints) {
  const container = document.querySelector('.key-points-list');
  container.innerHTML = keyPoints.map(point => `
    <li style="margin-bottom:8px;color:var(--text2);font-size:14px;line-height:1.6;">
      ${point}
    </li>
  `).join('');
}
```

---

### 7. EQUATIONS SECTION

**Data:** `response.equations` (array of strings)

**HTML:**
```html
<div class="equations-section" style="margin-top:16px;">
  <div class="steps-label">Chemical Equations</div>
  <div class="overview-card">
    <!-- Equations rendered here -->
  </div>
</div>
```

**JavaScript:**
```javascript
function renderEquations(equations) {
  if (!equations || equations.length === 0) {
    document.querySelector('.equations-section').style.display = 'none';
    return;
  }
  
  const eqContainer = document.querySelector('.equations-section');
  eqContainer.innerHTML = `
    <div class="steps-label">Chemical Equations</div>
    <div class="overview-card">
      ${equations.map((eq, i) => `
        <div style="margin-bottom:${i < equations.length - 1 ? '8px' : '0'};">
          <code style="color:var(--gold2);font-family:'DM Mono',monospace;font-size:13px;">
            ${escapeHtml(eq)}
          </code>
        </div>
      `).join('')}
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

---

## 🎯 Complete Render Function

Put it all together:

```javascript
async function renderAIResponse(response) {
  // Validate response
  if (!response || !response.question_mode) {
    console.error('Invalid AI response structure');
    return;
  }
  
  // Clear previous
  const chatArea = document.querySelector('.chat-area');
  
  // Create AI message container
  const aiMsg = document.createElement('div');
  aiMsg.className = 'ai-msg';
  aiMsg.innerHTML = `
    <div class="ai-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="12" cy="12" r="3"/>
      </svg>
    </div>
    <div class="ai-content">
      <div class="ai-label">AI Tutor</div>
      <!-- Content generated below -->
    </div>
  `;
  
  const content = aiMsg.querySelector('.ai-content');
  
  // 1. Tags
  const tagRow = document.createElement('div');
  tagRow.className = 'tag-row';
  tagRow.innerHTML = response.tags.map(tag => {
    const isPrimary = tag === 'Chemistry' || tag === 'conversion' || tag === 'description';
    return `<span class="tag ${isPrimary ? 'tag-primary' : 'tag-secondary'}">${tag}</span>`;
  }).join('');
  content.appendChild(tagRow);
  
  // 2. Overview
  const overview = document.createElement('div');
  overview.className = 'overview-card';
  overview.innerHTML = `
    <strong style="color:var(--gold2);">${response.overview.title}</strong><br>
    ${response.overview.text.replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--gold2);">$1</strong>')}
  `;
  content.appendChild(overview);
  
  // 3. Reaction pathway (if conversion)
  if (response.is_conversion && response.reaction_pathway) {
    const pathwaySection = document.createElement('div');
    pathwaySection.innerHTML = `
      <div class="steps-label" style="margin-top:16px;">Reaction pathway</div>
      <div class="overview-card" style="padding: 16px 20px;">
        <div class="reaction-diagram">
          ${response.reaction_pathway.compounds.map((compound, i) => {
            if (compound.role === 'reagent') {
              return `
                <div class="rxn-arrow-seg">
                  <div class="rxn-arrow-reagent">${compound.formula || compound.name}</div>
                  <div class="rxn-arrow-line"></div>
                </div>
              `;
            } else {
              return `
                <div class="rxn-compound">
                  <div class="rxn-compound-box">
                    ${renderMoleculeSVG(compound)}
                  </div>
                  <div class="rxn-compound-name">${compound.name}</div>
                </div>
                ${i < response.reaction_pathway.compounds.length - 1 && 
                  response.reaction_pathway.compounds[i + 1].role !== 'reagent' ? `
                  <div class="rxn-arrow-seg">
                    <div class="rxn-arrow-line"></div>
                  </div>
                ` : ''}
              `;
            }
          }).join('')}
        </div>
      </div>
    `;
    content.appendChild(pathwaySection);
  }
  
  // 4. Steps
  const stepsSection = document.createElement('div');
  stepsSection.style.marginTop = '16px';
  stepsSection.innerHTML = `<div class="steps-label">Step-by-step breakdown</div>`;
  
  response.steps.forEach((step, idx) => {
    const stepCard = document.createElement('div');
    stepCard.className = `step-card ${idx === 0 ? 'expanded' : ''}`;
    stepCard.id = `step${step.step_num}`;
    stepCard.innerHTML = `
      <div class="step-header" onclick="toggleStep('step${step.step_num}')">
        <div class="step-num">${String(step.step_num).padStart(2, '0')}</div>
        <div class="step-title-block">
          <div class="step-title">${step.title}</div>
          <div class="step-subtitle">${step.subtitle}</div>
        </div>
        <svg class="step-chevron" width="16" height="16" viewBox="0 0 24 24" 
             fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="step-body">
        <div class="step-body-inner">
          <div class="step-desc">${step.description}</div>
          ${step.molecules && step.molecules.length > 0 ? `
            <div class="molecules-row">
              ${step.molecules.map(mol => `
                <div class="molecule-card">
                  <div class="molecule-canvas">${renderMoleculeSVG(mol)}</div>
                  <div class="molecule-name">${mol.name}</div>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
    stepsSection.appendChild(stepCard);
  });
  
  content.appendChild(stepsSection);
  
  // 5. Equations
  if (response.equations && response.equations.length > 0) {
    const eqSection = document.createElement('div');
    eqSection.style.marginTop = '16px';
    eqSection.innerHTML = `
      <div class="steps-label">Equations</div>
      <div class="overview-card">
        ${response.equations.map((eq, i) => `
          <div style="margin-bottom:${i < response.equations.length - 1 ? '8px' : '0'};">
            <code style="color:var(--gold2);font-family:'DM Mono',monospace;font-size:13px;">
              ${escapeHtml(eq)}
            </code>
          </div>
        `).join('')}
      </div>
    `;
    content.appendChild(eqSection);
  }
  
  // 6. Key Points
  const keySection = document.createElement('div');
  keySection.style.marginTop = '16px';
  keySection.innerHTML = `
    <div class="steps-label">Key Points</div>
    <ul style="margin-left:20px;">
      ${response.key_points.map(point => `
        <li style="margin-bottom:8px;color:var(--text2);font-size:14px;line-height:1.6;">
          ${point}
        </li>
      `).join('')}
    </ul>
  `;
  content.appendChild(keySection);
  
  // Add to chat
  chatArea.appendChild(aiMsg);
  
  // Auto-scroll
  chatArea.scrollTop = chatArea.scrollHeight;
}

// Usage
const aiResponse = await fetch('/api/ai/ask', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    question: userQuestion,
    subject: 'chemistry'
  })
}).then(r => r.json());

renderAIResponse(aiResponse);
```

---

## ✅ Responsive Tips

- **Mobile:** Hide reaction diagram if screen < 600px (or allow horizontal scroll)
- **Tablets:** Adjust molecule SVG sizes (60px → 40px)
- **Desktop:** Full 3-column molecules row

---

## 🎯 State Management

Track response state:

```javascript
const chatState = {
  messages: [],
  
  addAI(response) {
    this.messages.push({
      type: 'ai',
      data: response,
      timestamp: Date.now()
    });
  },
  
  getLastResponse() {
    return this.messages[this.messages.length - 1]?.data;
  }
};
```

---

## 🔄 Update Topbar Info

```javascript
function updateTopbar(response) {
  // Update subject badge
  const badge = document.querySelector('.topbar-subject-badge');
  const subject = response.subject === 'chemistry' ? '⚗️ Chemistry' : 
                  response.subject === 'physics' ? '⚛️ Physics' : 
                  '∑ Math';
  
  badge.innerHTML = `
    <div class="subject-icon">⚗️</div>
    <span>Tutor mode ·</span>
    <strong>${subject.split(' ')[1]}</strong>
  `;
  
  // Update message count
  const msgCount = document.querySelector('.topbar-subject-badge + div');
  msgCount.textContent = `${chatState.messages.length} msgs · LaTeX on`;
}
```

---

## 📚 LaTeX Support

For mathematical notation in equations:
- Use katex or mathjax library
- Wrap in `$...$` for inline, `$$...$$` for block
- Example: `$\alpha + \beta = \gamma$`

```html
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.0/dist/katex.min.js"></script>
<script>
function renderLatex(text) {
  return text.replace(/\$\$(.*?)\$\$/gs, (m, eq) => {
    return katex.renderToString(eq, { displayMode: true });
  }).replace(/\$(.*?)\$/g, (m, eq) => {
    return katex.renderToString(eq, { displayMode: false });
  });
}
</script>
```

