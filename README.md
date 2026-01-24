# 🔍 Vynt - Revenue Reconciliation Platform

> **Plateforme de réconciliation de revenus pour les entreprises B2B SaaS avec pricing usage-based ou hybride.**

Vynt automatise la détection d'anomalies de facturation en croisant vos données Stripe avec vos logs d'usage, vous permettant de récupérer les revenus perdus et d'optimiser votre billing.

---

## 🎯 Fonctionnalités

- ✅ **Upload de données** : Importez vos CSVs (Stripe Export + Usage Logs)
- ✅ **Analyse automatisée** : Détection d'anomalies par Machine Learning
- ✅ **Dashboard interactif** : Visualisez vos audits en temps réel
- ✅ **Rapports détaillés** : Analyses financières, root cause, recommandations
- ✅ **Catégorisation** : Anomalies par type (over-billing, under-billing, missing charges...)
- ✅ **Benchmarking** : Comparez-vous aux standards de l'industrie
- ✅ **Export PDF** : Générez des rapports professionnels

---

## 🛠 Stack Technique

| Catégorie | Technologies |
|-----------|-------------|
| **Framework** | Next.js 14 (App Router), React 18 |
| **Language** | TypeScript (strict mode) |
| **Styling** | Tailwind CSS 4, shadcn/ui |
| **Backend** | Supabase (PostgreSQL + Auth + Edge Functions) |
| **Charts** | Chart.js + react-chartjs-2 |
| **Forms** | React Hook Form + Zod |
| **Déploiement** | Vercel (Frontend) + Supabase (Backend) |

---

## 🚀 Installation Rapide

### Prérequis

- Node.js 18+ et npm
- Un projet Supabase (gratuit sur [supabase.com](https://supabase.com))

### 1. Cloner le repository

```bash
git clone https://github.com/votre-org/vynt.git
cd vynt
```

### 2. Installer les dépendances

```bash
npm install
```

### 3. Configurer les variables d'environnement

Créez un fichier `.env.local` à la racine :

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...  # Pour l'admin

# Next.js
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Appliquer les migrations Supabase

```bash
# Installer le CLI Supabase
npm install -g supabase

# Se connecter
npx supabase login

# Lier le projet
npx supabase link --project-ref <votre-project-id>

# Appliquer les migrations
npx supabase db push
```

### 5. Déployer les Edge Functions

```bash
npx supabase functions deploy analyze-audit --no-verify-jwt
npx supabase functions deploy process-chunk --no-verify-jwt
```

### 6. Lancer le serveur de développement

```bash
npm run dev
```

Ouvrez [http://localhost:3000](http://localhost:3000) dans votre navigateur.

---

## 📁 Structure du Projet

```
vynt/
├── src/
│   ├── app/
│   │   ├── (auth)/          # Pages d'authentification (login, signup)
│   │   ├── (dashboard)/     # Pages protégées (dashboard, upload, audit)
│   │   ├── (admin)/         # Panel admin
│   │   ├── api/             # API Routes Next.js
│   │   └── globals.css      # Styles globaux (Tailwind)
│   ├── components/
│   │   ├── ui/              # Composants shadcn/ui (Button, Card, Table...)
│   │   ├── layout/          # Layout components (Sidebar, Header...)
│   │   ├── dashboard/       # Dashboard-specific components
│   │   ├── audit/           # Audit detail components
│   │   ├── upload/          # Upload flow components
│   │   └── charts/          # Chart.js wrappers
│   ├── lib/
│   │   ├── supabase/        # Supabase clients (server, client, admin)
│   │   ├── audit/           # Business logic (calculations, benchmarking...)
│   │   ├── utils/           # Helpers (CSV parser, formatters...)
│   │   └── types/           # TypeScript types
│   └── middleware.ts        # Next.js middleware (auth)
├── supabase/
│   ├── functions/           # Edge Functions (analyze-audit, process-chunk)
│   └── migrations/          # Database migrations
├── test-data/               # Sample CSVs pour tests
├── public/                  # Assets statiques
└── package.json
```

---

## 🎨 Design System

### Couleurs

- **Primaire** : Slate (neutral)
- **Accent** : Orange (`#FF6B35`)
- **Success** : Green
- **Error** : Red
- **Warning** : Yellow

### Typographie

- **Police UI** : Inter (sans-serif)
- **Logo** : Playfair Display (serif)

### Composants

Tous les composants UI sont basés sur **shadcn/ui** :

```tsx
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
```

---

## 🧪 Tests & Quality

### Linter

```bash
npm run lint
```

### Build de production

```bash
npm run build
```

### Tests (à venir)

```bash
npm test
```

---

## 📦 Déploiement en Production

Consultez le guide complet : **[DEPLOYMENT.md](./DEPLOYMENT.md)**

Résumé :
1. Déployez le frontend sur **Vercel** (auto-détection Next.js)
2. Configurez les variables d'environnement Supabase sur Vercel
3. Déployez les Edge Functions Supabase
4. Testez le flow complet

---

## 📊 Flow Utilisateur

1. **Signup/Login** : Créez un compte via email ou Google
2. **Upload** : Importez 2 CSVs (Stripe Export + Usage Logs)
3. **Processing** : L'audit s'exécute en arrière-plan (30-90 secondes)
4. **Dashboard** : Visualisez vos audits dans la liste
5. **Audit Detail** : Consultez les anomalies détectées par catégorie
6. **Actions** : Exportez le rapport, marquez les anomalies comme résolues

---

## 🤝 Contribution

Les contributions sont les bienvenues ! Pour contribuer :

1. Forkez le projet
2. Créez une branche feature (`git checkout -b feature/AmazingFeature`)
3. Commitez vos changements (`git commit -m 'Add some AmazingFeature'`)
4. Pushez vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrez une Pull Request

### Conventions de code

- **TypeScript strict** : Tous les types doivent être explicites
- **Naming** : camelCase pour variables, PascalCase pour composants
- **Formatting** : Utilisez Prettier (configuré dans le projet)
- **Linting** : Aucune erreur ESLint avant commit

---

## 📄 Licence

MIT License - voir le fichier [LICENSE](./LICENSE) pour plus de détails.

---

## 🆘 Support

- 📧 Email : support@vynt.io
- 💬 Discord : [discord.gg/vynt](https://discord.gg/vynt)
- 📖 Documentation : [docs.vynt.io](https://docs.vynt.io)

---

## 🙏 Remerciements

- [Next.js](https://nextjs.org/) - Framework React
- [Supabase](https://supabase.com/) - Backend as a Service
- [shadcn/ui](https://ui.shadcn.com/) - Composants UI
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Chart.js](https://www.chartjs.org/) - Visualisations

---

**Vynt** - Réconciliez vos revenus en toute confiance. 🚀
