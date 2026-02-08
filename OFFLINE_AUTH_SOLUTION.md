# 🔐 Offline-First Authentication Solution

## Overview

Professional authentication system that maintains subscription/payment requirements while enabling offline work.

---

## 🎯 Architecture

### **3-Mode System:**

1. **Dev Mode** (Local Testing)
   - Automatic bypass for development
   - No internet required
   - Set `VITE_DEV_MODE=true` in `.env.local`

2. **Online Mode** (First Use / Payment)
   - User pays subscription online
   - Magic link authentication via Supabase
   - Credentials stored locally for offline use

3. **Offline Mode** (Field Use)
   - Works without internet after initial setup
   - Uses stored credentials from previous online session
   - Periodic sync when online (every 7 days recommended)

---

## 🚀 Quick Start - Dev Mode (Now Active!)

Your local environment is now configured for development:

```env
# In frontend/.env.local
VITE_DEV_MODE=true
VITE_DEV_USER_EMAIL=dev@surfjudging.local
```

**What this does:**
- ✅ Bypasses magic link authentication
- ✅ Auto-login with dev credentials
- ✅ Access to all features locally
- ✅ No internet required

**To use:**
1. Run `npm run dev` in frontend folder
2. Navigate to `/my-events`
3. You'll be auto-logged in as `dev@surfjudging.local`
4. Create and test events normally!

---

## 💼 Production Flow

### **For Your Customers:**

#### **Step 1: Initial Setup (Online)**
```
Customer visits your site
  ↓
Pays for subscription (Stripe)
  ↓
Receives magic link email
  ↓
Clicks link → authenticated
  ↓
Credentials saved locally
```

#### **Step 2: Field Use (Offline)**
```
Customer opens app at competition venue
  ↓
No internet? No problem!
  ↓
App uses stored credentials
  ↓
All features work offline
  ↓
Data syncs when back online
```

#### **Step 3: Periodic Sync (Every 7 Days)**
```
App detects it's been 7 days since last sync
  ↓
When online, auto-syncs in background
  ↓
Updates subscription status
  ↓
Refreshes credentials
```

---

## 🛠️ Implementation Details

### **Files Created:**

1. **`frontend/src/lib/offlineAuth.ts`**
   - Core offline auth logic
   - Credential storage
   - Subscription validation
   - Dev mode bypass

2. **`frontend/src/components/OfflineAuthWrapper.tsx`**
   - React wrapper component
   - Handles auth state
   - Provides user to children
   - Auto-fallback to offline

3. **Updated `frontend/src/pages/MyEvents.tsx`**
   - Integrated with OfflineAuthWrapper
   - Shows offline indicator
   - Dev mode banner

### **Configuration:**

```env
# .env.local

# Dev Mode (for local testing)
VITE_DEV_MODE=true
VITE_DEV_USER_EMAIL=dev@surfjudging.local

# Local Supabase
VITE_SUPABASE_URL_LAN=http://surfjudging.local:8000
VITE_SUPABASE_ANON_KEY_LAN=your-key

# Cloud Supabase (for production/payment)
VITE_SUPABASE_URL_CLOUD=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY_CLOUD=your-cloud-key
```

---

## 📱 User Experience

### **Online (First Time):**
```
Login Screen
  ├── Email input
  ├── "Send Magic Link" button
  └── User clicks link in email → authenticated
```

### **Offline (After Setup):**
```
App Opens
  ├── Checks stored credentials
  ├── Validates subscription
  └── Auto-login → ready to use!
```

### **Indicators:**
- 🔧 **Yellow banner**: Dev mode active
- 📴 **Amber banner**: Offline mode (using stored credentials)
- 🌐 **No banner**: Online mode (connected to Supabase)

---

## 🔒 Security Considerations

### **Current (MVP):**
- Credentials in localStorage (base64 encoded)
- Subscription validity check
- Periodic sync requirement

