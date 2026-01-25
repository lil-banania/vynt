#!/usr/bin/env node

/**
 * Run Test Analysis - Vynt Reconciliation Engine
 * 
 * This script simulates the analyze-audit Edge Function locally
 * by importing and running the core analysis logic directly.
 */

const fs = require('fs');
const path = require('path');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

const quiet = process.argv.includes('--quiet');

// Import Papa Parse for CSV parsing
const Papa = require('papaparse');

if (!quiet) {
  console.log('🔍 Vynt Reconciliation Engine - Running Test Analysis\n');
}

// Load data (defaults remain backward compatible)
const defaultTestDataDir = path.join(__dirname, '../test-data');
const usageFile =
  argValue('--usage') ??
  process.env.VYNT_USAGE_CSV ??
  path.join(defaultTestDataDir, 'usage-logs.csv');
const stripeFile =
  argValue('--stripe') ??
  process.env.VYNT_STRIPE_CSV ??
  path.join(defaultTestDataDir, 'stripe-export.csv');
const expectedFile = argValue('--expected') ?? process.env.VYNT_EXPECTED_JSON ?? null;

if (!fs.existsSync(usageFile) || !fs.existsSync(stripeFile)) {
  console.error('❌ Test data files not found!');
  console.error(`   Usage:  ${usageFile}`);
  console.error(`   Stripe: ${stripeFile}`);
  process.exit(1);
}

const usageData = fs.readFileSync(usageFile, 'utf8');
const stripeData = fs.readFileSync(stripeFile, 'utf8');
const expected =
  expectedFile && fs.existsSync(expectedFile)
    ? JSON.parse(fs.readFileSync(expectedFile, 'utf8'))
    : null;

if (!quiet) console.log('📊 Parsing CSV files...');

// Parse CSVs
const usageParsed = Papa.parse(usageData, { header: true, skipEmptyLines: true });
const stripeParsed = Papa.parse(stripeData, { header: true, skipEmptyLines: true });

const usageRows = usageParsed.data;
const stripeRows = stripeParsed.data;

if (!quiet) {
  console.log(`   ✅ Usage logs: ${usageRows.length} rows`);
  console.log(`   ✅ Stripe export: ${stripeRows.length} rows\n`);
}

