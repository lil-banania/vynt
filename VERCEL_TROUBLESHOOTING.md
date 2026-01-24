# 🔧 Troubleshooting Vercel Deployment Error

## Error: "Application error: a server-side exception has occurred"

This error typically occurs when environment variables are missing or incorrect on Vercel.

---

## ✅ Solution: Configure Environment Variables

### Step 1: Go to Vercel Dashboard
1. Open [vercel.com](https://vercel.com/dashboard)
2. Select your `vynt` project
3. Click on **Settings** → **Environment Variables**

### Step 2: Add Required Variables

Add these environment variables for **Production**, **Preview**, and **Development**:

```bash
# Supabase Configuration (REQUIRED)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# App URL (REQUIRED)
NEXT_PUBLIC_APP_URL=https://vynt.vercel.app
```

### Step 3: Get Supabase Credentials

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Click **Project Settings** → **API**
4. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon/public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ Keep secret!)

### Step 4: Redeploy

After adding variables:
1. Go to **Deployments** tab
2. Click **⋯** on the latest deployment
3. Select **Redeploy**

---

## 🔍 Common Issues

### Issue 1: Missing NEXT_PUBLIC_SUPABASE_URL
**Symptom**: Server-side exception on all pages  
**Fix**: Add `NEXT_PUBLIC_SUPABASE_URL` in Vercel settings

### Issue 2: Wrong Supabase URL format
**Symptom**: Connection errors  
**Fix**: Ensure URL format is `https://xxxxx.supabase.co` (no trailing slash)

### Issue 3: Missing Service Role Key
**Symptom**: Admin features don't work  
**Fix**: Add `SUPABASE_SERVICE_ROLE_KEY` (keep it secret, server-only)

### Issue 4: Environment not selected
**Symptom**: Works in Preview but not Production  
**Fix**: Ensure variables are added for **all environments** (Production, Preview, Development)

---

## ✅ Verification

Once deployed, test these endpoints:
- `https://vynt.vercel.app/login` - Should load login page
- `https://vynt.vercel.app/api/health` - If available
- Check Vercel logs for specific error details

---

## 📞 Still Having Issues?

1. **Check Vercel Logs**:
   - Go to Vercel → Deployments → Click on deployment → Logs
   - Look for specific error messages

2. **Verify Build Logs**:
   - Check if build completed successfully
   - Look for TypeScript or dependency errors

3. **Test Locally**:
   ```bash
   npm run build
   npm start
   ```

4. **Clear Vercel Cache**:
   - Redeploy with "Clear Cache and Redeploy" option

---

**Last Updated**: 2026-01-24  
**Next.js Version**: 16.1.2  
**Deployment Platform**: Vercel
