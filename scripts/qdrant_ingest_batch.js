require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function parseCliArgs(argv) {
  const args = {
    configPath: "scripts/ingest-map.example.json",
  };

  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--config") {
      args.configPath = argv[i + 1] || args.configPath;
      i += 1;
    }
  }

  return args;
}

function runIngestJob(job) {
  return new Promise((resolve, reject) => {
    const ingestScript = path.join("scripts", "qdrant_ingest.js");

    const commandArgs = [
      ingestScript,
      "--jsonl",
      job.jsonl,
      "--subject",
      job.subject,
      "--category",
      job.category,
      "--book",
      job.book || "Question Bank",
    ];

    if (job.collection) {
      commandArgs.push("--collection", job.collection);
    }

    const child = spawn(process.execPath, commandArgs, {
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Ingest job failed with exit code ${code}`));
    });
  });
}

async function main() {
  const { configPath } = parseCliArgs(process.argv);
  const absoluteConfigPath = path.resolve(configPath);

  if (!fs.existsSync(absoluteConfigPath)) {
    throw new Error(`Config file not found: ${absoluteConfigPath}`);
  }

  const raw = fs.readFileSync(absoluteConfigPath, "utf8");
  const jobs = JSON.parse(raw);

  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error("Config must be a non-empty JSON array");
  }

  console.log(`Loaded ${jobs.length} ingest jobs from: ${configPath}`);

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (!job.jsonl || !job.subject || !job.category) {
      throw new Error(
        `Invalid job at index ${i}. Required fields: jsonl, subject, category`
      );
    }

    console.log(
      `\n[${i + 1}/${jobs.length}] Ingesting ${job.jsonl} -> collection=${job.collection || process.env.QDRANT_COLLECTION || "hsc_chem_2nd_paper"}, subject=${job.subject}, category=${job.category}`
    );

    await runIngestJob(job);
  }

  console.log("\n✅ All ingest jobs completed");
}

main().catch((error) => {
  console.error("❌ Batch ingest failed:", error.message);
  process.exit(1);
});

