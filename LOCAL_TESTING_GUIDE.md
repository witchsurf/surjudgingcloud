# 🧪 Local Testing Guide - Complete Event Workflow

This guide walks you through testing the entire surf judging workflow locally, from event creation to judging.

---

## 🚀 Step 1: Setup Local Environment

### 1.1 Get Your Supabase API Key

1. Go to: https://supabase.com/dashboard/project/xwaymumbkmwxqifihuvn/settings/api
2. Copy the **"anon public"** key (it starts with `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`)
3. Open `.env.local` in your editor
4. Replace `<YOUR_ANON_KEY_HERE>` with the copied key

Your `.env.local` should look like:
```env
VITE_SUPABASE_URL=https://xwaymumbkmwxqifihuvn.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ey...
```

### 1.2 Install Dependencies (if not done)

```bash
cd /Users/laraise/Desktop/judging
npm install
```

### 1.3 Start Development Server

```bash
npm run dev
```

The app should open at: **http://localhost:5173**

---

## 👤 Step 2: Create Test User Account

1. **Open the app** at http://localhost:5173
2. **Sign Up** with a test account:
   - Email: `testadmin@example.com` (or your real email)
   - Password: `Test1234!`
3. **Verify your email** (check inbox/spam)
4. **Sign in** with your credentials

> **Note:** This user will be the "Chief Judge" / Event Organizer

---

## 🏆 Step 3: Configure an Event

### 3.1 Create Event

1. Click **"Create Event"** or **"New Event"** button
2. Fill in event details:
   ```
   Event Name: Test Competition 2025
   Location: Hossegor, France
   Date: [Today's date]
   Categories/Divisions: Men, Women, Juniors
   ```
3. Click **"Save"** or **"Create Event"**

### 3.2 Import Participants (CSV Method)

1. In the event, find **"Import Participants"** or **"Add Surfers"**
2. Download the CSV template if available
3. Create a CSV file with participants (or use this example):

```csv
name,category,seed,country,license
John Doe,Men,1,FRA,FR12345
Jane Smith,Women,1,USA,US67890
Bob Wilson,Men,2,AUS,AU11111
Alice Brown,Women,2,POR,PT22222
Tom Davis,Juniors,1,ESP,ES33333
Sarah Miller,Juniors,2,FRA,FR44444
```

4. Upload the CSV file
5. Verify participants are imported correctly

### 3.3 Generate Heat Draws

1. Select division: **"Men"**
2. Choose format:
   - **Round of 16** (if you have 16+ surfers)
   - **Quarterfinals** (if you have 8 surfers)
   - **Semifinals** (if you have 4 surfers)
3. Set heat size: **4 surfers per heat** (standard)
4. Click **"Generate Heats"** or **"Create Brackets"**
5. Review the heat draw
6. Repeat for other divisions (Women, Juniors)

---

## 👨‍⚖️ Step 4: Configure Chief Judge Settings

### 4.1 Set Heat Configuration

For the first heat to judge:

1. Go to **"Heat Management"** or **"Current Heat"**
2. Select the heat:
   ```
   Division: Men
   Round: Round 1
   Heat: Heat 1
   ```
3. Set heat configuration:
   ```
   Duration: 20 minutes
   Number of waves scored: Best 2 of unlimited
   Judges: 5 judges
   ```

### 4.2 Configure Judge Panel

1. Click **"Add Judges"** or **"Judge Setup"**
2. Add 5 judge slots:
   ```
   Judge 1: Maria Garcia
   Judge 2: Pierre Dubois
   Judge 3: Carlos Santos
   Judge 4: Emma Wilson
   Judge 5: Luca Rossi
   ```
3. Assign judge colors (if applicable):
   - Each judge gets a unique identifier
4. Save judge configuration

---

## 🔗 Step 5: Generate and Share Judge Links

### 5.1 Generate Judge Links

