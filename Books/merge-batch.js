const fs = require("fs");

const start = Number(process.argv[2] || 1);
const end = Number(process.argv[3] || 50);

function pad3(n) {
  return String(n).padStart(3, "0");
}

let out = "";

for (let i = start; i <= end; i++) {
  const file = `ocr-${pad3(i)}.txt`;

  if (!fs.existsSync(file)) {
    console.log(`Skip missing: ${file}`);
    continue;
  }

  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) {
    console.log(`Skip empty: ${file}`);
    continue;
  }

  out += `\n\n=== PAGE ${i} ===\n\n${text}\n`;
}

fs.appendFileSync("chemistry_raw.txt", out, "utf8");
console.log(`Merged ${start}-${end} ✅ into chemistry_raw.txt`);