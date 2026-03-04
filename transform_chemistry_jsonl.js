const fs = require('fs');

const INPUT = 'chemistry.jsonl';
const OUTPUT = 'chemistry_transformed.jsonl';

const raw = fs.readFileSync(INPUT, 'utf8');
const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

const records = lines.map((line, i) => {
  try {
    return JSON.parse(line);
  } catch (e) {
    throw new Error(`Invalid JSON on line ${i + 1}: ${e.message}`);
  }
});

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasToken(text, token) {
  if (!text) return false;
  const t = String(text);
  if (/^[A-Za-z0-9]+$/.test(token)) {
    const re = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
    return re.test(t);
  }
  return t.toLowerCase().includes(token.toLowerCase());
}

function tokenNearCue(text, token, cueRegex, windowSize = 70) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  const tk = token.toLowerCase();
  let start = 0;
  while (true) {
    const idx = lower.indexOf(tk, start);
    if (idx === -1) break;
    const lo = Math.max(0, idx - windowSize);
    const hi = Math.min(lower.length, idx + tk.length + windowSize);
    const slice = lower.slice(lo, hi);
    if (cueRegex.test(slice)) return true;
    start = idx + tk.length;
  }
  return false;
}

const compoundDefs = [
  { name: 'water', smiles: 'O', tokens: ['H2O', 'water'] },
  { name: 'ammonia', smiles: 'N', tokens: ['NH3', 'ammonia'] },
  { name: 'hydrochloric acid', smiles: 'Cl', tokens: ['HCl', 'hydrochloric acid'] },
  { name: 'hydrobromic acid', smiles: 'Br', tokens: ['HBr', 'hydrobromic acid'] },
  { name: 'hydroiodic acid', smiles: 'I', tokens: ['HI', 'hydroiodic acid'] },
  { name: 'sulfuric acid', smiles: 'O=S(=O)(O)O', tokens: ['H2SO4', 'sulfuric acid'] },
  { name: 'nitric acid', smiles: 'O=[N+]([O-])O', tokens: ['HNO3', 'nitric acid'] },
  { name: 'nitrous acid', smiles: 'O=N(O)O', tokens: ['HNO2', 'nitrous acid'] },
  { name: 'sodium hydroxide', smiles: '[Na+].[OH-]', tokens: ['NaOH', 'sodium hydroxide'] },
  { name: 'potassium hydroxide', smiles: '[K+].[OH-]', tokens: ['KOH', 'potassium hydroxide'] },
  { name: 'potassium permanganate', smiles: '[K+].[O-][Mn](=O)(=O)=O', tokens: ['KMnO4', 'potassium permanganate'] },
  { name: 'potassium dichromate', smiles: '[K+].[K+].[O-][Cr](=O)(=O)O[Cr](=O)(=O)[O-]', tokens: ['K2Cr2O7', 'potassium dichromate'] },
  { name: 'sodium dichromate', smiles: '[Na+].[Na+].[O-][Cr](=O)(=O)O[Cr](=O)(=O)[O-]', tokens: ['Na2Cr2O7', 'sodium dichromate'] },
  { name: 'ferric chloride', smiles: 'Cl[Fe](Cl)Cl', tokens: ['FeCl3', 'ferric chloride'] },
  { name: 'aluminium chloride', smiles: 'Cl[Al](Cl)Cl', tokens: ['AlCl3', 'aluminium chloride', 'aluminum chloride'] },
  { name: 'chlorine', smiles: 'ClCl', tokens: ['Cl2', 'chlorine'] },
  { name: 'bromine', smiles: 'BrBr', tokens: ['Br2', 'bromine'] },
  { name: 'oxygen', smiles: 'O=O', tokens: ['O2', 'oxygen'] },
  { name: 'hydrogen', smiles: '[H][H]', tokens: ['H2', 'hydrogen'] },
  { name: 'ozone', smiles: 'O=[O+][O-]', tokens: ['O3', 'ozone'] },
  { name: 'thionyl chloride', smiles: 'O=S(Cl)Cl', tokens: ['SOCl2', 'thionyl chloride'] },
  { name: 'sodium borohydride', smiles: '[Na+].[BH4-]', tokens: ['NaBH4', 'sodium borohydride'] },
  { name: 'lithium aluminium hydride', smiles: '[Li+].[AlH4-]', tokens: ['LiAlH4', 'lithium aluminium hydride', 'lithium aluminum hydride'] },
  { name: 'sodium nitrite', smiles: '[Na+].[O-]N=O', tokens: ['NaNO2', 'sodium nitrite'] },
  { name: 'phosphorus pentachloride', smiles: 'ClP(Cl)(Cl)(Cl)Cl', tokens: ['PCl5', 'phosphorus pentachloride'] },
  { name: 'phosphorus trichloride', smiles: 'ClP(Cl)Cl', tokens: ['PCl3', 'phosphorus trichloride'] },
  { name: 'phosphorus tribromide', smiles: 'BrP(Br)Br', tokens: ['PBr3', 'phosphorus tribromide'] },
  { name: 'boron trifluoride', smiles: 'FB(F)F', tokens: ['BF3', 'boron trifluoride'] },
  { name: 'zinc chloride', smiles: 'Cl[Zn]Cl', tokens: ['ZnCl2', 'zinc chloride'] },
  { name: 'silver nitrate', smiles: '[Ag+].[O-][N+](=O)[O-]', tokens: ['AgNO3', 'silver nitrate'] },
  { name: 'manganese dioxide', smiles: 'O=[Mn]=O', tokens: ['MnO2', 'manganese dioxide'] },
  { name: 'hydrogen peroxide', smiles: 'OO', tokens: ['H2O2', 'hydrogen peroxide'] },
  { name: 'hydrazine', smiles: 'NN', tokens: ['NH2NH2', 'hydrazine'] },
  { name: 'sodium amide', smiles: '[Na+].[NH2-]', tokens: ['NaNH2', 'sodium amide'] },
  { name: 'sodium bisulfite', smiles: '[Na+].[O-]S(=O)O', tokens: ['NaHSO3', 'sodium bisulfite'] },
  { name: 'sodium carbonate', smiles: '[Na+].[Na+].[O-]C(=O)[O-]', tokens: ['Na2CO3', 'sodium carbonate'] },
  { name: 'ammonium chloride', smiles: '[NH4+].[Cl-]', tokens: ['NH4Cl', 'ammonium chloride'] },
  { name: 'cuprous oxide', smiles: '[Cu]O[Cu]', tokens: ['Cu2O', 'cuprous oxide'] },
  { name: 'methane', smiles: 'C', tokens: ['CH4', 'methane'] },
  { name: 'ethane', smiles: 'CC', tokens: ['C2H6', 'ethane'] },
  { name: 'ethene', smiles: 'C=C', tokens: ['C2H4', 'ethene', 'ethylene'] },
  { name: 'ethyne', smiles: 'C#C', tokens: ['C2H2', 'ethyne', 'acetylene'] },
  { name: 'propane', smiles: 'CCC', tokens: ['C3H8', 'propane'] },
  { name: 'chloromethane', smiles: 'CCl', tokens: ['CH3Cl', 'chloromethane', 'methyl chloride'] },
  { name: 'ethanol', smiles: 'CCO', tokens: ['C2H5OH', 'C2H6O', 'ethanol', 'ethyl alcohol'] },
  { name: 'methanol', smiles: 'CO', tokens: ['CH3OH', 'methanol', 'methyl alcohol'] },
  { name: 'chloroform', smiles: 'ClC(Cl)Cl', tokens: ['CHCl3', 'chloroform'] },
  { name: 'iodoform', smiles: 'IC(I)I', tokens: ['CHI3', 'iodoform'] },
  { name: 'acetic acid', smiles: 'CC(=O)O', tokens: ['CH3COOH', 'acetic acid', 'ethanoic acid'] },
  { name: 'formaldehyde', smiles: 'C=O', tokens: ['HCHO', 'CH2O', 'formaldehyde', 'methanal'] },
  { name: 'acetaldehyde', smiles: 'CC=O', tokens: ['CH3CHO', 'acetaldehyde', 'ethanal'] },
  { name: 'benzene', smiles: 'c1ccccc1', tokens: ['C6H6', 'benzene'] },
  { name: 'phenol', smiles: 'Oc1ccccc1', tokens: ['C6H5OH', 'phenol'] },
  { name: 'toluene', smiles: 'Cc1ccccc1', tokens: ['C6H5CH3', 'toluene'] },
  { name: 'benzoic acid', smiles: 'O=C(O)c1ccccc1', tokens: ['C6H5COOH', 'benzoic acid'] },
  { name: 'aniline', smiles: 'Nc1ccccc1', tokens: ['C6H5NH2', 'aniline'] },
  { name: 'nitrobenzene', smiles: 'O=[N+]([O-])c1ccccc1', tokens: ['C6H5NO2', 'nitrobenzene'] },
  { name: 'benzenesulfonic acid', smiles: 'O=S(=O)(O)c1ccccc1', tokens: ['C6H5SO3H', 'benzenesulfonic acid'] },
  { name: 'carbon dioxide', smiles: 'O=C=O', tokens: ['CO2', 'carbon dioxide'] },
  { name: 'carbon monoxide', smiles: '[C-]#[O+]', tokens: ['CO', 'carbon monoxide'] },
  { name: 'nitrogen', smiles: 'N#N', tokens: ['N2', 'nitrogen'] },
  { name: 'nitrous oxide', smiles: 'N#[N+][O-]', tokens: ['N2O', 'nitrous oxide'] },
  { name: 'sulfur dioxide', smiles: 'O=S=O', tokens: ['SO2', 'sulfur dioxide'] },
  { name: 'sulfur trioxide', smiles: 'O=S(=O)=O', tokens: ['SO3', 'sulfur trioxide'] },
  { name: 'sodium propionate', smiles: 'CCC(=O)[O-].[Na+]', tokens: ['CH3CH2COONa', 'sodium propionate'] }
];

