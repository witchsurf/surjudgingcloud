# 🚀 Déploiement de l'Edge Function Stripe

## ✅ Ce qui a été créé

J'ai créé 3 fichiers dans votre projet:

1. **`supabase/functions/stripe-webhook/index.ts`** - L'Edge Function complète
2. **`supabase/functions/stripe-webhook/.env.example`** - Template des variables d'environnement
3. **`supabase/functions/stripe-webhook/README.md`** - Documentation complète

---

## 📋 Workflow complet

```
Frontend → n8n (payment_init) → Stripe → Edge Function → Supabase → n8n (payment_confirmed)
    │                               │                       │              │
    │                               │                       │              └─ Emails
    │                               │                       └─ Update DB       Notifications
    │                               └─ Checkout                               Workflows
    └─ Demande paiement
```

---

## ⚡ Guide de déploiement rapide

### Étape 1: Installer Supabase CLI

```bash
npm install -g supabase
```

### Étape 2: Login

```bash
supabase login
```

### Étape 3: Lier votre projet

```bash
cd /Users/laraise/.gemini/antigravity/playground/neon-planck
supabase link --project-ref xwaymumbkmwxqifihuvn
```

### Étape 4: Configurer les secrets

```bash
# Stripe
supabase secrets set STRIPE_SECRET_KEY=sk_test_votre_cle
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx

# Supabase
supabase secrets set SUPABASE_URL=https://xwaymumbkmwxqifihuvn.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# n8n (optionnel)
supabase secrets set N8N_PAYMENT_CONFIRMED_WEBHOOK=https://automation.surfjudging.cloud/webhook/payment_confirmed
supabase secrets set N8N_API_KEY=rplaraise@surfjudging
```

### Étape 5: Déployer

```bash
supabase functions deploy stripe-webhook
```

**L'URL sera:**
```
https://xwaymumbkmwxqifihuvn.supabase.co/functions/v1/stripe-webhook
```

---

## 🔧 Configuration Stripe

1. Allez sur [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. **Add endpoint**
3. **URL**: `https://xwaymumbkmwxqifihuvn.supabase.co/functions/v1/stripe-webhook`
4. **Events**:
   - ✅ `checkout.session.completed`
   - ✅ `payment_intent.succeeded`
   - ✅ `payment_intent.payment_failed`
5. **Copier le Signing Secret** et mettre à jour:
   ```bash
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_nouveau_secret
   ```

---

## 🧪 Test

### Option 1: Stripe CLI (recommandé)

```bash
# Terminal 1 - Forward webhooks
stripe listen --forward-to https://xwaymumbkmwxqifihuvn.supabase.co/functions/v1/stripe-webhook

# Terminal 2 - Trigger test
stripe trigger checkout.session.completed
```

### Option 2: Test réel

1. Utilisez votre workflow `payment_init` existant
2. Complétez le paiement sur Stripe
3. Vérifiez les logs:
   ```bash
   supabase functions logs stripe-webhook --tail
   ```

### Vérification DB

```sql
-- Vérifier les paiements complétés
SELECT * FROM payments WHERE status = 'completed' ORDER BY paid_at DESC LIMIT 5;

-- Vérifier les événements payés
SELECT * FROM events WHERE paid = true ORDER BY id DESC LIMIT 5;
```

---

## 🎯 Ce que fait l'Edge Function

1. ✅ **Reçoit** le webhook Stripe
2. ✅ **Vérifie** la signature (sécurité)
3. ✅ **Update** `payments.status` → `'completed'`
4. ✅ **Update** `payments.paid_at` → timestamp
5. ✅ **Update** `events.paid` → `true`
6. ✅ **Update** `events.status` → `'active'`
7. ✅ **Appelle** n8n `payment_confirmed` (optionnel)
8. ✅ **Log** tout pour debugging

---

## 🔗 Intégration avec payment_init

Votre workflow `payment_init` (n8n) **ne change pas** ! Il continue de:

1. Créer la session Stripe
2. Insérer dans `payments` avec `status: 'pending'`
3. Retourner l'URL de checkout

L'Edge Function prend le relai **après** que l'utilisateur paie.

---

## 📊 (Optionnel) Workflow n8n `payment_confirmed`

Si vous voulez des actions post-paiement complexes (emails stylés, Slack, pre-fill, etc.), créez un webhook n8n:

**URL**: `https://automation.surfjudging.cloud/webhook/payment_confirmed`

**Body reçu**:
```json
{
  "event_type": "payment_confirmed",
  "session_id": "cs_test_...",
  "event_id": 69,
  "amount": 5000,
  "currency": "eur",
  "customer_email": "user@example.com"
}
```

**Actions possibles**:
- Envoyer email de confirmation
- Notif Slack à l'admin
- Créer des participants de démo
- Setup heat_configs par défaut
- Générer facture PDF

---

## 🐛 Troubleshooting

### Erreur de déploiement

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

### Voir les logs en temps réel

```bash
supabase functions logs stripe-webhook --tail
```

### Lister/modifier les secrets

```bash
# Lister
supabase secrets list

# Modifier
supabase secrets set NOM_SECRET=nouvelle_valeur

# Supprimer
supabase secrets unset NOM_SECRET
```

### Test local

```bash
supabase functions serve stripe-webhook

# Accessible sur http://localhost:54321/functions/v1/stripe-webhook
```

---

## ✅ Checklist finale

- [ ] Supabase CLI installé
- [ ] Projet lié (`supabase link`)
- [ ] Secrets configurés (6 secrets)
- [ ] Edge Function déployée
- [ ] Webhook Stripe configuré
- [ ] Test avec Stripe CLI réussi
- [ ] Payment confirmé dans DB

---

## 🎊 Résultat final

Vous aurez un système ultra robuste:

1. **payment_init** (n8n) → Création session + DB pending
2. **stripe-webhook** (Edge Function) → Confirmation sécurisée + DB update
3. **payment_confirmed** (n8n optionnel) → Emails/notifications/workflows

**Fiable ✅ | Rapide ⚡ | Sécurisé 🔒 | Flexible 🎨**
