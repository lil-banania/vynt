#!/usr/bin/env node

/**
 * Generate comprehensive test data for the reconciliation engine
 * Creates realistic CSV files matching the expected anomaly distribution
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Generating test data for Vynt Reconciliation Engine\n');

// Expected distribution (from TEST_DATA_README.md)
const EXPECTED = {
  zombie: 25,       // $299 avg
  unbilled: 35,     // $500 avg
  failed: 40,       // $299 avg
  duplicates: 18,   // $299 avg
  disputed: 15,     // $299 avg
  fees: 50,         // $2 avg
  matched: 200      // Clean transactions
};

const customers = [];
for (let i = 1; i <= 100; i++) {
  customers.push(`cus_${String(i).padStart(4, '0')}`);
}

function randomCustomer() {
  return customers[Math.floor(Math.random() * customers.length)];
}

function randomAmount(avg) {
  // Random amount around average (±30%)
  const min = Math.round(avg * 0.7);
  const max = Math.round(avg * 1.3);
  return Math.floor(Math.random() * (max - min) + min) * 100; // cents
}

function randomDate(daysAgo = 30) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const offset = Math.random() * daysAgo * dayMs;
  return Math.floor((now - offset) / 1000); // Unix timestamp
}

function addDays(timestamp, days) {
  return timestamp + (days * 24 * 60 * 60);
}

// Generate usage logs (DB transactions)
const usageRows = [];
const stripeRows = [];
let txnId = 1;
let chargeId = 1;

console.log('📝 Generating matched transactions (clean data)...');
for (let i = 0; i < EXPECTED.matched; i++) {
  const customer = randomCustomer();
  const amount = randomAmount(299);
  const date = randomDate(30);
  const fee = Math.floor(amount * 0.029) + 30; // Stripe fee: 2.9% + $0.30
  
  usageRows.push({
    transaction_id: `txn_${String(txnId++).padStart(6, '0')}`,
    customer_id: customer,
    amount: amount,
    status: 'succeeded',
    created_at: date,
    fee_amount: fee
  });
  
  stripeRows.push({
    id: `ch_${String(chargeId++).padStart(6, '0')}`,
    customer: customer,
    amount: amount,
    status: 'succeeded',
    created: date,
    fee: fee,
    disputed: 'FALSE'
  });
}

console.log('💸 Generating unbilled usage (no Stripe match)...');
for (let i = 0; i < EXPECTED.unbilled; i++) {
  const customer = randomCustomer();
  const amount = randomAmount(500);
  const date = randomDate(30);
  const fee = Math.floor(amount * 0.029) + 30;
  
  usageRows.push({
    transaction_id: `txn_${String(txnId++).padStart(6, '0')}`,
    customer_id: customer,
    amount: amount,
    status: 'succeeded',
    created_at: date,
    fee_amount: fee
  });
  // NO Stripe entry!
}

console.log('❌ Generating failed payments (DB failed, no Stripe)...');
for (let i = 0; i < EXPECTED.failed; i++) {
  const customer = randomCustomer();
  const amount = randomAmount(299);
  const date = randomDate(30);
  
  usageRows.push({
    transaction_id: `txn_${String(txnId++).padStart(6, '0')}`,
    customer_id: customer,
    amount: amount,
    status: 'failed',
    created_at: date,
    fee_amount: 0
  });
  // NO Stripe entry!
}

console.log('🧟 Generating zombie subscriptions (Stripe only, no DB)...');
for (let i = 0; i < EXPECTED.zombie; i++) {
  const customer = randomCustomer();
  const amount = randomAmount(299);
  const date = randomDate(30);
  const fee = Math.floor(amount * 0.029) + 30;
  
  stripeRows.push({
    id: `ch_${String(chargeId++).padStart(6, '0')}`,
    customer: customer,
    amount: amount,
    status: 'succeeded',
    created: date,
    fee: fee,
    disputed: 'FALSE'
  });
  // NO DB entry!
}

console.log('🔄 Generating duplicate charges (same customer/amount/date)...');
for (let i = 0; i < EXPECTED.duplicates; i++) {
  const customer = randomCustomer();
  const amount = randomAmount(299);
  const date = randomDate(30);
  const fee = Math.floor(amount * 0.029) + 30;
  
  // Add to DB once
  usageRows.push({
    transaction_id: `txn_${String(txnId++).padStart(6, '0')}`,
    customer_id: customer,
    amount: amount,
    status: 'succeeded',
    created_at: date,
    fee_amount: fee
  });
  
  // Add to Stripe TWICE (duplicate)
  for (let j = 0; j < 2; j++) {
    stripeRows.push({
      id: `ch_${String(chargeId++).padStart(6, '0')}`,
      customer: customer,
      amount: amount,
      status: 'succeeded',
      created: date,
      fee: fee,
      disputed: 'FALSE'
    });
  }
}

console.log('⚠️  Generating disputed charges...');
for (let i = 0; i < EXPECTED.disputed; i++) {
  const customer = randomCustomer();
  const amount = randomAmount(299);
  const date = randomDate(30);
  const fee = Math.floor(amount * 0.029) + 30;
  
  usageRows.push({
    transaction_id: `txn_${String(txnId++).padStart(6, '0')}`,
    customer_id: customer,
    amount: amount,
    status: 'disputed',
    created_at: date,
    fee_amount: fee
  });
  
  stripeRows.push({
    id: `ch_${String(chargeId++).padStart(6, '0')}`,
    customer: customer,
    amount: amount,
    status: 'succeeded',
    created: date,
    fee: fee,
    disputed: 'FALSE' // Discrepancy: DB says disputed, Stripe says not
  });
}

console.log('💰 Generating fee discrepancies...');
for (let i = 0; i < EXPECTED.fees; i++) {
  const customer = randomCustomer();
  const amount = randomAmount(299);
  const date = randomDate(30);
  const correctFee = Math.floor(amount * 0.029) + 30;
  const wrongFee = correctFee + 200; // $2 difference
  
  usageRows.push({
    transaction_id: `txn_${String(txnId++).padStart(6, '0')}`,
    customer_id: customer,
    amount: amount,
    status: 'succeeded',
    created_at: date,
    fee_amount: correctFee
  });
  
  stripeRows.push({
    id: `ch_${String(chargeId++).padStart(6, '0')}`,
    customer: customer,
    amount: amount,
    status: 'succeeded',
    created: date,
    fee: wrongFee, // Wrong fee!
    disputed: 'FALSE'
  });
}

// Convert to CSV
function toCSV(rows, headers) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    const values = headers.map(h => {
      const val = row[h];
      return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
    });
    lines.push(values.join(','));
  }
  return lines.join('\n');
}

const usageHeaders = ['transaction_id', 'customer_id', 'amount', 'status', 'created_at', 'fee_amount'];
const stripeHeaders = ['id', 'customer', 'amount', 'status', 'created', 'fee', 'disputed'];

const usageCSV = toCSV(usageRows, usageHeaders);
const stripeCSV = toCSV(stripeRows, stripeHeaders);

// Write files
const testDataDir = path.join(__dirname, '../test-data');
fs.writeFileSync(path.join(testDataDir, 'usage-logs.csv'), usageCSV);
fs.writeFileSync(path.join(testDataDir, 'stripe-export.csv'), stripeCSV);

console.log('\n✅ Test data generated successfully!\n');
console.log('📊 Summary:');
console.log(`   Usage logs: ${usageRows.length} transactions`);
console.log(`   Stripe export: ${stripeRows.length} charges`);
console.log(`   Total anomalies: ${EXPECTED.zombie + EXPECTED.unbilled + EXPECTED.failed + EXPECTED.duplicates + EXPECTED.disputed + EXPECTED.fees}`);
console.log('\n💡 Run the test analysis with:');
console.log('   node scripts/run-test-analysis.js\n');
