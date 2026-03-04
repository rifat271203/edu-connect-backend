import { exec } from "child_process";

const start = Number(process.argv[2] || 1);
const end = Number(process.argv[3] || 50);

function run(i) {
  if (i > end) return console.log("Batch done ✅");

  const cmd = `"C:\\Program Files\\Tesseract-OCR\\tesseract.exe" page-${i}.png ocr-${i} -l ben --psm 6`;

  exec(cmd, (err) => {
    if (err) console.log("Error on page", i, err.message);
    else console.log("Done page", i);

    run(i + 1);
  });
}

run(start);
