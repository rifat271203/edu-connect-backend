const fs = require("fs");

const input = "chemistry_clean.txt";
const output = "chunks.jsonl"; // JSON per line (best for huge data)

const text = fs.readFileSync(input, "utf8");

// Simple chunk by words
function chunkByWords(str, chunkSize = 350, overlap = 50) {
  const words = str.split(/\s+/).filter(Boolean);
  const chunks = [];

  let i = 0;
  while (i < words.length) {
    const chunkWords = words.slice(i, i + chunkSize);
    const chunkText = chunkWords.join(" ").trim();

    if (chunkText.length > 50) chunks.push(chunkText);

    i += (chunkSize - overlap);
  }

  return chunks;
}

const chunks = chunkByWords(text, 350, 50);

// Write as JSONL (each line is a chunk object)
const stream = fs.createWriteStream(output, { flags: "w" });

chunks.forEach((c, idx) => {
  const obj = {
    id: idx + 1,
    subject: "chemistry",
    level: "HSC",
    book: "HSC Chemistry 2nd Paper",
    text: c
  };
  stream.write(JSON.stringify(obj) + "\n");
});

stream.end();
console.log(`✅ Created ${chunks.length} chunks -> chunks.jsonl`);