1. In the heat configuration, click **"Generate Judge Links"** or **"Share Access"**
2. You should see 5 unique URLs:
   ```
   Judge 1: http://localhost:5173/judge/[event-id]/[heat-id]?judge=1
   Judge 2: http://localhost:5173/judge/[event-id]/[heat-id]?judge=2
   Judge 3: http://localhost:5173/judge/[event-id]/[heat-id]?judge=3
   Judge 4: http://localhost:5173/judge/[event-id]/[heat-id]?judge=4
   Judge 5: http://localhost:5173/judge/[event-id]/[heat-id]?judge=5
   ```

### 5.2 Share Links (Testing Method)

For local testing, you have 2 options:

**Option A: Multiple Browser Tabs**
- Copy each judge link
- Open in separate browser tabs
- Each tab = one judge interface

**Option B: Multiple Browsers**
- Open link 1 in Chrome
- Open link 2 in Firefox
- Open link 3 in Safari
- Open link 4 in Edge
- Open link 5 in Chrome Incognito

**Option C: Multiple Devices** (Best for realistic testing)
- Share links via text/email to your phone, tablet, other computers
- Each device opens one judge link

---

## 🎯 Step 6: Run a Test Heat

### 6.1 Start the Heat (Chief Judge)

1. Go to **Admin/Chief Judge Interface**
2. Ensure you're on the correct heat (Men, R1, H1)
3. Click **"Start Heat"** or **"Begin Timer"**
4. Timer should start counting down from 20:00

### 6.2 Judges Score Waves

On each **Judge Interface** (the 5 tabs/browsers you opened):

1. Verify you see:
   - Current heat information (Men, R1, H1)
   - Timer counting down
   - 4 surfers with their jersey colors
   - Score entry buttons

2. **Score some waves:**

   **Judge 1 scores:**
   - John Doe (Jersey: Red) - Wave 1: **7.50**
   - Bob Wilson (Jersey: Blue) - Wave 1: **6.30**
   - John Doe - Wave 2: **8.20**
   - Bob Wilson - Wave 2: **7.10**

   **Judge 2 scores:**
   - John Doe - Wave 1: **7.80**
   - Bob Wilson - Wave 1: **6.00**
   - John Doe - Wave 2: **8.50**
   - Bob Wilson - Wave 2: **7.30**

   **Repeat for Judges 3, 4, 5** (vary the scores slightly)

3. **Verify real-time updates:**
   - Scores should appear on Admin interface immediately
   - All judge screens should see updated rankings
   - Best 2 waves calculation should update live

### 6.3 Complete the Heat

1. Let the timer run out (or click **"End Heat"** early)
2. Verify heat status changes to **"Completed"**
3. Check final results:
   - Each surfer shows their best 2 waves
   - Total score calculated
   - Rankings displayed (1st, 2nd, 3rd, 4th)

---

## ✅ Step 7: Verify Everything Works

### 7.1 Test Security (IMPORTANT!)

**Test 1: Unauthenticated Access**
1. Open a private/incognito window
2. Try to access the admin interface without logging in
3. **Expected:** Redirected to login page ✅

**Test 2: Judge Can't See Other Events**
1. Create a second user account
2. Try to access the first user's event
3. **Expected:** Access denied or event not visible ✅

**Test 3: Judge Can Only Score During Heat**
1. Before starting heat, try to submit a score
2. **Expected:** Score rejected or button disabled ✅

### 7.2 Test Real-time Sync

**Test with 2 devices:**
1. Open Admin interface on Device 1
2. Open Admin interface on Device 2 (same account)
3. Start heat on Device 1
4. **Expected:** Device 2 updates instantly ✅

**Test judge scoring:**
1. Submit score from Judge 1 interface
2. **Expected:** Score appears on Admin interface within 1 second ✅

### 7.3 Test Heat Progression

