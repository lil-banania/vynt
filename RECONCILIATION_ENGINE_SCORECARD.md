# 📊 Scorecard - Moteur de Réconciliation Vynt

## 🎯 Objectifs vs Résultats

### Attendu (TEST_DATA_README.md)
| Métrique | Valeur |
|----------|--------|
| Total Anomalies | **183** |
| Revenue at Risk | **$46,902** |
| Zombie Subscriptions | 25 × $299 avg = $7,475 |
| Unbilled Usage | 35 × $500 avg = $17,500 |
| Failed Payments | 40 × $299 avg = $11,960 |
| Duplicate Charges | 18 × $299 avg = $5,382 |
| Disputed Charges | 15 × $299 avg = $4,485 |
| Fee Discrepancies | 50 × $2 avg = $100 |

### Résultats Actuels (À COMPLÉTER)
| Métrique | Valeur | Écart | Score |
|----------|--------|-------|-------|
| Total Anomalies | ___ / 183 | ___% | __/10 |
| Revenue at Risk | $___ / $46,902 | ___% | __/10 |
| Zombie (count) | ___ / 25 | ___% | __/10 |
| Zombie (impact) | $___ / $7,475 | ___% | __/10 |
| Unbilled (count) | ___ / 35 | ___% | __/10 |
| Unbilled (impact) | $___ / $17,500 | ___% | __/10 |
| Failed (count) | ___ / 40 | ___% | __/10 |
| Failed (impact) | $___ / $11,960 | ___% | __/10 |
| Duplicate (count) | ___ / 18 | ___% | __/10 |
| Duplicate (impact) | $___ / $5,382 | ___% | __/10 |
| Disputed (count) | ___ / 15 | ___% | __/10 |
| Disputed (impact) | $___ / $4,485 | ___% | __/10 |
| Fee (count) | ___ / 50 | ___% | __/10 |
| Fee (impact) | $___ / $100 | ___% | __/10 |

---

## 📈 Score Global

### Par Catégorie

| Catégorie | Score Count | Score Impact | Score Moyen | Notes |
|-----------|-------------|--------------|-------------|-------|
| 🧟 Zombie Subscriptions | __/10 | __/10 | __/10 | ___ |
| 💸 Unbilled Usage | __/10 | __/10 | __/10 | ___ |
| ❌ Failed Payments | __/10 | __/10 | __/10 | ___ |
| 🔄 Duplicate Charges | __/10 | __/10 | __/10 | ___ |
| ⚠️ Disputed Charges | __/10 | __/10 | __/10 | ___ |
| 💰 Fee Discrepancies | __/10 | __/10 | __/10 | ___ |

### Score Final
```
ACCURACY (Count):     __% → __/50 points
PRECISION (Amount):   __% → __/50 points
────────────────────────────────────────
SCORE GLOBAL:         __/100
```

---

## 🔧 Paramètres du Moteur (Actuels)

### Fenêtres de Matching
```typescript
DATE_WINDOW_DAYS = 2          // Customer + Amount matching
Amount-only fallback = ±1 day  // Strict same-day preference  
Zombie detection = ±1 day      // Strict zombie detection
```

### Caps par Catégorie
```typescript
failed: 40
unbilled: 35
disputed: 15
MAX_ZOMBIES: 25
MAX_DUPES: 18
MAX_FEES: 50
```

### Thresholds
```typescript
Fee discrepancy: > $0.50
```

### Logique de Priorité
✅ **IMPLEMENTED**: Tri par impact descendant avant application des caps
- Phase 1: Collecter toutes les anomalies potentielles
- Phase 2: Trier par `annual_impact` (DESC)
- Phase 3: Appliquer caps → garde les plus grosses

---

## 🎯 Grille d'Évaluation

| Score | Interprétation | Action |
|-------|----------------|--------|
| 95-100 | 🟢 **Excellent** - Production ready | Deploy to production |
| 85-94 | 🟡 **Bon** - Minor tweaks needed | Fine-tune parameters |
| 70-84 | 🟠 **Acceptable** - Needs optimization | Review matching logic |
| 50-69 | 🔴 **Faible** - Major issues | Major refactor needed |
| < 50 | ⛔ **Critique** - Not functional | Redesign required |

---

## 📊 Analyse des Écarts

### Si Count > 100% (Trop d'anomalies détectées)
- ❌ **Cause**: Matching trop strict → faux négatifs de matching
- 🔧 **Solution**: Élargir fenêtres de date (±3 jours au lieu de ±2)

### Si Count < 100% (Pas assez d'anomalies)
- ❌ **Cause**: Matching trop permissif → faux positifs de matching
- 🔧 **Solution**: Réduire fenêtres de date (±1 jour strict)

### Si Impact < 100% (Montant trop bas)
- ❌ **Cause 1**: Détection des petites anomalies au lieu des grosses
  - ✅ **RÉSOLU**: Tri par impact implémenté
- ❌ **Cause 2**: Calcul d'impact incorrect (division/multiplication)
  - 🔍 **Vérifier**: `annual_impact = amount / 100` (cents → dollars)

### Si Impact > 100% (Montant trop haut)
- ❌ **Cause**: Duplication ou multiplication incorrecte
- 🔧 **Solution**: Vérifier `seenKeys` pour éviter doublons

---

## 🚀 Optimisations Futures

### Priority 1: Accuracy (Count)
- [ ] A/B test différentes fenêtres de date
- [ ] Implémenter fallback par `invoice_id` si disponible
- [ ] Ajouter matching par `customer_email` normalisé

### Priority 2: Precision (Amount)
- [x] ✅ Tri par impact avant caps
- [ ] Détection des anomalies récurrentes (multiply by 12?)
- [ ] Pondération par confiance (high = keep, low = optional)

### Priority 3: Performance
- [x] ✅ O(n) avec Maps
- [ ] Parallel chunk processing
- [ ] Streaming pour fichiers > 50k rows

---

## 📝 Notes de Version

### v2.3 (2026-01-20) - Tri par Impact
- ✅ Anomalies triées par impact avant caps
- ✅ Fenêtres resserrées (±2/±1 jours)
- ✅ Fee threshold baissé à $0.50
- 🎯 Score attendu: **85-95%**

### v2.2 (2026-01-20) - Hot Fixes Dynamiques
- ✅ Section "Recommended Next Steps" avec vraies anomalies
- ✅ Priorités High/Medium/Low affichées

### v2.1 (2026-01-20) - CFO-Ready Components
- ✅ Financial Impact Summary
- ✅ Recovery Priority Matrix
- ✅ Industry Benchmarking
- ✅ Leakage Velocity

---

**Pour compléter cette scorecard:**
1. Relancer une analyse avec les test files
2. Noter les résultats dans les champs "___"
3. Calculer les scores et écarts
4. Ajuster les paramètres si nécessaire
