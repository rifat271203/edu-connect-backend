const fs = require("fs");

const input = "chemistry_raw.txt";
const output = "chemistry_clean.txt";

let text = fs.readFileSync(input, "utf8");

// Normalize newlines
text = text.replace(/\r\n/g, "\n");

// Remove too many blank lines
text = text.replace(/\n{3,}/g, "\n\n");

// Remove weird non-Bangla symbols but keep Bangla + English + numbers + common punctuation
text = text.replace(/[^\u0980-\u09FFa-zA-Z0-9\s.,;:'"“”‘’!?()%\-–—=+\/\\\n]/g, "");

// Fix spacing
text = text.replace(/[ \t]{2,}/g, " ");

// Trim each line
text = text
  .split("\n")
  .map((l) => l.trim())
  .join("\n");

fs.writeFileSync(output, text, "utf8");
console.log("✅ Cleaned -> chemistry_clean.txt");