const reagentNames = new Set([
  'water',
  'ammonia',
  'hydrochloric acid',
  'hydrobromic acid',
  'hydroiodic acid',
  'sulfuric acid',
  'nitric acid',
  'nitrous acid',
  'sodium hydroxide',
  'potassium hydroxide',
  'potassium permanganate',
  'potassium dichromate',
  'sodium dichromate',
  'ferric chloride',
  'aluminium chloride',
  'chlorine',
  'bromine',
  'oxygen',
  'hydrogen',
  'ozone',
  'thionyl chloride',
  'sodium borohydride',
  'lithium aluminium hydride',
  'sodium nitrite',
  'phosphorus pentachloride',
  'phosphorus trichloride',
  'phosphorus tribromide',
  'boron trifluoride',
  'zinc chloride',
  'silver nitrate',
  'manganese dioxide',
  'hydrogen peroxide',
  'hydrazine',
  'sodium amide',
  'sodium bisulfite',
  'sodium carbonate',
  'ammonium chloride',
  'cuprous oxide'
]);

const productCue = /(product|products|yield|yields|yielded|form|forms|formed|produce|produces|produced|উৎপাদ|উৎপন্ন|প্রোডাক্ট)/i;
const possibleCue = /(possible|সম্ভাব্য|may form|may produce|could form|could produce)/i;

