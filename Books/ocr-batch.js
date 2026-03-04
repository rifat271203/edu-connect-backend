const { exec } = require("child_process");
const fs = require("fs");

const start = Number(process.argv[2] || 1);
const end = Number(process.argv[3] || 10);

function pad3(n) {
  return String(n).padStart(3, "0"); // 1 -> "001"
}

function run(i) {
  if (i > end) return console.log("Batch done ✅");

  const img = `page-${pad3(i)}.png`;      // page-001.png
  const out = `ocr-${pad3(i)}`;          // ocr-001.txt

  if (!fs.existsSync(img)) {
    console.log(`Skip page ${i} ❌ Missing ${img}`);
    return run(i + 1);
  }

  const cmd = `"C:\\Program Files\\Tesseract-OCR\\tesseract.exe" "${img}" "${out}" -l ben --psm 6`;

  exec(cmd, (err) => {
    if (err) console.log("Error on page", i, err.message);
    else console.log(`Done page ${i} (${img})`);

    run(i + 1);
  });
}

run(start);