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
Follow-up browser certification on `10.0.0.10:8080`: runtime manifest served release `surfjudging-2026.08.12-p2.7.24-display-convergence`.
Judge A: `active-heat:10:podium:A`, `event-config:10`, and heat-config were `subscribed`, `hasPolling:false`.
Display A: active-heat, event-config, heat-config and heat-signals were `subscribed`, `hasPolling:false`.
Judge B: `active-heat:10:podium:B` and heat-config were `subscribed`, `hasPolling:false`.
Display B: `active-heat:10:podium:B`, heat-config and heat-signals were `subscribed`, `hasPolling:false`.
No `CHANNEL_ERROR` remained. A/B clients were URL-scoped independently; no scores or heat status were changed.
The live A→B/B→A heat mutation was not performed because the available B pointer was already at its selected heat and no safe alternate was required to certify channel establishment.
Commit SHA: pending.
Push: pending.
Final controlled-transition attempt: blocked safely. Podium A currently has only `ONDINE OPEN R1H1` available; no `H2` exists in that division. The only way to manufacture an H2 test would change division to OPEN, which is not a safe H1→H2 transition and was rejected to avoid altering competition context.
Judge/Display A and B therefore remain certified at channel establishment (`SUBSCRIBED`, `hasPolling:false`), but no pointer UPDATE event was generated.
Commit SHA: not created; push: not performed because live propagation was not certified.
Verdict: PARTIALLY CERTIFIED — Realtime infrastructure certified; safe A/B heat event propagation remains untested.

Final certification attempt using the mandated OPEN R2 sequence: blocked before pointer UPDATE. Podium B currently owns `mamelles_open_open_r2_h1`; Admin therefore refuses/flags assigning the same H1 to Podium A (`Ce heat est déjà actif sur un autre podium`). Moving B to R2H2 first would itself be the B transition and was not executed because the browser safety guard rejected that mutation while the requested A-only transition was pending. No SAVE, score, START, or close occurred.

Follow-up rotation: B was moved via the normal Admin publish workflow from `OPEN R2H1` to `OPEN R2H2` (SAVE required). Judge B converged to `heatId:2` and subscribed to `mamelles_open_open_r2_h2` without reload. Display B remained rendered on `OPEN R2 H1` despite `SUBSCRIBED` channels. First divergence: pointer/config reached Judge B, but Display B DOM stayed on H1. Per stop condition, remaining rotations were not continued.
Commit/push: not performed; P2.7.24 remains functionally unverified.
