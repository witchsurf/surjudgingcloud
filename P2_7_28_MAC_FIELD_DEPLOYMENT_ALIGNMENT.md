# P2.7.28 — Mac Field deployment alignment

- Previous served SHA: `34795a0d8012565a6c20bd8cbe0dc25213c9671c`
- Repository starting SHA: `89b7c28fd38a35ab6f67f03b7e821631babe3063`
- Root cause: Mac runtime `releases/mac-runtime/current/dist` had not been rebuilt/copied after HEAD advanced; it served the old manifest/bundles.
- Deployment source: `frontend/dist-field` copied to `releases/mac-runtime/current/dist`, then `surfjudging` restarted.
- New releaseId: `surfjudging-2026.08.12-p2.7.28-runtime-aligned`
- New served SHA: `89b7c28fd38a35ab6f67f03b7e821631babe3063`
- Repository final SHA: `89b7c28fd38a35ab6f67f03b7e821631babe3063`
- Runtime matches code: YES (HTTP manifest and served `assets/index-xSpIHuTV.js` verified).
- Realtime tenant: `TENANT_ID=surfjudging_realtime`.
- Realtime channel: Judge B active-heat `SUBSCRIBED`, `hasPolling:false` after fresh runtime load.
- Note: stale browser localStorage diagnostics still showed `frontendBuild: unreleased`; manifest and HTTP entry bundle are authoritative and aligned.
- Uncommitted changes remaining: launcher/report/artifacts only; no uncommitted application source.
- Commits: existing Realtime fix `89b7c28`; alignment build is from that SHA.
- Push status: no new push in this alignment step.
- No heat transition performed, per stop condition.

Verdict: MAC FIELD RUNTIME ALIGNED
