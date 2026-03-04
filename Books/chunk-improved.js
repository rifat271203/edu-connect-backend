const fs = require("fs");
const path = require("path");

// Use __dirname to get the correct path relative to the script location
const input = path.join(__dirname, "chemistry_clean.txt");
const output = path.join(__dirname, "chunks_improved.jsonl");

const text = fs.readFileSync(input, "utf8");

// Clean OCR artifacts from text
function cleanText(str) {
  return str
    // Remove phone numbers (Bangladeshi format)
    .replace(/01\d{9}/g, "")
    // Remove page markers
    .replace(/=== PAGE \d+ ===/g, "")
    // Remove standalone numbers that are likely OCR noise
    .replace(/\b\d{10,}\b/g, "")
    // Remove multiple consecutive numbers (OCR artifacts)
    .replace(/\b\d{4,}\.\d+\b/g, "")
    // Remove excessive whitespace
    .replace(/\s+/g, " ")
    // Remove lines that are mostly numbers
    .split("\n")
    .filter(line => {
      const numbers = line.match(/\d/g) || [];
      const letters = line.match(/[a-zA-Z\u0980-\u09FF]/g) || [];
      return numbers.length < letters.length * 0.5 || letters.length < 5;
    })
    .join("\n")
    .trim();
}

// Split text into chapters based on patterns
function detectChapters(str) {
  const lines = str.split("\n");
  const chapters = [];
  let currentChapter = { title: "প্রস্তাবনা", content: "" };
  
  // Chapter patterns in Bengali
  const chapterPatterns = [
    /^অধ্যায়\s*[০-৯\d]+/i,
    /^চ্যাপ্টার\s*[০-৯\d]+/i,
    /^Chapter\s*\d+/i,
    /^\d+\.\s*[অ-ঔ]/,  // Numbered sections starting with Bengali vowel
  ];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    let isChapterStart = false;
    
    for (const pattern of chapterPatterns) {
      if (pattern.test(trimmedLine)) {
        isChapterStart = true;
        break;
      }
    }
    
    // Also check for chapter titles in the syllabus pattern
    if (/^[১-৯]\d*\s+[অ-ঔ]/.test(trimmedLine) && trimmedLine.length < 100) {
      isChapterStart = true;
    }
    
    if (isChapterStart && currentChapter.content.trim().length > 200) {
      chapters.push(currentChapter);
      currentChapter = { title: trimmedLine.substring(0, 100), content: "" };
    } else {
      currentChapter.content += "\n" + line;
    }
  }
  
  if (currentChapter.content.trim().length > 0) {
    chapters.push(currentChapter);
  }
  
  return chapters;
}

// Semantic chunking by paragraphs with overlap
function chunkBySemantics(str, maxChunkSize = 500, overlap = 100) {
  // First, clean the text
  const cleaned = cleanText(str);
  
  // Split by paragraphs (double newlines or significant breaks)
  const paragraphs = cleaned
    .split(/\n\s*\n|\n(?=[অ-ঔ])/)
    .map(p => p.trim())
    .filter(p => p.length > 20);
  
  const chunks = [];
  let currentChunk = "";
  let currentParagraphs = [];
  
  for (const para of paragraphs) {
    if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 50) {
      // Save current chunk
      chunks.push({
        text: currentChunk.trim(),
        paragraphCount: currentParagraphs.length
      });
      
      // Start new chunk with overlap from end of previous
      const words = currentChunk.split(" ");
      const overlapWords = words.slice(-Math.floor(overlap / 5)).join(" ");
      currentChunk = overlapWords + " " + para;
      currentParagraphs = [para];
    } else {
      currentChunk += "\n\n" + para;
      currentParagraphs.push(para);
    }
  }
  
  // Add final chunk
  if (currentChunk.trim().length > 50) {
    chunks.push({
      text: currentChunk.trim(),
      paragraphCount: currentParagraphs.length
    });
  }
  
  return chunks;
}

// Alternative: Simple sentence-aware chunking
function chunkBySentences(str, targetWords = 400, overlapWords = 50) {
  const cleaned = cleanText(str);
  
  // Split into sentences (Bengali sentence endings: ।, ?, !)
  const sentences = cleaned
    .split(/(?<=[।?!])\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
  
  const chunks = [];
  let currentWords = [];
  
  for (const sentence of sentences) {
    const sentenceWords = sentence.split(/\s+/);
    
    if (currentWords.length + sentenceWords.length > targetWords && currentWords.length > 0) {
      // Save chunk
      chunks.push(currentWords.join(" "));
      
      // Overlap: keep last N words
      currentWords = currentWords.slice(-overlapWords);
    }
    
    currentWords.push(...sentenceWords);
  }
  
  if (currentWords.length > 20) {
    chunks.push(currentWords.join(" "));
  }
  
  return chunks;
}

console.log("Processing text...");

// Try semantic chunking first
const chapters = detectChapters(text);
console.log(`Found ${chapters.length} potential chapters`);

// If chapters found, use chapter-based chunking
let chunks;
if (chapters.length > 1) {
  chunks = [];
  chapters.forEach((chapter, idx) => {
    const chapterChunks = chunkBySentences(chapter.content, 400, 50);
    chapterChunks.forEach((chunkText, chunkIdx) => {
      chunks.push({
        id: chunks.length + 1,
        chapter: chapter.title,
        chapterIndex: idx + 1,
        chunkIndex: chunkIdx + 1,
        subject: "chemistry",
        level: "HSC",
        book: "HSC Chemistry 2nd Paper",
        text: chunkText
      });
    });
  });
} else {
  // Fall back to sentence-based chunking
  const simpleChunks = chunkBySentences(text, 400, 50);
  chunks = simpleChunks.map((chunk, idx) => ({
    id: idx + 1,
    subject: "chemistry",
    level: "HSC",
    book: "HSC Chemistry 2nd Paper",
    text: chunk
  }));
}

// Write as JSONL
const stream = fs.createWriteStream(output, { flags: "w" });

chunks.forEach((chunk) => {
  stream.write(JSON.stringify(chunk) + "\n");
});

stream.end();

console.log(`✅ Created ${chunks.length} improved chunks -> ${output}`);
console.log(`Sample chunk:`);
console.log(JSON.stringify(chunks[0], null, 2).substring(0, 500) + "...");
