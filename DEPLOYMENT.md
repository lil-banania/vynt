# 🚀 Vynt - Guide de Déploiement Production

Ce guide vous accompagne dans le déploiement de Vynt en production sur Vercel + Supabase.

---

## 📋 Pré-requis

- [ ] Compte **Vercel** (recommandé : Pro pour Edge Functions optimisées)
- [ ] Projet **Supabase** créé
- [ ] CLI Supabase installé : `npm install -g supabase`
- [ ] CLI Vercel installé (optionnel) : `npm install -g vercel`

---

## 1️⃣ Configuration Supabase

### Étape 1.1 : Créer le projet Supabase

1. Allez sur [supabase.com](https://supabase.com/)
2. Créez un nouveau projet
3. Notez les credentials :
   - **Project URL** : `https://xxxxx.supabase.co`
   - **Anon Key** : `eyJhbGc...`
   - **Service Role Key** : `eyJhbGc...` (gardez-la secrète !)

### Étape 1.2 : Appliquer les migrations

```bash
# Se connecter au projet Supabase
npx supabase login

# Lier le projet local au projet Supabase
npx supabase link --project-ref <votre-project-id>

# Appliquer les migrations
npx supabase db push
```

**Migrations incluses** :
- `20260118000000_add_audit_error_tracking.sql` - Gestion des erreurs d'audit
- `20260119000000_add_analysis_queue.sql` - File d'attente d'analyse
- `20260119100000_add_anomaly_categories.sql` - Catégories d'anomalies
- `20260119104500_add_disputed_and_fee_categories.sql` - Catégories de frais/disputes
- `20260119200000_add_matched_transactions.sql` - Transactions matchées
- `20260120000000_add_audit_enhancements.sql` - Améliorations des audits

### Étape 1.3 : Configurer l'authentification

1. Dans le dashboard Supabase → **Authentication** → **Providers**
2. Activez **Email** (déjà activé par défaut)
3. Activez **Google OAuth** :
   - Créez un projet sur [Google Cloud Console](https://console.cloud.google.com/)
   - Activez Google+ API
   - Créez des credentials OAuth 2.0
   - Ajoutez l'URL de callback : `https://<votre-project-id>.supabase.co/auth/v1/callback`
   - Copiez **Client ID** et **Client Secret** dans Supabase

### Étape 1.4 : Déployer les Edge Functions

```bash
# Déployer la fonction d'analyse
npx supabase functions deploy analyze-audit --no-verify-jwt

# Déployer la fonction de processing
npx supabase functions deploy process-chunk --no-verify-jwt
```

**Note** : `--no-verify-jwt` est nécessaire car ces fonctions sont appelées depuis le frontend.

---

## 2️⃣ Configuration Vercel

### Étape 2.1 : Connecter le projet

1. Allez sur [vercel.com](https://vercel.com/)
2. Cliquez sur **"New Project"**
3. Importez votre repository GitHub/GitLab
4. Framework Preset : **Next.js** (détecté automatiquement)

### Étape 2.2 : Variables d'environnement

Dans **Settings → Environment Variables**, ajoutez :

```bash
# Supabase (obligatoires)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...

# Supabase Service Role (pour l'admin)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# Next.js
NEXT_PUBLIC_APP_URL=https://vynt.vercel.app  # Votre URL de production
```

**Environnements** : Cochez `Production`, `Preview`, `Development`

### Étape 2.3 : Déployer

```bash
# Via CLI (optionnel)
vercel --prod

# OU via Git push
git push origin main
```

Vercel détectera automatiquement votre configuration Next.js et déploiera l'application.

---

## 3️⃣ Configuration Post-Déploiement

### Étape 3.1 : Vérifier les redirections

1. Testez l'authentification : `/login` → `/dashboard` après connexion
2. Testez les routes protégées : `/dashboard`, `/upload`, `/audit/[id]`

### Étape 3.2 : Configurer les domaines personnalisés

1. Dans Vercel → **Settings → Domains**
2. Ajoutez votre domaine (ex: `app.vynt.com`)
3. Configurez les DNS selon les instructions Vercel

### Étape 3.3 : Mettre à jour les URLs de callback

Dans Supabase → **Authentication** → **URL Configuration** :

- **Site URL** : `https://app.vynt.com` (votre domaine production)
- **Redirect URLs** : 
  - `https://app.vynt.com/api/auth/callback`
  - `https://app.vynt.com/dashboard`

---

## 4️⃣ Monitoring & Logs

### Vercel
- **Logs** : Vercel Dashboard → Project → Deployments → Logs
- **Analytics** : Vercel → Analytics (Web Vitals, performances)
- **Edge Functions** : Monitoring des Edge Functions Supabase

### Supabase
- **Logs** : Supabase Dashboard → Logs
- **Database** : Supabase → Database → Backups (activez les backups automatiques)
- **Edge Functions** : Supabase → Edge Functions → Logs

---

## 5️⃣ Checklist de Lancement

- [ ] ✅ Build réussi (`npm run build` en local)
- [ ] ✅ Migrations DB appliquées
- [ ] ✅ Edge Functions déployées
- [ ] ✅ Variables d'environnement configurées sur Vercel
- [ ] ✅ Authentification Google fonctionnelle
- [ ] ✅ Test du flow complet : Login → Upload → Audit → Résultats
- [ ] ✅ Domaine personnalisé configuré
- [ ] ✅ Backups DB activés
- [ ] ✅ Monitoring configuré

---

## 🔧 Dépannage

### Erreur : "Invalid JWT"
- Vérifiez que `NEXT_PUBLIC_SUPABASE_ANON_KEY` est correct
- Vérifiez que les Edge Functions sont déployées avec `--no-verify-jwt`

### Erreur : "Failed to fetch audit status"
- Vérifiez que les Edge Functions sont déployées
- Vérifiez les logs Supabase Edge Functions

### Erreur : "CORS error"
- Dans Supabase → API Settings → CORS Allowed Origins
- Ajoutez votre domaine Vercel : `https://*.vercel.app` et `https://app.vynt.com`

### Build échoue sur Vercel
- Vérifiez les variables d'environnement
- Vérifiez les logs de build dans Vercel
- Testez `npm run build` en local avec les mêmes variables

---

## 📚 Ressources

- [Next.js Deployment Docs](https://nextjs.org/docs/deployment)
- [Vercel Docs](https://vercel.com/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)

---

## 🆘 Support

En cas de problème, contactez l'équipe Vynt ou créez une issue sur le repository.

**Bon déploiement ! 🚀**
