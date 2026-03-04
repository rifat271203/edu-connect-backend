const fs = require('fs');
const path = require('path');

// Read the chemistry text file
const chemistryText = fs.readFileSync(
  path.join(__dirname, 'Books/chemistry_clean.txt'),
  'utf8'
);

// Extract page sections
const pages = chemistryText.split('=== PAGE ').filter(p => p.trim());

// Q&A generation patterns for Bengali chemistry content
const qaPatterns = [
  // Definition patterns
  {
    regex: /([আ-হ]+?)\s*এর\s*সংজ্ঞা[\s:-]*([^\n।]+)/g,
    generate: (match) => ({
      question: `${match[1]} এর সংজ্ঞা কী?`,
      answer: match[2].trim()
    })
  },
  {
    regex: /([আ-হ]+?)\s*কাকে\s*বলে[?\s:-]*([^\n।]+)/g,
    generate: (match) => ({
      question: `${match[1]} কাকে বলে?`,
      answer: match[2].trim()
    })
  },
  // Properties patterns
  {
    regex: /([আ-হ]+?)\s*এর\s*ভৌত\s*ধর্ম[?\s:-]*([^\n।]+)/g,
    generate: (match) => ({
      question: `${match[1]} এর ভৌত ধর্ম কী?`,
      answer: match[2].trim()
    })
  },
  {
    regex: /([আ-হ]+?)\s*এর\s*রাসায়নিক\s*ধর্ম[?\s:-]*([^\n।]+)/g,
    generate: (match) => ({
      question: `${match[1]} এর রাসায়নিক ধর্ম কী?`,
      answer: match[2].trim()
    })
  },
  // Preparation patterns
  {
    regex: /([আ-হ]+?)\s*প্রস্তুতি[?\s:-]*([^\n।]+)/g,
    generate: (match) => ({
      question: `${match[1]} কীভাবে প্রস্তুত করা হয়?`,
      answer: match[2].trim()
    })
  },
  // Usage patterns
  {
    regex: /([আ-হ]+?)\s*এর\s*ব্যবহার[?\s:-]*([^\n।]+)/g,
    generate: (match) => ({
      question: `${match[1]} এর ব্যবহার কী?`,
      answer: match[2].trim()
    })
  },
  // Formula patterns
  {
    regex: /([A-Z][a-z]?\d*[A-Z]?[a-z]?\d*)\s*এর\s*সংকেত[?\s:-]*([^\n।]+)/g,
    generate: (match) => ({
      question: `${match[1]} এর সংকেত কী?`,
      answer: match[2].trim()
    })
  },
  // Comparison patterns
  {
    regex: /([আ-হ]+?)\s*ও\s*([আ-হ]+?)\s*এর\s*মধ্যে\s*তুলনা[?\s:-]*([^\n।]+)/g,
    generate: (match) => ({
      question: `${match[1]} ও ${match[2]} এর মধ্যে পার্থক্য কী?`,
      answer: match[3].trim()
    })
  },
  // Industrial production
  {
    regex: /([আ-হ]+?)\s*শিল্পোৎপাদন[?\s:-]*([^\n।]+)/g,
    generate: (match) => ({
      question: `${match[1]} কীভাবে শিল্পে উৎপাদন করা হয়?`,
      answer: match[2].trim()
    })
  }
];

