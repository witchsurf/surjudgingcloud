# Workflow n8n : Notification de Paiement Confirmé

Ce workflow est déclenché par l'Edge Function Supabase une fois le paiement validé. Il sert à notifier l'organisateur.

## 🎯 Objectif
Envoyer un email de confirmation à l'organisateur avec les détails du paiement.

---

## Étape 1 : Créer le Workflow

1. Dans n8n, créez un nouveau workflow nommé : `payment_confirmed`

## Étape 2 : Trigger Webhook

1. Ajoutez un nœud **Webhook**
2. Configurez-le :
   - **HTTP Method**: `POST`
   - **Path**: `payment_confirmed`
   - **Authentication**: `None` (on vérifiera le header manuellement ou on fait confiance à l'URL secrète pour l'instant)
   - **Respond**: `Immediately`
   - **Response Code**: `200`

> 💡 **Note**: L'URL complète sera `https://automation.surfjudging.cloud/webhook/payment_confirmed` (Production) ou `.../webhook-test/...` (Test). Assurez-vous que l'Edge Function pointe vers la bonne URL (Production recommandée).

## Étape 3 : Sécurisation (Optionnel mais recommandé)

1. Ajoutez un nœud **If** (ou Switch)
2. Connectez-le au Webhook
3. Condition :
   - String : `{{ $json.headers['x-api-key'] }}`
   - Equal to : `rplaraise@surfjudging` (ou la valeur de votre secret `N8N_API_KEY`)

## Étape 4 : Formater l'Email

1. Ajoutez un nœud **Code** (JavaScript) ou **Set** pour préparer les données.
2. Exemple de données reçues de l'Edge Function :
   ```json
   {
     "event_type": "payment_confirmed",
     "session_id": "cs_test_...",
     "event_id": 69,
     "amount": 5000,
     "currency": "eur",
     "customer_email": "client@example.com"
   }
   ```

## Étape 5 : Envoyer l'Email

1. Ajoutez le nœud **Send Email** (ou Gmail/Outlook selon votre config habituelle)
2. **To**: `{{ $json.body.customer_email }}` (l'email du client)
3. **Ajouter CC/BCC** :
   - Cliquez sur **"Add Option"** (en bas du nœud).
   - Sélectionnez **"CC"** ou **"BCC"**.
   - Entrez votre email (ex: `admin@surfjudging.cloud`).
4. **Subject**: `Confirmation de paiement - Événement #{{ $json.body.event_id }}`
4. **HTML Message**:
   ```html
   <div style="font-family: sans-serif; color: #333;">
     <h1>🏄 Paiement Confirmé !</h1>
     <p>Bonjour,</p>
     <p>Nous avons bien reçu votre paiement pour l'événement <strong>#{{ $json.body.event_id }}</strong>.</p>
     
     <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
       <p><strong>Montant :</strong> {{ $json.body.amount / 100 }} {{ $json.body.currency }}</p>
       <p><strong>Référence :</strong> {{ $json.body.session_id }}</p>
       <p><strong>Statut :</strong> Payé ✅</p>
     </div>

     <p>Votre événement est maintenant <strong>actif</strong>.</p>
     <p>
       <a href="https://surfjudging.cloud/events/{{ $json.body.event_id }}" style="background-color: #0070f3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
         Accéder à mon événement
       </a>
     </p>
   </div>
   ```

## Étape 6 : Activer le Workflow

1. Cliquez sur **Activate** en haut à droite.
2. Assurez-vous que l'URL de production (`/webhook/...`) correspond bien à ce que vous avez configuré dans les secrets de l'Edge Function (`N8N_PAYMENT_CONFIRMED_WEBHOOK`).

---

## 🧪 Test de bout en bout

1. Lancez un paiement via votre app (ou via le curl `payment_init`).
2. Payez sur Stripe.
3. Vérifiez que :
   - L'Edge Function a tourné (logs Supabase).
   - Le workflow n8n `payment_confirmed` s'est déclenché.
   - Vous avez reçu l'email ! 📩