1. Complete Heat 1
2. Move to Heat 2
3. **Expected:**
   - Heat 1 locked/closed ✅
   - Heat 2 becomes active ✅
   - Judges can now score Heat 2 ✅

---

## 🎨 Step 8: Test Full Features

### Jersey Colors
- Verify each surfer has a distinct color
- Check color order matches across all interfaces

### Score Validation
- Try entering invalid scores (negative, > 10, non-numeric)
- **Expected:** Validation error message

### Score Override (Admin Only)
- As admin, try to override a judge's score
- Change 7.50 → 7.80
- **Expected:** Override applied, marked as "adjusted"

### Export Results
- After completing heat, click **"Export Results"**
- Try PDF export
- Try CSV export
- **Expected:** Files download with correct data

### Bracket Advancement
- Complete all heats in Round 1
- **Expected:** Winners advance to next round automatically

---

## 🐛 Common Issues & Fixes

### Issue 1: "Cannot read property 'uid' of undefined"
**Fix:** Make sure you're logged in with a valid account

### Issue 2: Scores not appearing in real-time
**Fix:**
1. Check browser console for errors
2. Verify Supabase Realtime is enabled
3. Check if you're using the correct anon key

### Issue 3: "Permission denied" when creating event
**Fix:**
1. Verify RLS policies are applied (we did this!)
2. Make sure `user_id` is set correctly on event creation
3. Check you're logged in with authenticated account

### Issue 4: Judge links not working
**Fix:**
1. Check the URL format is correct
2. Verify judge parameter is included (?judge=1)
3. Make sure heat is in "running" status

### Issue 5: Timer not syncing across devices
**Fix:**
1. Check all devices are connected to internet
2. Verify Supabase Realtime subscriptions are active
3. Look for WebSocket connection in browser dev tools

---

## 📊 Step 9: Test Edge Cases

### Test Ties
1. Give two surfers identical scores
2. **Expected:** System shows both as tied (or uses tiebreaker rules)

### Test Late Score Entry
1. Let heat timer expire
2. Try to enter a score after time is up
3. **Expected:** Score is rejected or marked as "late"

### Test Score Deletion
1. Submit a score
2. Delete or modify it
3. **Expected:** Score removed, rankings updated

### Test Multiple Heats Running
1. Start Heat 1
2. Try to start Heat 2 simultaneously
3. **Expected:** Only one heat can be active at a time

---

## 🎉 Success Criteria

Your system is working correctly if:

- ✅ Events can be created by authenticated users
- ✅ Participants can be imported via CSV
- ✅ Heats are generated correctly
- ✅ Judge links work and show the correct interface
- ✅ Scores sync in real-time across all devices
- ✅ Timer counts down and syncs across interfaces
- ✅ Rankings calculate correctly (best 2 waves)
- ✅ Security works (users can't access others' events)
- ✅ Heat status transitions work (waiting → running → completed)
- ✅ Results can be exported as PDF/CSV

---

## 📞 Need Help?

If you encounter issues during testing:

1. **Check Browser Console:**
   ```
   Right-click → Inspect → Console tab
   Look for red error messages
   ```

2. **Check Supabase Logs:**
   - Go to: https://supabase.com/dashboard/project/xwaymumbkmwxqifihuvn/logs
   - Look for errors or rejected queries

3. **Verify Database Policies:**
   ```sql
   -- Run in Supabase SQL Editor
   SELECT tablename, policyname, cmd
   FROM pg_policies
   WHERE schemaname = 'public'
   ORDER BY tablename;
   ```

4. **Check Network Tab:**
   ```
   Browser Dev Tools → Network tab
   Look for failed API requests (red entries)
   ```

---

## 🚀 Ready for Production?

Once you've successfully completed this testing workflow, you can:

1. ✅ Deploy to production with confidence
2. ✅ Share judge links with real judges
3. ✅ Run live competitions
4. ✅ Monitor real-time during events

Your database is already secured and optimized! 🎊
