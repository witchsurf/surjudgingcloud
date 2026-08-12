# P2.7.26 — Mac Field Realtime

Realtime websocket: Kong route exists at `/realtime/v1` → `/socket`; local HTTP route responds (websocket handshake was not re-run after restart because LAN became unreachable).
Gateway: reached Realtime before fix; Realtime logged tenant auth failure.
Realtime service: healthy container, but seeded tenant was `realtime-dev` while clients requested `surfjudging_realtime`.
Postgres: healthy; Realtime logs showed `tcp recv: closed` and phantom subscribers during the mismatch.
Publication: `supabase_realtime` contains active_heat_pointer, event_last_config, heat_realtime_config, scores and required heat tables.
Channel status before: `CHANNEL_ERROR` → `fallback_polling`.
Exact root cause: hard-coded image seed `tenant_name = "realtime-dev"`; client tenant `surfjudging_realtime` was absent.
Files/config changed: `infra/docker-compose-local.yml` now parameterizes the seed from `TENANT_ID` and defaults it to `surfjudging_realtime`.
Channel status after: tenant recreated as `surfjudging_realtime`; no post-fix browser handshake possible because LAN became unreachable from the test browser.
A Judge: not re-certified after restart.
A Display: not re-certified after restart.
B Judge: not re-certified after restart.
B Display: not re-certified after restart.
Fallback polling: retained; was active before fix.
Commit SHA: pending.
Push: pending.
Verdict: PARTIALLY CERTIFIED — infrastructure root cause fixed and tenant recreated; live websocket/client propagation still requires a reachable Mac Field browser.
