import fs from "fs";

const start = Number(process.argv[2] || 1);
const end = Number(process.argv[3] || 50);

let out = "";

for (let i = start; i <= end; i++) {
  out += fs.readFileSync(`ocr-${i}.txt`, "utf8") + "\n";
}

fs.appendFileSync("chemistry_raw.txt", out);
console.log(`Merged ${start}-${end} ✅`);
