/**
 * Organic Chemistry Question Detection
 * 
 * This module provides a keyword-based router to detect if a question
 * is related to Organic Chemistry.
 */

// Organic chemistry keywords for detection
const ORGANIC_KEYWORDS = [
  // Hydrocarbons
  'alkane', 'alkene', 'alkyne', 'hydrocarbon',
  
  // Aromatic compounds
  'benzene', 'aromatic', 'phenol', 'phenyl',
  
  // Functional groups
  'alcohol', 'aldehyde', 'ketone', 'ester', 'carboxylic',
  'amine', 'amide', 'ether', 'nitrile', 'haloalkane',
  'halogen', 'acyl', 'carbonyl',
  
  // Reactions and mechanisms
  'polymer', 'polymerization', 'mechanism', 'sn1', 'sn2',
  'electrophilic', 'nucleophilic', 'substitution', 'elimination',
  'addition', 'condensation', 'hydrolysis', 'oxidation',
  'reduction', 'fermentation', 'cracking', 'ozonolysis',
  'hydration', 'dehydration', 'hydrogenation', 'halogenation',
  'nitration', 'sulfonation', 'sulphonation',
  
  // Organic chemistry concepts
  'functional group', 'isomer', 'isomerism', 'homologous',
  'carbocation', 'carbanion', 'radical', 'free radical',
  'resonance', 'delocalization', 'electrophile', 'nucleophile',
  'catalyst', 'reagent', 'substrate', 'intermediate',
  
  // Common organic compounds
  'methane', 'ethane', 'propane', 'butane', 'pentane',
  'ethene', 'ethene', 'propene', 'butene',
  'ethyne', 'ethyne', 'propyne', 'butyne',
  'methanol', 'ethanol', 'propanol', 'butanol',
  'methanal', 'ethanal', 'propanal',
  'propanone', 'acetone',
  'methanoic', 'ethanoic', 'propanoic', 'acetic',
  'methyl', 'ethyl', 'propyl', 'butyl',
  
  // Reaction types
  'grignard', 'friedel-crafts', 'cannizzaro', 'aldol',
  'wurtz', 'kolbe', 'hoffmann', 'diels-alder',
  
  // Tests and reagents
  'brady', 'tollens', 'fehlings', 'lucas',
  '2,4-dinitrophenylhydrazine', 'schiff', 'benedict',
  
  // Other organic terms
  'chiral', 'optical', 'enantiomer', 'diastereomer',
  'stereochemistry', 'conformation', 'configuration',
  'monomer', 'dimer', 'trimer', 'vulcanization',
  'thermoplastic', 'thermoset', 'biodegradable'
];

/**
 * Check if a question is related to Organic Chemistry
 * @param {string} question - The user's question
 * @returns {boolean} - True if the question is about organic chemistry
 */
function isOrganicQuestion(question) {
  if (!question || typeof question !== 'string') {
    return false;
  }
  
  const normalizedQuestion = question.toLowerCase();
  
  // Check for any organic chemistry keyword
  for (const keyword of ORGANIC_KEYWORDS) {
    if (normalizedQuestion.includes(keyword.toLowerCase())) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get matching organic keywords from a question
 * @param {string} question - The user's question
 * @returns {string[]} - Array of matching keywords
 */
function getMatchingKeywords(question) {
  if (!question || typeof question !== 'string') {
    return [];
  }
  
  const normalizedQuestion = question.toLowerCase();
  const matches = [];
  
  for (const keyword of ORGANIC_KEYWORDS) {
    if (normalizedQuestion.includes(keyword.toLowerCase())) {
      matches.push(keyword);
    }
  }
  
  return matches;
}

/**
 * Detect the type of chemistry question
 * @param {string} question - The user's question
 * @returns {{isOrganic: boolean, keywords: string[], type: string}}
 */
function detectQuestionType(question) {
  const isOrganic = isOrganicQuestion(question);
  const keywords = getMatchingKeywords(question);
  
  return {
    isOrganic,
    keywords,
    type: isOrganic ? 'organic' : 'general'
  };
}

module.exports = {
  ORGANIC_KEYWORDS,
  isOrganicQuestion,
  getMatchingKeywords,
  detectQuestionType
};