#!/usr/bin/env node

/**
 * Run batch analysis over a generated Series B run folder and write a scorecard.
 *
 * Usage:
 *  node scripts/run-seriesb-batch.js --run <runId>
 *  node scripts/run-seriesb-batch.js --dir test-data/generated/series-b/<runId>
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function dollars(n) {
  return `$${Math.round(n).toLocaleString()}`;
}

function padRight(s, n) {
  const str = String(s);
  return str.length >= n ? str : str + " ".repeat(n - str.length);
}

function main() {
  const runId = argValue("--run");
  const dirArg = argValue("--dir");

  const root = path.join(__dirname, "..");
  const baseDir = dirArg
    ? path.join(root, dirArg)
    : runId
      ? path.join(root, "test-data", "generated", "series-b", runId)
      : null;

  if (!baseDir || !fs.existsSync(baseDir)) {
    console.error("❌ Run directory not found.");
    console.error("   Provide --run <runId> or --dir <path>");
    process.exit(1);
  }

  const manifestPath = path.join(baseDir, "manifest.json");
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : null;

  const datasetNames = manifest?.datasets
    ? manifest.datasets
    : fs
        .readdirSync(baseDir)
        .filter((d) => fs.statSync(path.join(baseDir, d)).isDirectory());

  console.log(`🧪 Running batch analysis for ${datasetNames.length} datasets`);
  console.log(`   Base: ${baseDir}\n`);

  const results = [];

  for (const name of datasetNames) {
    const dsDir = path.join(baseDir, name);
    const usage = path.join(dsDir, "transactions.csv");
    const stripe = path.join(dsDir, "stripe-export.csv");
    const expected = path.join(dsDir, "expected.json");

    if (!fs.existsSync(usage) || !fs.existsSync(stripe)) {
      console.warn(`⚠️  Skipping ${name} (missing csv files)`);
      continue;
    }

    const proc = spawnSync(
      "node",
      [path.join(root, "scripts", "run-test-analysis.js"), "--usage", usage, "--stripe", stripe, "--expected", expected, "--quiet"],
      { encoding: "utf8" }
    );

    if (proc.status !== 0) {
      console.error(`❌ Analysis failed for ${name}`);
      console.error(proc.stderr || proc.stdout);
      process.exit(1);
    }

    const jsonText = proc.stdout.trim();
    const scorecard = JSON.parse(jsonText);
    results.push({ name, scorecard });

    console.log(`✅ ${padRight(name, 18)} score=${scorecard.score?.final ?? "n/a"}  match=${Math.round(scorecard.matchRatePct)}%  anomalies=${scorecard.totals.anomalies}`);
  }

  const outDir = path.join(baseDir, "_analysis");
  ensureDir(outDir);

  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2) + "\n", "utf8");

  // Markdown scorecard
  let md = `# Series B Analysis Scorecard\n\n`;
  md += `Base: \`${path.relative(root, baseDir)}\`\n\n`;
  if (manifest) {
    md += `- **runId**: \`${manifest.runId}\`\n`;
    md += `- **seed**: \`${manifest.seed}\`\n`;
    md += `- **days**: \`${manifest.days}\`\n`;
    md += `- **rows (requested)**: \`${manifest.rows}\`\n\n`;
  }

  md += `## Results\n\n`;
  md += `| Dataset | Score | Match rate | Anomalies | Revenue at risk |\n`;
  md += `|---|---:|---:|---:|---:|\n`;

  for (const r of results) {
    const sc = r.scorecard;
    md += `| ${r.name} | ${sc.score?.final ?? "n/a"} | ${Math.round(sc.matchRatePct)}% | ${sc.totals.anomalies} | ${dollars(sc.totals.revenueAtRisk)} |\n`;
  }

  md += `\n## Automapping checks\n\n`;
  md += `For each dataset we capture the detected column mapping in \`results.json\`. Watch for null/undefined mappings.\n\n`;

  md += `## Improvement ideas (from runs)\n\n`;
  md += `- **If match rate is unexpectedly low**: widen date window or improve customer normalization.\n`;
  md += `- **If fee discrepancies are under/over detected**: tune fee diff threshold and ensure cents-vs-dollars parsing is consistent.\n`;
  md += `- **If disputes are missed**: ensure the disputed column is detected and normalized (TRUE/true/1).\n`;
  md += `- **If duplicates are missed**: consider grouping by (customer, amount, day) and ignoring idempotency-safe retries.\n`;

  fs.writeFileSync(path.join(outDir, "SCORECARD.md"), md, "utf8");

  console.log(`\n📄 Wrote:\n   - ${path.relative(root, path.join(outDir, "SCORECARD.md"))}\n   - ${path.relative(root, path.join(outDir, "results.json"))}\n`);
}

main();

