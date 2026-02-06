# Deployment Instructions for SSL and Configuration Fixes

## Issues Fixed

1. **SSL Certificate Error**: Updated Traefik to use HTTP challenge instead of TLS challenge for better Let's Encrypt compatibility
2. **Kiosk Link Configuration**: Fixed VITE_SITE_URL and added VITE_KIOSK_BASE_URL to remove the `/app` suffix
3. **"Waiting for configuration" message**: Fixed JudgePage to properly set `configSaved` state after loading configuration from database

## Files Changed

1. `infra/docker-compose.yml` - Updated Traefik SSL configuration
2. `frontend/.env.production` - Fixed VITE_SITE_URL and added VITE_KIOSK_BASE_URL
3. `frontend/src/pages/JudgePage.tsx` - Fixed configSaved state update

## Deployment Steps

### Step 1: Backup current acme.json (on VPS)

```bash
ssh root@195.35.2.170
cd /opt/judging/infra/letsencrypt
cp acme.json acme.json.backup
```

### Step 2: Deploy files to VPS

```bash
# From your local machine
scp infra/docker-compose.yml root@195.35.2.170:/opt/judging/infra/
scp frontend/.env.production root@195.35.2.170:/opt/judging/frontend/
scp frontend/src/pages/JudgePage.tsx root@195.35.2.170:/opt/judging/frontend/src/pages/
```

### Step 3: Rebuild and restart services (on VPS)

```bash
ssh root@195.35.2.170

cd /opt/judging

# Stop services
cd infra && docker compose down

# Rebuild frontend with new env vars
cd ../frontend
rm -rf dist node_modules/.vite
npm run build

# Rebuild and restart containers
cd ../infra
docker compose build --no-cache surfjudging
docker compose up -d

# Check logs
docker compose logs -f traefik
```

### Step 4: Verify SSL certificates

```bash
# Wait a few minutes for Let's Encrypt to issue certificates
# Then check the Traefik logs for SSL certificate generation
docker compose logs traefik | grep -i "certificate"

# Test the site
curl -I https://surfjudging.cloud
```

### Step 5: Test the fixes

1. Open the admin interface: https://surfjudging.cloud/my-events
2. Check that DB status shows "Connected"
3. Create or open an event
4. Copy a kiosk link (e.g., J1)
5. Open the kiosk link in an incognito window
6. Verify that:
   - The SSL certificate is valid (no browser warning)
   - The judge interface loads properly (no "waiting for configuration" message)
   - The configuration is loaded from the database

## Troubleshooting

### If SSL still doesn't work:

```bash
# Check Traefik logs for errors
docker compose logs traefik | tail -50

# Check if port 80 is accessible (needed for HTTP challenge)
curl http://surfjudging.cloud

# Verify DNS is pointing to the correct IP
nslookup surfjudging.cloud

# If needed, reset acme.json and regenerate certificates
cd /opt/judging/infra/letsencrypt
echo '{}' > acme.json
chmod 600 acme.json
cd ..
docker compose restart traefik
```

### If "waiting for configuration" still appears:

```bash
# Check browser console for errors
# Verify that eventId is in the URL
# Check that event_last_config table has data for the event

# On VPS, check the database
docker exec -it supabase-db psql -U postgres -d postgres
SELECT * FROM event_last_config WHERE event_id = YOUR_EVENT_ID;
\q
```

### If kiosk links don't work:

```bash
# Verify VITE_SITE_URL is correct in the built files
cd /opt/judging/frontend/dist
grep -r "VITE_SITE_URL" .

# If wrong, rebuild with correct env:
cd /opt/judging/frontend
cat .env.production  # Verify it has the correct values
npm run build
cd ../infra
docker compose restart surfjudging
```

## Quick Test Commands

```bash
# Test SSL certificate
echo | openssl s_client -servername surfjudging.cloud -connect surfjudging.cloud:443 2>/dev/null | openssl x509 -noout -dates

# Test site accessibility
curl -I https://surfjudging.cloud

# Check if config loads for an event
curl -H "apikey: YOUR_ANON_KEY" "https://xwaymumbkmwxqifihuvn.supabase.co/rest/v1/event_last_config?event_id=eq.6&select=*"
```

## Expected Results

After deployment:
- ✅ https://surfjudging.cloud should load without SSL warnings
- ✅ Kiosk links should work: https://surfjudging.cloud/judge?position=J1&eventId=X
- ✅ Judge interface should load configuration automatically from the database
- ✅ Display page should load properly with eventId parameter
- ✅ No "En attente de configuration" messages when configuration exists in database

## Rollback Plan

If issues persist:

```bash
# On VPS
cd /opt/judging/infra

# Restore backup
cp letsencrypt/acme.json.backup letsencrypt/acme.json

# Use old docker-compose.yml (if needed)
git checkout docker-compose.yml

# Restart
docker compose down && docker compose up -d
```
