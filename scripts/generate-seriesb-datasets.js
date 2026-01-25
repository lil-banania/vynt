#!/usr/bin/env node

/**
 * Generate on-demand Series B test datasets (90 days, USD, >=10k txns)
 * Produces multiple pairs of:
 *  - transactions.csv (internal DB / product transactions)
 *  - stripe-export.csv (Stripe export)
 * Plus expected.json ground truth for scoring.
 *
 * Output: test-data/generated/series-b/<runId>/<datasetName>/*
 *
 * Usage:
 *  node scripts/generate-seriesb-datasets.js
 *  node scripts/generate-seriesb-datasets.js --rows 12000 --days 90 --seed 42
 */

const fs = require("fs");
const path = require("path");

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function intArg(flag, fallback) {
  const v = argValue(flag);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function chance(rng, p) {
  return rng() < p;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function fmtIso(date) {
  return date.toISOString();
}

function fmtUnixSec(date) {
  return Math.floor(date.getTime() / 1000);
}

function fmtUnixMs(date) {
  return date.getTime();
}

function centsFromUsdString(amountUsd) {
  return Math.round(Number(amountUsd) * 100);
}

function formatUsdStringFromCents(cents) {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function stripeFeeCents(amountCents) {
  // Stripe-ish fee: 2.9% + $0.30
  return Math.round(amountCents * 0.029) + 30;
}

function toCSV(rows, headers) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((h) => {
      const v = row[h];
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(values.join(","));
  }
  return lines.join("\n") + "\n";
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function nowRunId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// Dataset generator
// ---------------------------------------------------------------------------

function genSeriesBCustomers(rng, count) {
  const customers = [];
  for (let i = 1; i <= count; i++) {
    customers.push(`cus_${String(i).padStart(6, "0")}`);
  }
  return customers;
}

function genBaseTransactionAmountCents(rng) {
  // Series B: mix of SMB + mid-market. Skewed distribution.
  // Base charge between $49 and $999 with a long tail to $5k.
  const roll = rng();
  if (roll < 0.65) return centsFromUsdString(clamp(49 + rng() * 250, 49, 299).toFixed(2));
  if (roll < 0.9) return centsFromUsdString(clamp(299 + rng() * 800, 299, 1499).toFixed(2));
  return centsFromUsdString(clamp(1500 + rng() * 3500, 1500, 5000).toFixed(2));
}

function genTxnId(i) {
  return `txn_${String(i).padStart(8, "0")}`;
}

function genChargeId(i) {
  return `ch_${String(i).padStart(10, "0")}`;
}

function genDateInWindow(rng, days) {
  const now = Date.now();
  const windowMs = days * 24 * 60 * 60 * 1000;
  const offset = Math.floor(rng() * windowMs);
  return new Date(now - offset);
}

function summarizeExpected(expected) {
  const cats = Object.keys(expected.categories);
  const total = cats.reduce((sum, k) => sum + expected.categories[k].count, 0);
  const impact = cats.reduce((sum, k) => sum + expected.categories[k].annualImpactCents, 0);
  return { total, impact };
}

function createExpectedSkeleton(days, currency, rows) {
  return {
    meta: {
      days,
      currency,
      requestedRows: rows,
      generatedAt: new Date().toISOString(),
    },
    automapping: {
      transactions: {},
      stripe: {},
    },
    totals: {
      usageRows: 0,
      stripeRows: 0,
    },
    categories: {
      matched: { count: 0, annualImpactCents: 0 },
      unbilled_usage: { count: 0, annualImpactCents: 0 },
      zombie_subscription: { count: 0, annualImpactCents: 0 },
      failed_payment: { count: 0, annualImpactCents: 0 },
      duplicate_charge: { count: 0, annualImpactCents: 0 },
      fee_discrepancy: { count: 0, annualImpactCents: 0 },
      disputed_charge: { count: 0, annualImpactCents: 0 },
      other: { count: 0, annualImpactCents: 0 },
    },
    notes: [],
  };
}

/**
 * Build one dataset.
 *
 * Strategy:
 * - Generate N internal “usage/transactions” rows (>=10k)
 * - Generate Stripe charges with controlled mismatches:
 *   - matched: DB row has matching Stripe charge (by customer+amount+close date)
 *   - unbilled: DB row has NO Stripe charge
 *   - zombie: Stripe charge has NO DB row
 *   - failed: DB row is failed (no Stripe)
 *   - duplicates: 1 DB row, 2 Stripe charges same customer+amount+date
 *   - fee discrepancy: matched but fee differs by > $0.50
 *   - disputed: matched but DB status disputed or Stripe disputed flag
 */
function buildDataset(rng, { name, days, rows, leakageProfile, mappingVariant }) {
  const customerCount = 1800;
  const customers = genSeriesBCustomers(rng, customerCount);

  const usageRows = [];
  const stripeRows = [];
  let txnSeq = 1;
  let chargeSeq = 1;

  const expected = createExpectedSkeleton(days, "USD", rows);
  expected.meta.dataset = name;
  expected.meta.leakageProfile = leakageProfile.name;
  expected.meta.mappingVariant = mappingVariant.name;

  const makeCustomer = () => pick(rng, customers);
  const makeAmount = () => genBaseTransactionAmountCents(rng);
  const makeDate = () => genDateInWindow(rng, days);

  // Determine category quotas (counts) for THIS dataset.
  const totalRows = Math.max(rows, 10000);
  const quota = leakageProfile.quota(totalRows);

  // Helper: add to expected
  function bump(cat, count, impactCents) {
    expected.categories[cat].count += count;
    expected.categories[cat].annualImpactCents += impactCents;
  }

  // 1) Matched baseline
  for (let i = 0; i < quota.matched; i++) {
    const customer = makeCustomer();
    const amount = makeAmount();
    const created = makeDate();
    const fee = stripeFeeCents(amount);

    usageRows.push({
      __category: "matched",
      transaction_id: genTxnId(txnSeq++),
      customer_id: customer,
      amount,
      status: "succeeded",
      created_at: Math.floor(created.getTime() / 1000),
      fee_amount: fee,
      description: pick(rng, ["Pro Plan", "Usage Invoice", "Seat Add-on", "Overage"]),
    });

    stripeRows.push({
      __category: "matched",
      id: genChargeId(chargeSeq++),
      customer,
      amount,
      status: "succeeded",
      created: Math.floor(created.getTime() / 1000),
      fee,
      disputed: "FALSE",
      description: "Charge",
    });
    bump("matched", 1, 0);
  }

  // 2) Unbilled usage (DB only)
  for (let i = 0; i < quota.unbilled; i++) {
    const customer = makeCustomer();
    const amount = makeAmount();
    const created = makeDate();
    const fee = stripeFeeCents(amount);

    usageRows.push({
      __category: "unbilled_usage",
      transaction_id: genTxnId(txnSeq++),
      customer_id: customer,
      amount,
      status: "succeeded",
      created_at: Math.floor(created.getTime() / 1000),
      fee_amount: fee,
      description: "Usage event billed internally",
    });
    bump("unbilled_usage", 1, amount);
  }

  // 3) Failed payments (DB failed, no Stripe)
  for (let i = 0; i < quota.failed; i++) {
    const customer = makeCustomer();
    const amount = makeAmount();
    const created = makeDate();

    usageRows.push({
      __category: "failed_payment",
      transaction_id: genTxnId(txnSeq++),
      customer_id: customer,
      amount,
      status: "failed",
      created_at: Math.floor(created.getTime() / 1000),
      fee_amount: 0,
      description: "Payment failed internally",
    });
    bump("failed_payment", 1, amount);
  }

  // 4) Fee discrepancies (matched but fee mismatch)
  for (let i = 0; i < quota.fees; i++) {
    const customer = makeCustomer();
    const amount = makeAmount();
    const created = makeDate();
    const fee = stripeFeeCents(amount);
    const wrongFee = fee + Math.round(100 + rng() * 400); // +$1 to +$5

    usageRows.push({
      __category: "fee_discrepancy",
      transaction_id: genTxnId(txnSeq++),
      customer_id: customer,
      amount,
      status: "succeeded",
      created_at: Math.floor(created.getTime() / 1000),
      fee_amount: fee,
      description: "Fee differs",
    });

    stripeRows.push({
      __category: "fee_discrepancy",
      id: genChargeId(chargeSeq++),
      customer,
      amount,
      status: "succeeded",
      created: Math.floor(created.getTime() / 1000),
      fee: wrongFee,
      disputed: "FALSE",
      description: "Charge",
    });
    bump("fee_discrepancy", 1, Math.abs(wrongFee - fee));
  }

  // 5) Disputed charges (matched, DB says disputed OR Stripe flag TRUE)
  for (let i = 0; i < quota.disputed; i++) {
    const customer = makeCustomer();
    const amount = makeAmount();
    const created = makeDate();
    const fee = stripeFeeCents(amount);
    const stripeDisputed = chance(rng, 0.6) ? "TRUE" : "FALSE";

    usageRows.push({
      __category: "disputed_charge",
      transaction_id: genTxnId(txnSeq++),
      customer_id: customer,
      amount,
      status: "disputed",
      created_at: Math.floor(created.getTime() / 1000),
      fee_amount: fee,
      description: "Charge disputed internally",
    });

    stripeRows.push({
      __category: "disputed_charge",
      id: genChargeId(chargeSeq++),
      customer,
      amount,
      status: "succeeded",
      created: Math.floor(created.getTime() / 1000),
      fee,
      disputed: stripeDisputed,
      description: "Charge",
    });
    bump("disputed_charge", 1, amount + (stripeDisputed === "TRUE" ? 1500 : 0)); // +$15 overhead if disputed
  }

  // 6) Duplicate charges (1 DB row, 2 Stripe charges)
  for (let i = 0; i < quota.duplicates; i++) {
    const customer = makeCustomer();
    const amount = makeAmount();
    const created = makeDate();
    const fee = stripeFeeCents(amount);

    usageRows.push({
      __category: "duplicate_charge",
      transaction_id: genTxnId(txnSeq++),
      customer_id: customer,
      amount,
      status: "succeeded",
      created_at: Math.floor(created.getTime() / 1000),
      fee_amount: fee,
      description: "Single internal charge",
    });

    // Stripe twice (duplicate)
    for (let j = 0; j < 2; j++) {
      stripeRows.push({
        __category: "duplicate_charge",
        id: genChargeId(chargeSeq++),
        customer,
        amount,
        status: "succeeded",
        created: Math.floor(created.getTime() / 1000),
        fee,
        disputed: "FALSE",
        description: "Charge",
      });
    }
    bump("duplicate_charge", 1, amount); // duplicate impact approximated as 1 extra charge
  }

  // 7) Zombie subscriptions (Stripe only)
  for (let i = 0; i < quota.zombie; i++) {
    const customer = makeCustomer();
    const amount = makeAmount();
    const created = makeDate();
    const fee = stripeFeeCents(amount);

    stripeRows.push({
      __category: "zombie_subscription",
      id: genChargeId(chargeSeq++),
      customer,
      amount,
      status: "succeeded",
      created: Math.floor(created.getTime() / 1000),
      fee,
      disputed: "FALSE",
      description: "Subscription renewal",
    });
    bump("zombie_subscription", 1, amount);
  }

  // Shuffle rows (realistic export)
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  shuffle(usageRows);
  shuffle(stripeRows);

  // Apply mapping variants (headers, formats) without changing underlying values.
  const mapped = mappingVariant.apply({ usageRows, stripeRows }, { rng });

  // Build expected automapping hints for scoring
  expected.automapping.transactions = mapped.usageMappingMeta;
  expected.automapping.stripe = mapped.stripeMappingMeta;
  expected.totals.usageRows = mapped.usageRows.length;
  expected.totals.stripeRows = mapped.stripeRows.length;

  // Expected totals
  const summary = summarizeExpected(expected);
  expected.totals.expectedAnomalies = summary.total - expected.categories.matched.count;
  expected.totals.expectedImpact = formatUsdStringFromCents(summary.impact);

  return {
    usageRows: mapped.usageRows,
    stripeRows: mapped.stripeRows,
    expected,
    headers: { usageHeaders: mapped.usageHeaders, stripeHeaders: mapped.stripeHeaders },
  };
}

// ---------------------------------------------------------------------------
// Mapping variants (automapping stress)
// ---------------------------------------------------------------------------

const mappingVariants = {
  standard: {
    name: "standard",
    apply: ({ usageRows, stripeRows }) => {
      // Keep canonical headers, unix seconds
      const u = usageRows.map((r) => ({
        transaction_id: r.transaction_id,
        customer_id: r.customer_id,
        amount: r.amount,
        status: r.status,
        created_at: r.created_at,
        fee_amount: r.fee_amount,
      }));
      const s = stripeRows.map((r) => ({
        id: r.id,
        customer: r.customer,
        amount: r.amount,
        status: r.status,
        created: r.created,
        fee: r.fee,
        disputed: r.disputed,
      }));
      return {
        usageRows: u,
        stripeRows: s,
        usageHeaders: ["transaction_id", "customer_id", "amount", "status", "created_at", "fee_amount"],
        stripeHeaders: ["id", "customer", "amount", "status", "created", "fee", "disputed"],
        usageMappingMeta: { transaction_id: "transaction_id", customer_id: "customer_id", amount: "amount", status: "status", created_at: "created_at", fee_amount: "fee_amount" },
        stripeMappingMeta: { id: "id", customer: "customer", amount: "amount", status: "status", created: "created", fee: "fee", disputed: "disputed" },
      };
    },
  },
  torture: {
    name: "torture",
    apply: ({ usageRows, stripeRows }, { rng }) => {
      // Vary headers + formats to validate automapping robustness.
      // - amount as "$1,234.00" (string)
      // - created_at as ISO OR unix ms randomly
      // - customer_id as "CUS-000123" (mixed case + separators)
      const u = usageRows.map((r) => {
        const created = new Date(r.created_at * 1000);
        const createdVal = chance(rng, 0.5) ? fmtIso(created) : fmtUnixMs(created);
        const amountVal = chance(rng, 0.6) ? formatUsdStringFromCents(r.amount) : String(r.amount);
        return {
          txn_id: r.transaction_id,
          cust_id: r.customer_id.replace("cus_", "CUS-"),
          gross_amount: amountVal,
          payment_status: r.status,
          timestamp: createdVal,
          processing_fee: String(r.fee_amount),
        };
      });

      const s = stripeRows.map((r) => {
        const created = new Date(r.created * 1000);
        const createdVal = chance(rng, 0.5) ? fmtUnixSec(created) : fmtIso(created);
        const amountVal = chance(rng, 0.5) ? formatUsdStringFromCents(r.amount) : String(r.amount);
        return {
          charge_id: r.id,
          stripe_customer_id: r.customer.replace("cus_", "cus-"),
          charge_amount: amountVal,
          charge_status: r.status,
          payment_date: createdVal,
          stripe_fee: String(r.fee),
          is_disputed: r.disputed,
        };
      });

      return {
        usageRows: u,
        stripeRows: s,
        usageHeaders: ["txn_id", "cust_id", "gross_amount", "payment_status", "timestamp", "processing_fee"],
        stripeHeaders: ["charge_id", "stripe_customer_id", "charge_amount", "charge_status", "payment_date", "stripe_fee", "is_disputed"],
        usageMappingMeta: { transaction_id: "txn_id", customer_id: "cust_id", amount: "gross_amount", status: "payment_status", created_at: "timestamp", fee_amount: "processing_fee" },
        stripeMappingMeta: { id: "charge_id", customer: "stripe_customer_id", amount: "charge_amount", status: "charge_status", created: "payment_date", fee: "stripe_fee", disputed: "is_disputed" },
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Leakage profiles
// ---------------------------------------------------------------------------

const leakageProfiles = {
  low: {
    name: "low",
    quota: (total) => {
      // ~1.5% anomalies
      const unbilled = Math.floor(total * 0.004);
      const zombie = Math.floor(total * 0.003);
      const failed = Math.floor(total * 0.003);
      const duplicates = Math.floor(total * 0.001);
      const fees = Math.floor(total * 0.003);
      const disputed = Math.floor(total * 0.001);
      const matched = total - (unbilled + zombie + failed + duplicates + fees + disputed);
      return { matched, unbilled, zombie, failed, duplicates, fees, disputed };
    },
  },
  medium: {
    name: "medium",
    quota: (total) => {
      // ~6-7% anomalies
      const unbilled = Math.floor(total * 0.02);
      const zombie = Math.floor(total * 0.015);
      const failed = Math.floor(total * 0.015);
      const duplicates = Math.floor(total * 0.007);
      const fees = Math.floor(total * 0.01);
      const disputed = Math.floor(total * 0.005);
      const matched = total - (unbilled + zombie + failed + duplicates + fees + disputed);
      return { matched, unbilled, zombie, failed, duplicates, fees, disputed };
    },
  },
  high: {
    name: "high",
    quota: (total) => {
      // ~18-20% anomalies
      const unbilled = Math.floor(total * 0.06);
      const zombie = Math.floor(total * 0.04);
      const failed = Math.floor(total * 0.03);
      const duplicates = Math.floor(total * 0.02);
      const fees = Math.floor(total * 0.03);
      const disputed = Math.floor(total * 0.01);
      const matched = total - (unbilled + zombie + failed + duplicates + fees + disputed);
      return { matched, unbilled, zombie, failed, duplicates, fees, disputed };
    },
  },
};

function writeDataset(outDir, datasetName, { usageRows, stripeRows, expected, headers }) {
  const dsDir = path.join(outDir, datasetName);
  ensureDir(dsDir);

  // Strip __category helper if present
  const usage = usageRows.map((r) => {
    const { __category, ...rest } = r;
    return rest;
  });
  const stripe = stripeRows.map((r) => {
    const { __category, ...rest } = r;
    return rest;
  });

  fs.writeFileSync(path.join(dsDir, "transactions.csv"), toCSV(usage, headers.usageHeaders), "utf8");
  fs.writeFileSync(path.join(dsDir, "stripe-export.csv"), toCSV(stripe, headers.stripeHeaders), "utf8");
  fs.writeFileSync(path.join(dsDir, "expected.json"), JSON.stringify(expected, null, 2) + "\n", "utf8");
}

function main() {
  const days = intArg("--days", 90);
  const rows = intArg("--rows", 10000);
  const seed = intArg("--seed", Date.now() % 100000);

  const runId = nowRunId();
  const rng = mulberry32(seed);

  const outDir = path.join(__dirname, "..", "test-data", "generated", "series-b", runId);
  ensureDir(outDir);

  const datasets = [
    { name: "A-low", leakage: leakageProfiles.low, mapping: mappingVariants.standard },
    { name: "B-medium", leakage: leakageProfiles.medium, mapping: mappingVariants.standard },
    { name: "C-high", leakage: leakageProfiles.high, mapping: mappingVariants.standard },
    { name: "D-automap-torture", leakage: leakageProfiles.medium, mapping: mappingVariants.torture },
    { name: "E-stripe-noisy", leakage: leakageProfiles.medium, mapping: mappingVariants.standard },
  ];

  console.log(`🧪 Generating Series B datasets (USD, ${days}d, >=${rows} rows)`);
  console.log(`   Seed: ${seed}`);
  console.log(`   Output: ${outDir}\n`);

  for (const ds of datasets) {
    // Create a dataset-specific RNG so datasets are stable relative to seed
    const dsSeed = Math.floor((seed * 997 + ds.name.length * 7919) % 1000000000);
    const dsRng = mulberry32(dsSeed);

    const built = buildDataset(dsRng, {
      name: ds.name,
      days,
      rows,
      leakageProfile: ds.leakage,
      mappingVariant: ds.mapping,
    });

    // Special tweaks for E: Stripe noisy export
    if (ds.name === "E-stripe-noisy") {
      // Add a small set of noisy Stripe rows: missing customer, weird descriptions.
      for (let i = 0; i < 25; i++) {
        built.stripeRows.push({
          id: genChargeId(900000 + i),
          customer: i % 2 === 0 ? "" : `cus_${String(200000 + i)}`,
          amount: centsFromUsdString((49 + i).toFixed(2)),
          status: i % 3 === 0 ? "failed" : "succeeded",
          created: fmtUnixSec(genDateInWindow(dsRng, days)),
          fee: 0,
          disputed: i % 7 === 0 ? "TRUE" : "FALSE",
        });
        built.expected.notes.push("E-stripe-noisy: injected 25 malformed/missing-customer stripe rows");
      }
      built.expected.totals.stripeRows = built.stripeRows.length;
    }

    writeDataset(outDir, ds.name, built);

    const s = summarizeExpected(built.expected);
    console.log(
      `✅ ${ds.name} (${ds.leakage.name}, ${ds.mapping.name}) — txns=${built.expected.totals.usageRows}, stripe=${built.expected.totals.stripeRows}, anomalies=${s.total - built.expected.categories.matched.count}`
    );
  }

  // Write a manifest so the runner can discover datasets.
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      {
        runId,
        seed,
        days,
        rows,
        datasets: datasets.map((d) => d.name),
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(`\n📌 Next: analyze all datasets with:\n   node scripts/run-seriesb-batch.js --run ${runId}\n`);
}

main();

