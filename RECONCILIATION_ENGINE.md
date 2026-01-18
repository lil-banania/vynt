# Reconciliation Engine (API)

This document describes the reconciliation engine implemented in
`src/app/api/audits/analyze/route.ts`. It covers inputs, processing flow,
anomaly detection logic, and outputs.

## Entry Point

`POST /api/audits/analyze`

**Inputs**
- JSON body: `{ "auditId": "uuid", "config"?: { ... } }`
- Requires authenticated user.
- Uses Supabase Service Role key to read/write audit data.

**High-level flow**
1. Validate user session and `auditId`.
2. Load org reconciliation settings and merge with request overrides.
3. Fetch uploaded CSVs (usage logs + Stripe export) from storage.
4. Parse CSVs, validate headers/rows.
5. Detect file mode (DB logs vs usage logs).
6. Run anomaly detection and build `anomalies[]`.
7. Map categories to DB-allowed values.
8. Insert anomalies, update audit totals, optionally generate AI insights.
9. Return summary payload.

## Configuration

Settings are resolved from organization config + request overrides:

```
payoutGraceDays
unreconciledRiskPct
feeDiscrepancyThresholdCents
timingMismatchDays
payoutGroupMinTransactions
grossDiffThresholdCents
annualizationMonths
chargebackFeeAmount
currencyCode
```

All numeric settings are sanitized (min values enforced).

## CSV Parsing & Validation

- Parses with `Papa.parse` using `header: true`.
- Rejects parse errors, missing headers, or empty row sets.
- Rows are mapped using flexible column hints to support different export
  formats.

Key helpers:
```
findColumn(headers, hints)
mapRow(row, mapping)
parseAmount(value)
parseDate(value)
formatCurrency(cents, currencyCode)
```

## Mode Selection

The engine auto-detects the primary input:

- **DB Transaction Logs mode** if file 1 has columns like
  `transaction_id`, `net_amount`, `fee_amount`.
- **Usage Logs mode** otherwise (legacy behavior).

## Anomaly Detection (DB Logs vs Stripe)

### 1) Missing Stripe charges for DB records
- `failed_payment` for failed DB txns with no Stripe match.
- `pricing_mismatch` for succeeded DB txns with no Stripe match.

### 2) Duplicate Stripe charges
- Groups by `customer + amount + date`.
- Flags multiple identical charges on same day.

### 3) Disputed status mismatch
- DB shows disputed, Stripe shows succeeded.
- Adds chargeback fee to impact.

### 3B) Stripe charges missing from DB
- Succeeded Stripe charges with no DB match.

### 4) Unreconciled charges (missing payout_id)
- Past a grace period and still no payout.

### 5) Fee discrepancies
- DB fee vs Stripe fee for matched charges.

### 6) Timing mismatch
- DB created_at vs Stripe created date beyond threshold.

### 7) Refund structure differences
- DB refunds without Stripe refund objects.
- Stripe refund objects without updated `amount_refunded`.

### 8) Payout grouping analysis
- Large payout batches are flagged as informational.

### Summary check
- Gross totals between DB and Stripe.
- Flags overall discrepancies beyond threshold.

## Anomaly Detection (Usage Logs vs Stripe)

Per-customer analysis:
- `zombie_subscription`: charges without usage.
- `unbilled_usage`: usage without successful charges.
- `failed_payment`: failed charges.
- `high_refund_rate`: refunds exceed 10% of charges.
- `dispute_chargeback`: disputed charges.
- `duplicate_charge`: duplicate same-day charges.

## Category Mapping (DB Constraint)

Database allows only:
```
zombie_subscription
unbilled_usage
pricing_mismatch
duplicate_charge
```

All detected categories are mapped to one of these four before insert. Unknown
categories default to `pricing_mismatch`.

## Database Writes

1. Insert sanitized anomalies into `anomalies` table.
2. Update audit record with:
   - `status: "review"`
   - `total_anomalies`
   - `annual_revenue_at_risk`
   - `audit_period_start/end` (derived from timestamps)

## AI Insights (Optional)

If `OPENAI_API_KEY` is present and anomalies exist:
- Sends a summarized list of anomalies to OpenAI.
- Stores a short executive summary in the response as `aiInsights`.

## Response Payload

```
{
  "success": true,
  "anomaliesDetected": number,
  "annualRevenueAtRisk": number,
  "aiInsights": string | null,
  "mode": "full_reconciliation" | "usage_vs_stripe"
}
```
