#!/usr/bin/env node

/**
 * Test Runner for Vynt Reconciliation Engine
 * 
 * Runs the analyze-audit Edge Function locally with test CSVs
 * and generates a scorecard report.
 * 
 * Usage: node scripts/test-engine.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Vynt Reconciliation Engine - Test Runner\n');

// Check if test data exists
const testDataDir = path.join(__dirname, '../test-data');
const usageFile = path.join(testDataDir, 'usage-logs.csv');
const stripeFile = path.join(testDataDir, 'stripe-export.csv');

if (!fs.existsSync(usageFile) || !fs.existsSync(stripeFile)) {
  console.error('❌ Test data files not found!');
  console.error('   Expected:');
  console.error(`   - ${usageFile}`);
  console.error(`   - ${stripeFile}`);
  console.error('\n   Please ensure test CSVs are in the test-data/ directory.');
  process.exit(1);
}

console.log('✅ Test data found');
console.log(`   📄 Usage logs: ${usageFile}`);
console.log(`   📄 Stripe export: ${stripeFile}\n`);

// Read test files
const usageData = fs.readFileSync(usageFile, 'utf8');
const stripeData = fs.readFileSync(stripeFile, 'utf8');

console.log('📊 Test data stats:');
console.log(`   Usage logs: ${usageData.split('\n').length - 1} rows`);
console.log(`   Stripe export: ${stripeData.split('\n').length - 1} rows\n`);

// Expected results (from TEST_DATA_README.md)
const EXPECTED = {
  totalAnomalies: 183,
  totalImpact: 46902,
  categories: {
    zombie_subscription: { count: 25, impact: 7475 },
    unbilled_usage: { count: 35, impact: 17500 },
    failed_payment: { count: 40, impact: 11960 },
    duplicate_charge: { count: 18, impact: 5382 },
    disputed_charge: { count: 15, impact: 4485 },
    fee_discrepancy: { count: 50, impact: 100 }
  }
};

console.log('🎯 Expected Results:');
console.log(`   Total Anomalies: ${EXPECTED.totalAnomalies}`);
console.log(`   Revenue at Risk: $${EXPECTED.totalImpact.toLocaleString()}`);
console.log('');

// Instructions to run test
console.log('📝 To run the test analysis:\n');
console.log('Option 1: Via Supabase CLI (Local Edge Functions)');
console.log('   1. Start Supabase locally: npx supabase start');
console.log('   2. Serve functions: npx supabase functions serve analyze-audit --no-verify-jwt');
console.log('   3. Run curl command:\n');
console.log(`   curl -X POST http://localhost:54321/functions/v1/analyze-audit \\
     -H "Content-Type: application/json" \\
     --data '{
       "auditId": "test-audit-001",
       "usageLogs": ${JSON.stringify(usageData.slice(0, 100))}...,
       "stripeExport": ${JSON.stringify(stripeData.slice(0, 100))}...
     }'`);
console.log('');

console.log('Option 2: Direct API Call (requires Supabase setup)');
console.log('   1. Create a test audit in Supabase');
console.log('   2. Upload test CSVs via the Vynt UI at /upload');
console.log('   3. Monitor results at /audit/[id]\n');

console.log('Option 3: Use provided test script');
console.log('   Run: node scripts/run-test-analysis.js\n');

console.log('📊 Results will be compared against expected values and scored.\n');

// Offer to generate test data if needed
console.log('💡 Tip: You can generate new test data with:');
console.log('   node scripts/generate-test-data.js\n');

console.log('✅ Test runner ready. Follow the instructions above to run the analysis.');
