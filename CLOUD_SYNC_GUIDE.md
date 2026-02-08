# 🌐 Cloud Event Sync Guide

## Overview

This guide shows you how to sync events from your cloud Supabase (where payment/creation happens) to your local dev environment for offline testing.

---

## 🎯 How It Works

```
Online (Production)          Local (Development)
─────────────────────        ───────────────────
User pays → Event created    Pull events from cloud
      ↓                               ↓
Cloud Supabase               Cache in localStorage
                                      ↓
                             Work offline with real data
```

---

## 📋 Prerequisites

1. ✅ Dev mode enabled (`VITE_DEV_MODE=true`)
2. ✅ Cloud Supabase credentials configured in `.env.local`
3. ✅ At least one event created in cloud (via payment flow)

---

## 🚀 Initial Sync (First Time)

### Option 1: Using Browser Console (Easiest)

1. **Open your app** in dev mode: `http://localhost:5173/my-events`

2. **Open browser console** (F12 or Cmd+Option+J)

3. **Run this command:**

```javascript
// Sync events from cloud
import('/src/utils/syncCloudEvents.ts').then(module => {
  module.syncEventsFromCloud('your-email@example.com')
    .then(events => {
      console.log('✅ Synced events:', events);
      window.location.reload();
    })
    .catch(err => console.error('❌ Sync failed:', err));
});
```

Replace `your-email@example.com` with your actual cloud account email.

### Option 2: Using the Sync Button (Requires Cloud Login First)

**Important:** You need to login to cloud at least once for this to work.

1. **Temporarily switch to cloud Supabase:**
   ```env
   # In .env.local, temporarily comment out dev mode
   # VITE_DEV_MODE=true

   # And use cloud URLs
   VITE_SUPABASE_URL=https://xwaymumbkmwxqifihuvn.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

2. **Restart dev server** and login via magic link

3. **Re-enable dev mode:**
   ```env
   VITE_DEV_MODE=true
   VITE_SUPABASE_URL=http://surfjudging.local:8000
   ```

4. **Restart and click "🌐 Sync depuis Cloud"** button

---

## 🔄 Regular Sync

Once initial sync is done, you can sync anytime:

1. Open `/my-events` page
2. Click **"🌐 Sync depuis Cloud"** button
3. Wait for sync to complete
4. Your events are now cached locally!

The app will show:
- ✅ Success message with event count
- 📅 Last sync timestamp
- ⚠️ Warning if sync is older than 24 hours

---

## 🛠️ Manual Sync (Alternative Method)

If the button doesn't work, you can sync manually:

### Step 1: Get Your Cloud Events

```bash
# Install Supabase CLI if needed
npm install -g supabase

# Or use curl to query directly
curl -X GET 'https://xwaymumbkmwxqifihuvn.supabase.co/rest/v1/events?select=*' \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 2: Store in localStorage

Open browser console and run:

```javascript
const events = [
  // Paste your events here from the API response
  { id: 1, name: "My Event", organizer: "Me", ... }
];

localStorage.setItem('surfjudging_cloud_events', JSON.stringify(events));
localStorage.setItem('surfjudging_last_sync', new Date().toISOString());
console.log('✅ Events cached!');
window.location.reload();
```

---

## 📊 What Gets Synced

From cloud to local:
- ✅ Event basic info (name, organizer, dates)
- ✅ Event status
- ✅ Last configuration (division, round, heat)
- ✅ Participants (if any)
- ✅ User ID associations

Not synced (local only):
- ❌ Real-time scores during competition
- ❌ Judge work counts
- ❌ Timer states

---

## 🔧 Troubleshooting

### Error: "Cloud authentication required"

**Solution:** You need to login to cloud at least once. Follow "Option 2" above.

### Error: "Cloud Supabase credentials not configured"

**Solution:** Check your `.env.local` has:
```env
VITE_SUPABASE_URL_CLOUD=https://xwaymumbkmwxqifihuvn.supabase.co
VITE_SUPABASE_ANON_KEY_CLOUD=your-cloud-key
```

### Events not showing after sync

**Solution:**
1. Check browser console for errors
2. Verify localStorage: `localStorage.getItem('surfjudging_cloud_events')`
3. Click "🔄 Rafraîchir" to reload
4. Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

### Sync is very old

**Solution:** The app warns if last sync is over 24 hours old. Just click "Sync depuis Cloud" again to refresh.

---

## 📝 Quick Reference

| Action | Command |
|--------|---------|
| **Initial Sync** | Browser console: `module.syncEventsFromCloud('email')` |
| **Regular Sync** | Click "🌐 Sync depuis Cloud" button |
| **Check Last Sync** | Look for "📅 Dernière sync:" under buttons |
| **Clear Cache** | `localStorage.removeItem('surfjudging_cloud_events')` |
| **View Cached** | `JSON.parse(localStorage.getItem('surfjudging_cloud_events'))` |

---

## ✨ Benefits

| Before | After |
|--------|-------|
| ❌ No events in dev mode | ✅ Real events from production |
| ❌ Need to create test data | ✅ Use actual paid events |
| ❌ Can't test real workflows | ✅ Test with production data |
| ❌ Online dependency | ✅ Work completely offline |

---

## 🎉 You're All Set!

Once synced, your local dev environment will show all events from your cloud production environment. You can:
- ✅ Test with real event data
- ✅ Work offline
- ✅ Create heats and manage participants
- ✅ Test full competition workflows

Just remember to sync periodically to get new events!