const reactionDefs = [
  { regex: /ozonolysis/i, text: 'Ozonolysis cleaves unsaturation to form carbonyl compounds.' },
  { regex: /nitration/i, text: 'Nitration introduces a nitro group (–NO2) into an aromatic ring.' },
  { regex: /sulfonation/i, text: 'Sulfonation introduces a sulfonic acid group (–SO3H) into an aromatic ring.' },
  { regex: /halogenation|chlorination|bromination/i, text: 'Halogenation replaces or adds halogen under suitable reaction conditions.' },
  { regex: /friedel\s*-?\s*crafts[^\n]*alkyl/i, text: 'Friedel–Crafts alkylation adds an alkyl group to an aromatic ring using a Lewis acid catalyst.' },
  { regex: /friedel\s*-?\s*crafts[^\n]*acyl/i, text: 'Friedel–Crafts acylation adds an acyl group to an aromatic ring using a Lewis acid catalyst.' },
  { regex: /hydrogenation/i, text: 'Hydrogenation adds hydrogen across multiple bonds in presence of a catalyst.' },
  { regex: /hydration/i, text: 'Hydration adds water across a multiple bond to form alcohol or related products.' },
  { regex: /hydrolysis/i, text: 'Hydrolysis breaks chemical bonds using water under acidic or basic conditions.' },
  { regex: /oxidation|oxidising|oxidizing/i, text: 'Oxidation increases oxidation state, commonly converting alcohols or alkenes to carbonyl compounds.' },
  { regex: /reduction|reducing/i, text: 'Reduction decreases oxidation state, commonly converting carbonyl or nitro groups to alcohols or amines.' },
  { regex: /esterification/i, text: 'Esterification forms an ester from a carboxylic acid and an alcohol.' },
  { regex: /saponification/i, text: 'Saponification is base hydrolysis of an ester to give carboxylate and alcohol.' },
  { regex: /diazotization|diazotisation/i, text: 'Diazotization converts aromatic primary amines into diazonium salts at low temperature.' },
  { regex: /sandmeyer/i, text: 'Sandmeyer reaction replaces a diazonium group with halide or cyanide using copper salts.' },
  { regex: /wurtz/i, text: 'Wurtz reaction couples alkyl halides with sodium to form a higher alkane.' },
  { regex: /aldol/i, text: 'Aldol reaction forms β-hydroxy carbonyl compounds from enolizable carbonyl compounds.' },
  { regex: /cannizzaro/i, text: 'Cannizzaro reaction disproportionates non-enolizable aldehydes in strong base.' },
  { regex: /reimer\s*-?\s*tiemann/i, text: 'Reimer–Tiemann reaction formylates phenols using chloroform and base.' },
  { regex: /kolbe\s*-?\s*schmitt/i, text: 'Kolbe–Schmitt reaction carboxylates phenoxide with carbon dioxide to form hydroxybenzoates.' }
];

