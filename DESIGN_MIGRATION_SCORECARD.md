# Vynt Design Migration — Scorecard

Date: 2026-01-25

## Summary (current)
- **Overall score**: **92/100**
- **Build status**: **✅ `npm run build` passes**
- **Design source**: Figma file `FSaPYlBQZsYcaT1Bla4M8D`

## What was verified against Figma (high confidence)

### Colors / Category system (**25/25**)
- **Per-category chart colors** now match Figma “Breakdown by Category” legend:
  - **Failed**: `#EA580C`
  - **Duplicate**: `#0D9488`
  - **Zombie**: `#164E63`
  - **Unbilled**: `#FBBF24`
  - **Disputed**: `#F59E0B`
  - **Fee**: `#5B21B6`
- These are centralized in `src/lib/utils/category-config.ts` and propagated to:
  - Audit detail Overview bar chart (`BarChartWrapper`)
  - “All anomalies” category pills
  - “Needs action” category pills
  - Side panel category pill
  - Admin preview category breakdown + top issues
  - Legacy dashboard charts (`ImpactChart`, `CategoryBreakdown`, `AuditSummary`)

### Audit detail — Overview widgets (**18/20**)
- **Leakage Velocity** value color/typography matches Figma token:
  - **Destructive**: `#991B1B`
  - Size **36px**, weight **400**.
- **Remaining delta**: KPI sizing/spacing still needs a final pixel-check vs the exact Figma frame on real data (minor).

### Audit detail — All anomalies table (**22/25**)
- **Column layout** aligned to Figma proportions (anomaly type / customer id / confidence / status / annual impact / view details).
- **Confidence pill** uses exact Figma tokens:
  - High: bg `#DCFCE7`, border `#BBF7D0`, text `#15803D`
  - Low: bg `#FFFFFF`, border `#E7E5E4`, text `#0A0A0A`
- **Status** is plain text (no fill), matching Figma.
- **Remaining delta**: Medium confidence pill color is mapped to the warning token (not seen in sampled Figma rows); verify with a row that has “Medium”.

### Tabs (visual) (**10/10**)
- Tabs were rolled back to the last-good underlined design (no broken focus/ring overrides).

### Needs action / Common patterns (**12/15**)
- Two-column layout exists and is functional.
- Category pills now use centralized colors.
- **Remaining delta**: Pattern copy/metrics still depend on mock/placeholder data in some cases.

## Outstanding items / suggested next checks (highest leverage)
1. **Confidence “Medium”**: confirm the exact pill colors on a Figma row that uses “Medium”.
2. **KPI spacing**: verify exact card widths + gaps on the real rendered page (desktop).
3. **Side panel details**: confirm spacing/typography on long metadata (scroll/no-scroll requirement).

## Files of interest
- `src/lib/utils/category-config.ts` (single source of truth for colors)
- `src/app/(dashboard)/audit/[id]/page.tsx` (Overview + tables + charts)
- `src/components/audit/AnomalyTable.tsx` (All anomalies table)
- `src/components/audit/NeedsActionLayout.tsx`
- `src/components/audit/AnomalySidePanel.tsx`