// Manual Q&A from chemistry content
const manualQAs = [
  // Nitrogen and its compounds
  {
    question: "নাইট্রোজেনের প্রধান উৎস কী?",
    answer: "বায়ুমণ্ডল (বায়ুর 78% নাইট্রোজেন)"
  },
  {
    question: "আমোনিয়া প্রস্তুতির হেবার পদ্ধতিতে কী কী উপাদান ব্যবহার করা হয়?",
    answer: "নাইট্রোজেন ও হাইড্রোজেন গ্যাস, লৌহ প্রভাবক"
  },
  {
    question: "হেবার পদ্ধতিতে আমোনিয়া উৎপাদনে অত্যানুকূল তাপমাত্রা কত?",
    answer: "450-500°C"
  },
  {
    question: "হেবার পদ্ধতিতে আমোনিয়া উৎপাদনে অত্যানুকূল চাপ কত?",
    answer: "200 atm"
  },
  {
    question: "নাইট্রিক এসিডের শিল্পোৎপাদনে কোন পদ্ধতি ব্যবহার করা হয়?",
    answer: "অসওয়াল্ড পদ্ধতি"
  },
  {
    question: "সালফিউরিক এসিডের শিল্পোৎপাদনে কোন পদ্ধতি ব্যবহার করা হয়?",
    answer: "স্পর্শ পদ্ধতি"
  },
  
  // Phosphorus
  {
    question: "ফসফরাসের প্রধান রূপভেদ কী কী?",
    answer: "শ্বেত ফসফরাস ও লোহিত ফসফরাস"
  },
  {
    question: "শ্বেত ফসফরাস ও লোহিত ফসফরাসের মধ্যে প্রধান পার্থক্য কী?",
    answer: "শ্বেত ফসফরাস সক্রিয় ও বিষাক্ত; লোহিত ফসফরাস কম সক্রিয় ও নিরাপদ"
  },
  
  // Halogens
  {
    question: "হ্যালোজেন গ্রুপের মৌলগুলো কী কী?",
    answer: "ফ্লোরিন, ক্লোরিন, ব্রোমিন, আয়োডিন, অ্যাস্টাটিন"
  },
  {
    question: "ক্লোরিনের প্রধান ব্যবহার কী কী?",
    answer: "পানি শোধন, ব্লিচিং পাউডার প্রস্তুতি, পিভিসি উৎপাদন"
  },
  
  // Organic Chemistry
  {
    question: "কার্বনের sp³ সংকরণে বন্ধন কোণ কত?",
    answer: "109.5°"
  },
  {
    question: "কার্বনের sp² সংকরণে বন্ধন কোণ কত?",
    answer: "120°"
  },
  {
    question: "কার্বনের sp সংকরণে বন্ধন কোণ কত?",
    answer: "180°"
  },
  {
    question: "আলকেনের সাধারণ সংকেত কী?",
    answer: "CₙH₂ₙ₊₂"
  },
  {
    question: "আলকিনের সাধারণ সংকেত কী?",
    answer: "CₙH₂ₙ₋₂"
  },
  {
    question: "অ্যালকোহলের কার্যকরী মূলকের নাম কী?",
    answer: "-OH (হাইড্রক্সিল মূলক)"
  },
  {
    question: "অ্যালডিহাইডের কার্যকরী মূলকের নাম কী?",
    answer: "-CHO (অ্যালডিহাইড মূলক)"
  },
  {
    question: "কিটোনের কার্যকরী মূলকের নাম কী?",
    answer: "C=O (কার্বনাইল মূলক)"
  },
  {
    question: "কার্বক্সিলিক এসিডের কার্যকরী মূলকের নাম কী?",
    answer: "-COOH (কার্বক্সিল মূলক)"
  },
  {
    question: "অ্যামিনের কার্যকরী মূলকের নাম কী?",
    answer: "-NH₂ (অ্যামিনো মূলক)"
  },
  
  // Biomolecules
  {
    question: "গ্লুকোজের আণবিক সংকেত কী?",
    answer: "C₆H₁₂O₆"
  },
  {
    question: "সুক্রোজের আণবিক সংকেত কী?",
    answer: "C₁₂H₂₂O₁₁"
  },
  {
    question: "প্রোটিনের মূল উপাদান কী কী?",
    answer: "অ্যামিনো এসিড"
  },
  {
    question: "DNA-এর পূর্ণ রূপ কী?",
    answer: "ডিঅক্সিরাইবোনিউক্লিক এসিড"
  },
  {
    question: "RNA-এর পূর্ণ রূপ কী?",
    answer: "রাইবোনিউক্লিক এসিড"
  },
  
  // Periodic Table
  {
    question: "পর্যায় সারণিতে গ্রুপ 16-এর মৌলগুলো কী কী?",
    answer: "অক্সিজেন, সালফার, সেলেনিয়াম, টেলুরিয়াম, পোলোনিয়াম"
  },
  {
    question: "পর্যায় সারণিতে গ্রুপ 17-এর মৌলগুলো কী কী?",
    answer: "ফ্লোরিন, ক্লোরিন, ব্রোমিন, আয়োডিন, অ্যাস্টাটিন"
  },
  {
    question: "গ্রুপ 16-এর মৌলগুলোকে কী বলা হয়?",
    answer: "চ্যালকোজেন"
  },
  {
    question: "গ্রুপ 17-এর মৌলগুলোকে কী বলা হয়?",
    answer: "হ্যালোজেন"
  },
  
  // Chemical Properties
  {
    question: "আমোনিয়া পানিতে দ্রবণীয় কেন?",
    answer: "হাইড্রোজেন বন্ধনের কারণে"
  },
  {
    question: "নাইট্রিক এসিড একটি শক্তিশালী জারক কেন?",
    answer: "নাইট্রোজেনের +5 জারণ অবস্থা থাকায়"
  },
  {
    question: "সালফিউরিক এসিড একটি শক্তিশালী শোষক কেন?",
    answer: "এর পানিগ্রাহী ধর্মের কারণে"
  },
  
  // Industrial
  {
    question: "সার হিসেবে নাইট্রোজেন ও ফসফরাস যৌগের গুরুত্ব কী?",
    answer: "উদ্ভিদের বৃদ্ধির জন্য অপরিহার্য"
  },
  {
    question: "ইউরিয়া সারের সংকেত কী?",
    answer: "CO(NH₂)₂"
  },
  {
    question: "সুপার ফসফেট সারের প্রধান উপাদান কী?",
    answer: "ক্যালসিয়াম সালফেট ও ক্যালসিয়াম ফসফেট"
  }
];