### **Production Recommendations:**
1. **Encrypt credentials** with Web Crypto API
2. **Add device fingerprinting** to prevent credential sharing
3. **Implement PIN/biometric** for quick access
4. **Rate limiting** on auth endpoints
5. **Subscription verification** via Stripe webhooks

---

## 🧪 Testing

### **Test Dev Mode:**
```bash
cd frontend
npm run dev
# Open http://localhost:5173/my-events
# Should auto-login as dev@surfjudging.local
```

### **Test Offline Mode:**
1. Login online first (magic link)
2. Open DevTools → Network tab
3. Enable "Offline" mode
4. Refresh page
5. Should still be logged in!

### **Test Subscription Expiry:**
```javascript
// In browser console:
const user = JSON.parse(localStorage.getItem('surfjudging_offline_user'));
user.subscription.validUntil = '2020-01-01'; // Past date
localStorage.setItem('surfjudging_offline_user', JSON.stringify(user));
// Refresh → should show subscription expired
```

---

## 🎨 Customization

### **Change Dev User Email:**
```env
VITE_DEV_USER_EMAIL=myemail@test.local
```

### **Adjust Sync Frequency:**
```typescript
// In offlineAuth.ts, line ~250
export function needsSync(): boolean {
  // Change 7 to desired days
  return daysSinceSync > 7;
}
```

### **Add PIN Authentication:**
```typescript
// Already built-in!
import { setOfflinePin, verifyOfflinePin } from './lib/offlineAuth';

// After first login:
setOfflinePin('1234');

// Later, quick access:
if (verifyOfflinePin(userInput)) {
  // Grant access
}
```

---

## 🚢 Deployment

### **Local Development:**
```env
VITE_DEV_MODE=true
VITE_SUPABASE_URL=http://surfjudging.local:8000
```

### **Production (Cloud):**
```env
VITE_DEV_MODE=false  # IMPORTANT!
VITE_SUPABASE_URL_CLOUD=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY_CLOUD=your-production-key
```

### **Field Devices (Kiosk):**
```env
VITE_DEV_MODE=false
VITE_SUPABASE_URL_LAN=http://surfjudging.local:8000
# Credentials will be stored after first online setup
```

---

## 📊 Benefits

| Feature | Before | After |
|---------|--------|-------|
| **Dev Testing** | ❌ Needs internet | ✅ Works offline |
| **Field Use** | ❌ Requires connection | ✅ Works offline |
| **Payment Model** | ✅ Enforced | ✅ Still enforced |
| **User Experience** | ⚠️ Login every time | ✅ Auto-login |
| **Subscription Check** | ❌ Manual | ✅ Automatic |

---

## 🤝 Integration with Payment System

When user completes payment:

```typescript
// In your Stripe success webhook
await supabase.auth.admin.createUser({
  email: customerEmail,
  email_confirm: true,
  user_metadata: {
    subscription_plan: 'basic',
    subscription_valid_until: subscriptionEnd,
  }
});

// Send magic link
await supabase.auth.signInWithOtp({
  email: customerEmail,
  options: {
    data: {
      subscription_plan: 'basic',
      subscription_valid_until: subscriptionEnd,
    }
  }
});
```

---

## 📞 Support

**Issue**: Login loop in dev mode
**Fix**: Check `VITE_DEV_MODE=true` in `.env.local`

**Issue**: "Supabase not configured"
**Fix**: Check Supabase URL and keys in `.env.local`

**Issue**: Offline mode not working
**Fix**: Login online first to store credentials

---

## ✅ Next Steps

1. **Test dev mode** - Open `/my-events` and verify auto-login
2. **Create test event** - Use local Supabase
3. **Test offline** - Disable network, reload page
4. **Add PIN auth** - Optional but recommended for field use
5. **Deploy** - Set `VITE_DEV_MODE=false` for production

---

**Your app is now ready for offline-first development! 🎉**

Run `npm run dev` in the frontend folder and navigate to `/my-events` to see it in action.