function normalizeKeywords(arr) {
  const input = Array.isArray(arr) ? arr : [];
  const out = [];
  const seen = new Set();
  for (const k of input) {
    const v = String(k).trim().toLowerCase();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 8) break;
  }
  return out;
}

function idxToSuffix(n) {
  let x = n;
  let s = '';
  while (x > 0) {
    x -= 1;
    s = String.fromCharCode(97 + (x % 26)) + s;
    x = Math.floor(x / 26);
  }
  return s;
}

const baseIds = records.map((obj, i) => {
  if (typeof obj.id === 'string' && obj.id.trim()) return obj.id.trim();
  return `chem_auto_${String(i + 1).padStart(4, '0')}`;
});

const idCounts = new Map();
for (const id of baseIds) idCounts.set(id, (idCounts.get(id) || 0) + 1);

const idOcc = new Map();
const usedIds = new Set();

const transformed = records.map((obj, i) => {
  const rec = { ...obj };

  const baseId = baseIds[i];
  let newId;
  if ((idCounts.get(baseId) || 0) > 1) {
    const occ = (idOcc.get(baseId) || 0) + 1;
    idOcc.set(baseId, occ);
    newId = `${baseId}_${idxToSuffix(occ)}`;
  } else {
    newId = baseId;
  }
  if (usedIds.has(newId)) {
    let n = 1;
    while (usedIds.has(`${newId}_${n}`)) n += 1;
    newId = `${newId}_${n}`;
  }
  usedIds.add(newId);
  rec.id = newId;

  rec.keywords_en = normalizeKeywords(rec.keywords_en);

  const question = typeof rec.question_bn === 'string' ? rec.question_bn : '';
  const answer = typeof rec.answer_bn_en === 'string' ? rec.answer_bn_en : '';
  const qaText = `${question} ${answer}`;

  const structures = [];
  const seenStructure = new Set();

  for (const def of compoundDefs) {
    const inQuestion = def.tokens.some((tk) => hasToken(question, tk));
    const inAnswer = def.tokens.some((tk) => hasToken(answer, tk));
    if (!inQuestion && !inAnswer) continue;

    let role = reagentNames.has(def.name) ? 'reagent' : 'reactant';

    if (!reagentNames.has(def.name)) {
      const nearProduct = def.tokens.some((tk) => tokenNearCue(answer, tk, productCue));
      const nearPossible = def.tokens.some((tk) => tokenNearCue(answer, tk, possibleCue));

      if (nearProduct) role = 'product';
      if (nearPossible || (possibleCue.test(answer) && nearProduct)) role = 'possible_product';
    }

    const key = `${def.name}||${role}`;
    if (seenStructure.has(key)) continue;
    seenStructure.add(key);
    structures.push({ name: def.name, smiles: def.smiles, role });
  }

  if (structures.length > 0) rec.structures = structures;

  const fullText = [rec.topic_en, rec.topiic_en, rec.topic_bn, question, answer, ...(Array.isArray(rec.keywords_en) ? rec.keywords_en : [])]
    .filter(Boolean)
    .join(' ');

  const reactions = [];
  const reactionSeen = new Set();
  for (const rd of reactionDefs) {
    if (rd.regex.test(fullText)) {
      if (!reactionSeen.has(rd.text)) {
        reactionSeen.add(rd.text);
        reactions.push(rd.text);
      }
    }
  }

  if (reactions.length > 0) rec.reactions = reactions;

  return rec;
});

const outText = transformed.map((o) => JSON.stringify(o)).join('\n') + '\n';
fs.writeFileSync(OUTPUT, outText, 'utf8');

console.log(`Wrote ${transformed.length} lines to ${OUTPUT}`);