// Extract Q&As from text using patterns
function extractQAsFromText(text) {
  const qas = [];
  
  for (const pattern of qaPatterns) {
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      try {
        const qa = pattern.generate(match);
        if (qa.question.length > 5 && qa.answer.length > 5) {
          qas.push(qa);
        }
      } catch (e) {
        // Skip invalid matches
      }
    }
  }
  
  return qas;
}

// Extract chemical formulas and their names
function extractFormulas(text) {
  const formulas = [];
  const formulaRegex = /([A-Z][a-z]?\d*[A-Z]?[a-z]?\d*)\s*([আ-হ]+)/g;
  let match;
  
  while ((match = formulaRegex.exec(text)) !== null) {
    if (match[1].length >= 2 && match[2].length >= 3) {
      formulas.push({
        question: `${match[1]} যৌগের নাম কী?`,
        answer: match[2].trim()
      });
    }
  }
  
  return formulas;
}

// Main execution
console.log('Generating Q&A from Chemistry text...\n');

const extractedQAs = extractQAsFromText(chemistryText);
const extractedFormulas = extractFormulas(chemistryText);

// Combine all QAs
const allQAs = [...manualQAs, ...extractedQAs, ...extractedFormulas];

// Remove duplicates
const uniqueQAs = [];
const seen = new Set();

for (const qa of allQAs) {
  const key = qa.question.trim();
  if (!seen.has(key) && key.length > 5) {
    seen.add(key);
    uniqueQAs.push(qa);
  }
}

// Shuffle and limit
const shuffled = uniqueQAs.sort(() => Math.random() - 0.5);
const finalQAs = shuffled.slice(0, 200); // Limit to 200 Q&As

// Save as JSONL (JSON Lines) for training
const outputPath = path.join(__dirname, 'Books/qa_training_data.jsonl');
const jsonlContent = finalQAs.map(qa => JSON.stringify(qa)).join('\n');
fs.writeFileSync(outputPath, jsonlContent, 'utf8');

console.log(`Generated ${finalQAs.length} Q&A pairs`);
console.log(`Saved to: ${outputPath}`);

// Also save as regular JSON for easy reading
const jsonPath = path.join(__dirname, 'Books/qa_training_data.json');
fs.writeFileSync(jsonPath, JSON.stringify(finalQAs, null, 2), 'utf8');

console.log(`Also saved to: ${jsonPath}`);

// Print sample Q&As
console.log('\n--- Sample Q&A Pairs ---\n');
finalQAs.slice(0, 10).forEach((qa, i) => {
  console.log(`${i + 1}. প্রশ্ন: ${qa.question}`);
  console.log(`   উত্তর: ${qa.answer}\n`);
});