// Helper functions (from Edge Function logic)
function normalizeCustomerId(id) {
  if (!id) return '';
  return String(id).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Parse amounts into **cents** with heuristics matching the Edge Function.
function parseAmount(amountStr) {
  if (!amountStr) return 0;
  const raw = String(amountStr).trim();
  if (!raw) return 0;

  const hasDecimal = raw.includes(".");
  const hasCurrencyOrComma = /[$,]/.test(raw);
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (!cleaned) return 0;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return 0;

  if (hasDecimal || hasCurrencyOrComma) return Math.round(num * 100);
  const abs = Math.abs(num);
  if (abs < 1000) return Math.round(num * 100);
  return Math.round(num);
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  
  // Unix timestamp
  if (/^\d{10,13}$/.test(String(dateStr))) {
    const ts = parseInt(dateStr);
    return new Date(ts > 9999999999 ? ts : ts * 1000);
  }
  
  // ISO date
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function dateDiffDays(date1, date2) {
  if (!date1 || !date2) return Infinity;
  return Math.abs(date1.getTime() - date2.getTime()) / (1000 * 60 * 60 * 24);
}

function findColumn(headers, candidates) {
  const lowerHeaders = headers.map(h => h.toLowerCase());
  for (const candidate of candidates) {
    const idx = lowerHeaders.findIndex(h => h.includes(candidate.toLowerCase()));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

if (!quiet) console.log('🔍 Detecting file structure...');

// Detect columns
const usageHeaders = Object.keys(usageRows[0] || {});
const stripeHeaders = Object.keys(stripeRows[0] || {});

const usageIdCol = findColumn(usageHeaders, ['transaction_id', 'txn_id', 'id']);
const usageCustomerCol = findColumn(usageHeaders, ['customer_id', 'customer', 'user_id']);
const usageAmountCol = findColumn(usageHeaders, ['amount', 'net_amount', 'total']);
const usageStatusCol = findColumn(usageHeaders, ['status', 'state']);
const usageDateCol = findColumn(usageHeaders, ['created_at', 'date', 'timestamp']);
const usageFeeCol = findColumn(usageHeaders, ['fee_amount', 'fee', 'processing_fee']);

const stripeIdCol = findColumn(stripeHeaders, ['id', 'charge_id']);
const stripeCustomerCol = findColumn(stripeHeaders, ['customer', 'customer_id']);
const stripeAmountCol = findColumn(stripeHeaders, ['amount', 'total']);
const stripeStatusCol = findColumn(stripeHeaders, ['status', 'state']);
const stripeDateCol = findColumn(stripeHeaders, ['created', 'date', 'timestamp']);
const stripeFeeCol = findColumn(stripeHeaders, ['fee', 'fee_amount']);
const stripeDisputedCol = findColumn(stripeHeaders, ['disputed']);

if (!quiet) {
  console.log(`   ✅ Columns mapped\n`);
  console.log('   Usage mapping:', {
    id: usageIdCol,
    customer: usageCustomerCol,
    amount: usageAmountCol,
    status: usageStatusCol,
    date: usageDateCol,
    fee: usageFeeCol,
  });
  console.log('   Stripe mapping:', {
    id: stripeIdCol,
    customer: stripeCustomerCol,
    amount: stripeAmountCol,
    status: stripeStatusCol,
    date: stripeDateCol,
    fee: stripeFeeCol,
    disputed: stripeDisputedCol,
  });
  console.log('');
}

// Build Stripe lookup maps
if (!quiet) console.log('🗺️  Building lookup maps...');

const stripeByCustomerAmount = new Map();
const stripeByAmount = new Map();
const allMatchedIds = new Set();

for (const row of stripeRows) {
  const customerId = row[stripeCustomerCol];
  const amount = parseAmount(row[stripeAmountCol]);
  
  const key1 = `${normalizeCustomerId(customerId)}_${amount}`;
  if (!stripeByCustomerAmount.has(key1)) {
    stripeByCustomerAmount.set(key1, []);
  }
  stripeByCustomerAmount.get(key1).push(row);
  
  const key2 = `${amount}`;
  if (!stripeByAmount.has(key2)) {
    stripeByAmount.set(key2, []);
  }
  stripeByAmount.get(key2).push(row);
}

if (!quiet) {
  console.log(`   ✅ ${stripeByCustomerAmount.size} unique customer+amount keys`);
  console.log(`   ✅ ${stripeByAmount.size} unique amount keys\n`);
}

// Matching & Detection
if (!quiet) console.log('🔍 Running matching & anomaly detection...\n');

const anomalies = [];
// Matching windows
// - Primary (customer+amount): allow up to 3 days to accommodate export timing skew
// - Fallback (amount-only): keep tight to limit false matches
const DATE_WINDOW = 3; // days
const FALLBACK_WINDOW = 1; // days

// Track anomalies by category
const categoryCounts = {
  failed_payment: 0,
  unbilled_usage: 0,
  disputed_charge: 0,
  zombie_subscription: 0,
  duplicate_charge: 0,
  fee_discrepancy: 0
};

const categoryImpacts = {
  failed_payment: 0,
  unbilled_usage: 0,
  disputed_charge: 0,
  zombie_subscription: 0,
  duplicate_charge: 0,
  fee_discrepancy: 0
};

// Keep a match count for scorecard
let matchedUsage = 0;

// Process usage logs
for (const row of usageRows) {
  const customerId = row[usageCustomerCol];
  const amount = parseAmount(row[usageAmountCol]);
  const status = row[usageStatusCol]?.toLowerCase();
  const date = parseDate(row[usageDateCol]);
  const feeAmount = parseAmount(row[usageFeeCol]);
  
  // Try to match with Stripe
  const key = `${normalizeCustomerId(customerId)}_${amount}`;
  const candidates = stripeByCustomerAmount.get(key) || [];
  
  let bestMatch = null;
  let bestDiff = Infinity;
  
  for (const candidate of candidates) {
    const candidateDate = parseDate(candidate[stripeDateCol]);
    const diff = dateDiffDays(date, candidateDate);
    if (diff <= DATE_WINDOW && diff < bestDiff) {
      bestMatch = candidate;
      bestDiff = diff;
    }
  }
  
  // Fallback: amount-only (DISABLED for failed payments to improve accuracy)
  // Failed payments should NOT match via fallback - they're real failures
  if (!bestMatch && status !== 'failed') {
    const fallbackCandidates = stripeByAmount.get(`${amount}`) || [];
    for (const candidate of fallbackCandidates) {
      const candidateDate = parseDate(candidate[stripeDateCol]);
      const diff = dateDiffDays(date, candidateDate);
      if (diff <= FALLBACK_WINDOW && diff < bestDiff) {
        bestMatch = candidate;
        bestDiff = diff;
      }
    }
  }
  
  if (bestMatch) {
    allMatchedIds.add(bestMatch[stripeIdCol]);
    matchedUsage += 1;
    
    // === DISPUTED DETECTION ===
    // Check if DB says "disputed" but Stripe says NOT disputed
    const stripeDisputed = bestMatch[stripeDisputedCol]?.toUpperCase();
    if (status === 'disputed' && stripeDisputed !== 'TRUE') {
      categoryCounts.disputed_charge++;
      categoryImpacts.disputed_charge += amount / 100;
    }
    
    // Check for fee discrepancies
    const stripeFee = parseAmount(bestMatch[stripeFeeCol]);
    const feeDiff = Math.abs(feeAmount - stripeFee);
    if (feeDiff > 50) {
      categoryCounts.fee_discrepancy++;
      categoryImpacts.fee_discrepancy += feeDiff / 100;
    }
  } else {
    // Anomaly detected (no Stripe match)
    const impactDollars = amount / 100;
    
    if (status === 'failed') {
      categoryCounts.failed_payment++;
      categoryImpacts.failed_payment += impactDollars;
    } else if (status === 'succeeded' || status === 'paid') {
      categoryCounts.unbilled_usage++;
      categoryImpacts.unbilled_usage += impactDollars;
    }
  }
}

// Zombie subscriptions
const dbCustomerAmounts = new Set();
for (const row of usageRows) {
  const key = `${normalizeCustomerId(row[usageCustomerCol])}_${parseAmount(row[usageAmountCol])}`;
  dbCustomerAmounts.add(key);
}

for (const row of stripeRows) {
  if (allMatchedIds.has(row[stripeIdCol])) continue;
  
  const customerId = row[stripeCustomerCol];
  const amount = parseAmount(row[stripeAmountCol]);
  const key = `${normalizeCustomerId(customerId)}_${amount}`;
  
  if (!dbCustomerAmounts.has(key)) {
    categoryCounts.zombie_subscription++;
    categoryImpacts.zombie_subscription += amount / 100;
  }
}

// Duplicate charges
const dupeMap = new Map();
for (const row of stripeRows) {
  const customerId = normalizeCustomerId(row[stripeCustomerCol]);
  const amount = parseAmount(row[stripeAmountCol]);
  const date = parseDate(row[stripeDateCol]);
  const dateStr = date ? date.toISOString().split('T')[0] : 'unknown';
  const key = `${customerId}_${amount}_${dateStr}`;
  
  if (!dupeMap.has(key)) {
    dupeMap.set(key, []);
  }
  dupeMap.get(key).push(row);
}

for (const [key, charges] of dupeMap) {
  if (charges.length >= 2) {
    categoryCounts.duplicate_charge++;
    const amount = parseAmount(charges[0][stripeAmountCol]);
    categoryImpacts.duplicate_charge += (amount / 100) * (charges.length - 1);
  }
}

// Calculate totals
const totalCount = Object.values(categoryCounts).reduce((sum, c) => sum + c, 0);
const totalImpact = Math.round(Object.values(categoryImpacts).reduce((sum, i) => sum + i, 0));

function round1(n) {
  return Math.round(n * 10) / 10;
}

function dollars(n) {
  return `$${Math.round(n).toLocaleString()}`;
}

function buildScorecard() {
  const matchRate = usageRows.length > 0 ? (matchedUsage / usageRows.length) * 100 : 0;

  const result = {
    files: { usageFile, stripeFile, expectedFile },
    rows: { usage: usageRows.length, stripe: stripeRows.length },
    mapping: {
      usage: { id: usageIdCol, customer: usageCustomerCol, amount: usageAmountCol, status: usageStatusCol, date: usageDateCol, fee: usageFeeCol },
      stripe: { id: stripeIdCol, customer: stripeCustomerCol, amount: stripeAmountCol, status: stripeStatusCol, date: stripeDateCol, fee: stripeFeeCol, disputed: stripeDisputedCol },
    },
    matchRatePct: matchRate,
    categories: {
      failed_payment: { count: categoryCounts.failed_payment, impact: categoryImpacts.failed_payment },
      unbilled_usage: { count: categoryCounts.unbilled_usage, impact: categoryImpacts.unbilled_usage },
      disputed_charge: { count: categoryCounts.disputed_charge, impact: categoryImpacts.disputed_charge },
      zombie_subscription: { count: categoryCounts.zombie_subscription, impact: categoryImpacts.zombie_subscription },
      duplicate_charge: { count: categoryCounts.duplicate_charge, impact: categoryImpacts.duplicate_charge },
      fee_discrepancy: { count: categoryCounts.fee_discrepancy, impact: categoryImpacts.fee_discrepancy },
    },
    totals: { anomalies: totalCount, revenueAtRisk: totalImpact },
  };

  if (!expected) return { ...result, expected: null, score: null };

  const expCats = expected.categories || {};
  const keys = Object.keys(result.categories);
  const scoreParts = [];

  for (const k of keys) {
    const expCount = expCats[k]?.count ?? 0;
    const expImpact = (expCats[k]?.annualImpactCents ?? 0) / 100;
    const gotCount = result.categories[k].count;
    const gotImpact = result.categories[k].impact;

    // Count accuracy and impact accuracy (cap 150% to avoid rewarding over-detection)
    const countAcc = expCount > 0 ? Math.min((gotCount / expCount) * 100, 150) : gotCount === 0 ? 100 : 0;
    const impactAcc = expImpact > 0 ? Math.min((gotImpact / expImpact) * 100, 150) : gotImpact === 0 ? 100 : 0;

    // Weight: count 60%, impact 40% (count is more important for categorization correctness)
    const partScore = 0.6 * countAcc + 0.4 * impactAcc;
    scoreParts.push(partScore);
  }

  // Automapping coverage: ensure required columns are detected
  const requiredUsage = [usageCustomerCol, usageAmountCol, usageStatusCol, usageDateCol].filter(Boolean).length;
  const requiredStripe = [stripeCustomerCol, stripeAmountCol, stripeStatusCol, stripeDateCol].filter(Boolean).length;
  const mappingCoverage = ((requiredUsage / 4) * 50 + (requiredStripe / 4) * 50); // out of 100

  // Final score: 70% category accuracy + 20% mapping + 10% match rate sanity
  const categoryScore = scoreParts.length ? scoreParts.reduce((a, b) => a + b, 0) / scoreParts.length : 0;
  const finalScore = 0.7 * categoryScore + 0.2 * mappingCoverage + 0.1 * Math.min(matchRate, 100);

  return {
    ...result,
    expected: {
      meta: expected.meta ?? null,
      categories: expected.categories ?? null,
      totals: expected.totals ?? null,
    },
    score: {
      categoryScore: round1(categoryScore),
      mappingCoverage: round1(mappingCoverage),
      matchRate: round1(matchRate),
      final: round1(finalScore),
    },
  };
}

const scorecard = buildScorecard();

if (!quiet) {
  console.log('📊 RESULTS\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Usage rows: ${scorecard.rows.usage}`);
  console.log(`Stripe rows: ${scorecard.rows.stripe}`);
  console.log(`Match rate: ${round1(scorecard.matchRatePct)}%`);
  console.log(`Total Anomalies: ${totalCount}`);
  console.log(`Revenue at Risk: ${dollars(totalImpact)}`);
  if (scorecard.score) {
    console.log(`Score: ${scorecard.score.final}/100 (category=${scorecard.score.categoryScore}, mapping=${scorecard.score.mappingCoverage})`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// Emit JSON to stdout for the batch runner
process.stdout.write(JSON.stringify(scorecard, null, 2) + "\n");
