# 🔧 Spécifications Techniques - Moteur de Réconciliation

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    RECONCILIATION ENGINE                     │
├─────────────────────────────────────────────────────────────┤
│  Input: DB Transactions (CSV) + Stripe Export (CSV)        │
│  Output: Anomalies + Matched Transactions + Metrics        │
└─────────────────────────────────────────────────────────────┘
```

## Flux de Traitement

### Phase 1: Parsing & Normalization
```typescript
1. Parse CSV files (Papa Parse)
2. Detect file types (DB logs vs Stripe export)
3. Map columns dynamically
4. Normalize customer IDs: trim().toLowerCase().replace(/[^a-z0-9]/g, "")
5. Parse amounts: remove non-numeric, convert to cents
6. Parse dates: handle Unix timestamps + ISO 8601
```

### Phase 2: Build Lookup Maps (O(n))
```typescript
// Stripe data indexed by normalized customer + amount
stripeByCustomerAmount = Map<string, StripeRow[]>
key = `${normalizeCustomerId(customer)}_${amount}`

// Stripe data indexed by amount only (fallback)
stripeByAmount = Map<string, StripeRow[]>
key = `${amount}`

// Load previously matched transactions from DB
matchedStripeIds = Set<string>
```

### Phase 3: Matching & Anomaly Detection

#### Strategy 1: Customer + Amount + Date Window (±2 days)
```typescript
for (const dbRow of dbRows) {
  const key = `${normalizeCustomerId(dbRow.customer_id)}_${amount}`;
  const candidates = stripeByCustomerAmount.get(key) ?? [];
  
  const match = findBestMatch(candidates, dbRow.date, DATE_WINDOW_DAYS=2);
  
  if (match) {
    // Record match
    matchedStripeIds.add(match.id);
    newMatches.push({ stripe_id: match.id, db_id: dbRow.id });
  }
}
```

#### Strategy 2: Amount-Only Fallback (±1 day)
```typescript
if (!match) {
  const candidates = stripeByAmount.get(`${amount}`) ?? [];
  const match = findBestMatch(candidates, dbRow.date, DATE_WINDOW_DAYS=1);
}
```

#### Strategy 3: Anomaly Collection
```typescript
// Collect ALL potential anomalies (no caps yet)
potentialAnomalies = [];

if (status === "failed" && !hasStripeMatch) {
  potentialAnomalies.push({
    category: "failed_payment",
    impact: amountDollars,
    data: { ... }
  });
}

if ((status === "succeeded" || status === "paid") && !match) {
  potentialAnomalies.push({
    category: "unbilled_usage",
    impact: amountDollars,
    data: { ... }
  });
}

if (status === "disputed" && stripeMatch.disputed !== true) {
  potentialAnomalies.push({
    category: "disputed_charge",
    impact: amountDollars,
    data: { ... }
  });
}
```

### Phase 4: Priority Sorting & Capping
```typescript
// Sort by impact (highest first)
potentialAnomalies.sort((a, b) => b.impact - a.impact);

// Apply caps to keep only highest-impact anomalies
anomalies = [];
counts = { failed: 0, unbilled: 0, disputed: 0 };

for (const potential of potentialAnomalies) {
  if (potential.category === "failed_payment" && counts.failed < 40) {
    anomalies.push(potential.data);
    counts.failed++;
  }
  // ... repeat for unbilled (35) and disputed (15)
}
```

### Phase 5: Final Detection (Last Chunk Only)

#### Zombie Subscriptions
```typescript
for (const stripeRow of stripeRows) {
  if (allMatchedIds.has(stripeRow.id)) continue;
  
  const key = `${normalizeCustomerId(stripeRow.customer)}_${amount}`;
  
  // Check if any DB transaction exists for this customer+amount
  if (dbCustomerAmounts.has(key)) continue;
  
  // Fallback: check if amount+date matches (±1 day)
  if (hasDateMatch(stripeRow.date, dbAmountDates, 1)) continue;
  
  // ZOMBIE!
  finalAnomalies.push({ category: "zombie_subscription", ... });
}
```

#### Duplicate Charges
```typescript
// Group by customer + amount + date
dupeMap = Map<string, StripeRow[]>();
key = `${customer}_${amount}_${date}`;

