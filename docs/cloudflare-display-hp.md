# Cloudflare Tunnel for `display.surfjudging.cloud`

This setup exposes the local HP mini PC display through Cloudflare Tunnel without opening inbound router ports.

## Target topology

- HP mini PC runs Docker and serves the frontend locally on port `8080`
- `cloudflared` runs on the same Docker host
- Cloudflare publishes `display.surfjudging.cloud`
- Judges/admin tablets remain on LAN

## Files added

- `infra/docker-compose-cloudflare.yml`
- `infra/.env.cloudflared.example`

## 1. Create the tunnel in Cloudflare

In Cloudflare Zero Trust:

1. Go to `Networks` -> `Tunnels`
2. Create a `Named Tunnel`
3. Choose Docker
4. Copy the generated tunnel token

## 2. Publish the display hostname

In the tunnel public hostnames section, add:

- Hostname: `display.surfjudging.cloud`
- Service type: `HTTP`
- URL: `http://surfjudging:80`

Why `surfjudging:80`:

- The `cloudflared` container joins the same Docker network namespace as the compose app
- The static frontend is already served by the `surfjudging` nginx container on port `80`

## 3. Prepare env file on the HP

```bash
cd /opt/judging/infra
cp .env.cloudflared.example .env.cloudflared
```

Set:

```bash
CLOUDFLARE_TUNNEL_TOKEN=your-real-token
```

## 4. Start the local stack plus tunnel

From `infra/`:

```bash
docker compose \
  --env-file .env.production \
  --env-file .env.cloudflared \
  -f docker-compose.yml \
  -f docker-compose-cloudflare.yml \
  up -d --build
```

If you want the HP to stay LAN-only except for the display, do not expose admin or judge hostnames in Cloudflare.

## 5. DNS and routing

Cloudflare normally creates the DNS route automatically when you add the public hostname to the tunnel.

The public URL should then be:

```text
https://display.surfjudging.cloud
```

## Recommended scope

Expose only:

- `display.surfjudging.cloud`

Do not expose publicly:

- local Supabase REST
- local Postgres
- judge links
- admin routes

## Notes

- `infra/nginx.conf` now accepts `display.surfjudging.cloud`
- If the public display ever needs a stricter view than the full app, create a dedicated display-only frontend route later and point the tunnel there
- If you later want protected remote operations, add a second hostname behind Cloudflare Access instead of exposing it openly