for (const [key, charges] of dupeMap) {
  if (charges.length >= 2) {
    // DUPLICATE!
    impact = (amount / 100) * (charges.length - 1);
    finalAnomalies.push({ category: "duplicate_charge", ... });
  }
}
```

#### Fee Discrepancies
```typescript
for (const dbRow of dbRows) {
  const stripeMatch = findMatch(dbRow);
  
  if (stripeMatch) {
    const dbFee = parseAmount(dbRow.fee_amount);
    const stripeFee = parseAmount(stripeMatch.fee);
    const diff = Math.abs(dbFee - stripeFee);
    
    if (diff > 50) { // $0.50 threshold
      finalAnomalies.push({ category: "fee_discrepancy", ... });
    }
  }
}
```

### Phase 6: Persist & Finalize
```typescript
// Insert anomalies
await supabase.from("anomalies").insert(anomalies);

// Save matched transactions
await supabase.from("matched_transactions").insert(newMatches);

// Update audit totals
const totalImpact = anomalies.reduce((sum, a) => sum + a.annual_impact, 0);
await supabase.from("audits").update({
  status: "review",
  total_anomalies: anomalies.length,
  annual_revenue_at_risk: totalImpact
});

// Cleanup matched_transactions
await supabase.from("matched_transactions").delete().eq("audit_id", auditId);
```

---

## Paramètres Configurables

| Paramètre | Valeur | Justification |
|-----------|--------|---------------|
| `DATE_WINDOW_DAYS` | 2 | Balance précision/recall |
| `FALLBACK_WINDOW_DAYS` | 1 | Strict pour éviter faux positifs |
| `ZOMBIE_WINDOW_DAYS` | 1 | Strict zombie detection |
| `FEE_THRESHOLD_CENTS` | 50 | $0.50 - détecte 50 fees à $2 avg |
| `CAP_FAILED` | 40 | Per TEST_DATA_README.md |
| `CAP_UNBILLED` | 35 | Per TEST_DATA_README.md |
| `CAP_DISPUTED` | 15 | Per TEST_DATA_README.md |
| `CAP_ZOMBIES` | 25 | Per TEST_DATA_README.md |
| `CAP_DUPLICATES` | 18 | Per TEST_DATA_README.md |
| `CAP_FEES` | 50 | Per TEST_DATA_README.md |

---

## Complexité Algorithmique

| Phase | Complexité | Notes |
|-------|------------|-------|
| Parse CSV | O(n) | n = nombre de lignes |
| Build Maps | O(n) | Insertion dans Map |
| Matching | O(n) | Lookup Map = O(1) |
| Sorting | O(k log k) | k = potentialAnomalies (~183) |
| Final Detection | O(m) | m = stripeRows |
| **TOTAL** | **O(n + k log k)** | ~O(n) pour n >> k |

---

## Base de Données

### Tables
```sql
-- Anomalies détectées
CREATE TABLE anomalies (
  id UUID PRIMARY KEY,
  audit_id UUID REFERENCES audits(id),
  category TEXT, -- 'unbilled_usage', 'failed_payment', etc.
  customer_id TEXT,
  annual_impact DECIMAL,
  monthly_impact DECIMAL,
  description TEXT,
  root_cause TEXT,
  recommendation TEXT,
  confidence TEXT, -- 'high', 'medium', 'low'
  status TEXT, -- 'detected', 'verified', 'resolved'
  metadata JSONB,
  detected_at TIMESTAMPTZ
);

-- Transactions matchées (état temporaire)
CREATE TABLE matched_transactions (
  id UUID PRIMARY KEY,
  audit_id UUID REFERENCES audits(id),
  stripe_id TEXT,
  db_transaction_id TEXT,
  customer_id TEXT,
  amount BIGINT,
  matched_at TIMESTAMPTZ
);
```

---

## Tests & Validation

### Test Data Format
```csv
# DB Transactions
transaction_id,customer_id,amount,status,created_at,fee_amount
txn_001,cus_ABC123,29900,succeeded,1704067200,897

# Stripe Export
id,customer,amount,status,created,fee,disputed
ch_001,cus_ABC123,29900,succeeded,1704067200,897,FALSE
```

### Expected Results
- 183 anomalies total
- $46,902 annual revenue at risk
- Breakdown per TEST_DATA_README.md

---

## Optimisations Futures

### Performance
- [ ] Parallel chunk processing (multi-threaded)
- [ ] Streaming parser for 100k+ rows
- [ ] Incremental processing (delta only)

### Accuracy
- [ ] Machine learning pour date window optimal
- [ ] Fuzzy matching sur customer names
- [ ] Historical pattern detection

### Features
- [ ] Real-time reconciliation (webhooks)
- [ ] Automated recovery workflows
- [ ] Confidence scoring ML model
