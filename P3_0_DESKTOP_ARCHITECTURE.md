# P3.0 — Desktop Architecture & Distribution Design

**Statut:** architecture uniquement — aucune implémentation P3 effectuée.

## Certified baseline

- Field host observed: `10.0.0.10` (dynamic; never hard-code it).
- Certified application revision: `17ed8b0799a9a0298b7d6b7812f57403432b093d`.
- Certified release: `surfjudging-2026.08.14-p2.7.78-lineage-fix`.
- P2.7.86: full pass; Field restart and controlled public-origin loss pass.
- Field DB remains authoritative during an event. Cloud was not modified.

## Current Field architecture

The current Mac launcher is `scripts/start-surfjudging-field-mac.sh`. It reads
the immutable release under `releases/mac-runtime/current/dist`, validates the
Field manifest, starts Colima when Docker is unavailable, starts the local
Compose stack, checks REST, restarts/starts the nginx frontend container,
checks the served release and verifies the authoritative DB mode is `field`.

| Component | Purpose | Current start/dependency | Ports | Persistence | Desktop target |
|---|---|---|---|---|---|
| Colima/Docker | container runtime | `colima start`; Docker context | socket | VM disk | orchestrate in P3A; abstract later |
| PostgreSQL | Field source of truth | Compose, healthy before dependents | 5432 | `postgres-data` volume | own lifecycle, never delete implicitly |
| PostgREST | REST/RPC | depends on Postgres | internal via Kong/8000 | stateless | own lifecycle |
| Realtime | subscriptions | depends on Postgres; tenant `surfjudging_realtime` | internal via Kong/8000 | DB metadata | own lifecycle |
| Auth | local auth/JWT | depends on Postgres | internal via Kong | DB metadata | own lifecycle |
| Kong | API gateway/CORS | depends on Auth/REST/Realtime/Storage | 8000/8443 | config `infra/kong.yml` | own lifecycle |
| Storage | Supabase storage | depends on PostgREST | internal | `storage-data` volume | own lifecycle |
| Studio/Meta | operator introspection | optional/admin | 3000/8080 internal | none | observe/advanced only |
| nginx frontend | serves immutable Field dist | mounted `current/dist` | 8080 | release files | own lifecycle |

The repository also contains `scripts/hp-ops.sh`, `hp-healthcheck.sh`,
`hp-backup.sh`, `hp-refresh-stack.sh`, `hp-sync-cloud-to-local.sh`,
`hp-live-sync.sh`, `hp-deploy-frontend.sh`, and `field-ops.sh`. HP scripts
still assume SSH/profile conventions and are not the final desktop API.

## Current operator journey and pain

Today the operator opens a terminal, starts the Mac script, waits for Docker,
checks the printed LAN address, opens `/admin`, and distributes tablet URLs.
Recovery requires rerunning the script and manually checking manifest/health.
Backup, Cloud→Field preparation and Field→Cloud publishing are separate shell
commands. IP changes, stale releases, Docker health and schema mismatches are
operator-visible only through terminal output.

The desktop must hide startup, LAN discovery, health polling and URL copying.
Explicit Save/Backup/Restore, environment selection, Cloud sync and stopping a
running event remain deliberate operator actions with confirmations.

## Desktop responsibilities

| Responsibility | Decision | Rationale |
|---|---|---|
| Shell/window and Field UI | Own | consistent operator experience |
| Service lifecycle | Orchestrate | preserve existing services before replacing them |
| DB lifecycle/data | Orchestrate + observe | app must never silently erase or reset data |
| LAN discovery/URLs/QR | Own | dynamic interfaces are a core requirement |
| Manifest/schema/health | Own diagnostics | prevent mystery bundles |
| Backup/export | Own workflow over existing scripts | recovery must be visible and verified |
| Restore | Orchestrate with explicit confirmation | destructive operation |
| Cloud sync | Orchestrate existing one-way scripts | preserve source-of-truth boundaries |
| Cloud UI | Open separately or explicit mode | prevent accidental wrong-environment writes |
| Updates | Own staging/policy | never update during a running heat |
| Existing web development | Out of scope | desktop is an additional delivery layer |

## Tauri versus Electron

| Criterion | Tauri | Electron |
|---|---|---|
| macOS/Windows | strong | strong |
| bundle/memory | small/native webview | larger/Chromium runtime |
| shell/filesystem | Rust commands, explicit allowlist | Node APIs, mature but broader attack surface |
| process orchestration | possible, requires Rust design | straightforward with Node child processes |
| Docker/Colima integration | possible but more bespoke | easiest initial integration |
| updater/signing | mature, platform work still required | mature ecosystem, larger artifacts |
| React/Vite integration | straightforward | straightforward |
| debugging/support | two runtimes | familiar web/Node tooling |
| Windows service/runtime gap | still substantial | still substantial |

**Recommendation: ELECTRON for P3A, confidence MEDIUM-HIGH.** The first
desktop increment is a lifecycle/orchestration product, not a thin webview.
Node child-process, filesystem, diagnostics and streaming logs reduce initial
integration risk. Tauri remains a P3D reassessment if memory footprint or
security review makes the Rust boundary worthwhile. The decision must be
revisited after a process-manager prototype, not on bundle size alone.

## Docker/Colima options

| Model | Result |
|---|---|
| A — orchestrate installed Docker/Colima | lowest P3A risk; current Mac-compatible path; external prerequisites remain |
| B — bundle managed runtime | poor installer/support burden; privilege and licensing concerns |
| C — replace with native services | major correctness/RLS/Realtime migration; unacceptable for first increment |
| D — hybrid | recommended roadmap: wrap existing stack first, reduce dependencies later |

P3A should require a supported runtime check and provide guided installation
links/instructions; it must not silently install Docker, Colima, or privileged
components. Long term, a managed runtime may be evaluated separately. Native
Postgres replacement is not authorized without parity evidence.

## Windows gap analysis

| Current dependency | Classification | Required abstraction |
|---|---|---|
| Colima/macOS VM | Windows replacement required | Docker Desktop/WSL2 or supported managed runtime |
| Unix Docker socket | needs abstraction | Docker API/context discovery |
| bash scripts/sed/awk/rsync | Windows replacement required | typed cross-platform service layer |
| `route`, `ipconfig`, `ifconfig` | needs abstraction | platform network adapter API |
| SSH HP profiles | needs abstraction | explicit remote transport or remove from desktop core |
| POSIX paths/permissions | needs abstraction | platform app-data APIs |
| Postgres volumes | portable concept | platform-managed persistent volume |
| LAN binding | portable | adapter/routing diagnostics |

Windows is not certified by P2. A P3C workstream is required before claiming
parity; do not promise identical startup behavior yet.

## Local DB/backend strategy

Keep Postgres, PostgREST, Realtime, Auth, Kong and Storage containerized in
P3A. These services encode the certified RPC, RLS, Realtime tenant and local
Field behavior. Studio/Meta is optional and should not block competition.
Reduce services only after contract tests prove REST, RPC, Realtime, Auth,
RLS and required storage behavior. PostgreSQL 5432 should bind localhost by
default in the desktop product; LAN tablets use Kong 8000. Existing tooling
may retain an explicit development override.

## Data directory

macOS: `~/Library/Application Support/SurfJudging/`; Windows:
`%APPDATA%\\SurfJudging\\` (with large DB/backup data redirected to the
platform data directory as appropriate).

```text
data/
  postgres/ storage/
backups/ exports/
logs/ config/ releases/ certificates/ cache/ tmp/
```

The application bundle is immutable. DB data, backups and exports never live
inside the app bundle or disposable `dist` directory. Uninstall preserves data
by default.

## Network and LAN strategy

Keep predictable frontend/API ports (8080/8000) for tablet usability, with a
preflight conflict detector and a documented advanced override. Do not expose
5432 to the LAN. Discover the default route/interface, probe each candidate
address at `/deployment-manifest.json`, and select only the address that
actually serves the expected Field release. Detect Wi-Fi/Ethernet/VPN changes,
show the active address, and refresh QR/copy links. mDNS is optional convenience,
never the sole discovery mechanism.

URLs generated: Admin, Judge J1–J5, Priority, Display and optional Overlay.
Every screen visibly identifies `FIELD — LOCAL` or `CLOUD — ONLINE`.

## Health and diagnostics UX

One dashboard shows desktop version, frontend release/revision, expected and
actual schema, Field IP, frontend/API/Postgres/Realtime/Auth/Storage health,
disk space, backup age/checksum, Cloud reachability and Internet state. Reuse
existing healthcheck semantics; the desktop invokes or ports them behind one
typed interface rather than maintaining divergent rules. “Export diagnostics”
creates a redacted archive of versions, manifest, schema, logs, interfaces,
service status and non-secret config.

## Startup state machine

```text
APP_LAUNCH → CHECK_RUNTIME → START_SERVICES → WAIT_DB → WAIT_API
→ CHECK_SCHEMA → START_FRONTEND → DISCOVER_LAN → READY
```

`DEGRADED` (optional Studio/ESP32/Cloud), `RECOVERING`, `ERROR` and
`SHUTTING_DOWN` are explicit states. Each has a human message, bounded retry,
“view logs” action and safe next step; there is no indefinite spinner.

Closing a window does not stop services. Quit warns if any heat is running;
only an explicit “Stop Field services” performs graceful shutdown. A crash or
reboot restarts services and rehydrates DB-authoritative state; it never resets
competition data.

## Backup, restore and Cloud sync

Expose **Backup Now**, verified checksum/history, export-to-external-media,
restore preview and explicit restore confirmation. Recommended snapshots:
before event preparation, before schema migration and after a heat close; do
not create unbounded automatic copies without retention policy.

Expose two explicit one-way actions: **Prepare event from Cloud** (before an
event) and **Publish results to Cloud** (after an event). No continuous
bidirectional sync. During competition, Field DB is authoritative.

## Updates and identity

Updates are signed, versioned and staged. Apply only when no heat is running,
after backup and compatibility checks. Keep a rollback bundle and schema
compatibility matrix. Diagnostics expose desktop version, frontend release,
source revision, expected schema and actual schema. A release is not “ready”
until the served manifest and bundle match the intended artifact.

## Signing, security and support

macOS distribution requires Developer ID signing, notarization and signed DMG;
Windows requires Authenticode signing and SmartScreen reputation management.
CI must protect signing credentials. Never bundle Cloud service-role keys.
Shell execution is allowlisted and logged; local API exposure is limited to
the LAN contract, with 5432 localhost-only. Updates are signature-verified.
Logs are centralized with timestamps and rotation for launcher, services,
database startup, Realtime, sync, backup and updates; secrets are redacted.

## CI/CD and release independence

Separate pipelines are required:

1. CI: frontend tests/typecheck/build and DB regression tests.
2. Field release: immutable frontend/backend artifact and explicit promotion.
3. Desktop macOS: signed/notarized DMG.
4. Desktop Windows: signed EXE/MSI.
5. Cloud: explicit promotion, never an automatic side effect of Field/Desktop.

Main-source commits must not implicitly deploy Cloud or Field. Release IDs,
artifacts and promotion approvals identify each target independently.

## Migration roadmap

- **P3A:** Electron shell wrapping the existing certified Mac launcher and
  immutable Field dist; diagnostics, LAN URLs and backup visibility.
- **P3B:** typed cross-platform service manager, data-directory ownership,
  crash recovery and removal of terminal-only steps.
- **P3C:** Windows runtime adapter (Docker Desktop/WSL2 candidate), network and
  path abstractions, parity test battery.
- **P3D:** signing/notarization, updater, repair/uninstall UX and support
  package hardening; reassess Tauri after measurements.

## ADRs

### ADR-01 — Desktop framework
**Context:** orchestration and diagnostics matter more than a thin window.
**Decision:** Electron for P3A. **Risks:** size/Node attack surface.
**Reversible:** yes; service-manager APIs remain framework-neutral.

### ADR-02 — Backend packaging
**Context:** certified backend is self-hosted Supabase Compose.
**Decision:** orchestrate existing stack first. **Risk:** runtime prerequisite.
**Reversible:** yes; manager boundary permits later managed runtime.

### ADR-03 — Local DB persistence
**Context:** Field DB is source of truth.
**Decision:** persistent platform data directory and explicit backups.
**Risk:** migration support burden. **Reversible:** data export remains portable.

### ADR-04 — Service lifecycle
**Context:** restart must preserve committed state.
**Decision:** bounded state machine, no destructive quit, warn on running heat.
**Risk:** stale services; diagnostics/retry address it.

### ADR-05 — LAN addressing
**Context:** IP changes are normal.
**Decision:** probe manifest on discovered interfaces; QR/copy links.
**Risk:** VPN ambiguity; show candidates and selected proof.

### ADR-06 — Cloud/Field separation
**Context:** accidental cross-environment writes are dangerous.
**Decision:** explicit visual modes and one-way sync actions.
**Risk:** operator must choose deliberately.

### ADR-07 — Update strategy
**Context:** no updates during a heat.
**Decision:** signed staged updates after backup and no-running-heat gate.
**Risk:** delayed adoption; safe rollback is preferred.

### ADR-08 — Signing/distribution
**Context:** professional installers need trust signals.
**Decision:** Developer ID/notarized DMG and Authenticode EXE/MSI in CI.
**Risk:** certificate/CI operations; do not store keys in repository.

## Target architecture

```text
Desktop Shell (Electron)
├── Field Service Manager (Docker/Colima adapter)
│   ├── PostgreSQL + persistent data
│   ├── PostgREST / RPC / RLS
│   ├── Realtime (surfjudging_realtime)
│   ├── Auth + Kong + Storage
│   └── immutable nginx Field frontend
├── Startup/health/schema/manifest diagnostics
├── LAN discovery + QR URL manager
├── Backup/restore/export manager
├── Explicit Cloud↔Field preparation/publish actions
└── signed update/rollback manager
             │ LAN
        Judge tablets / Admin / Display
             │ explicit remote Cloud mode
        Cloud frontend + remote Supabase
```

## P3.1 authorization and final verdict

**P3.1 IMPLEMENTATION AUTHORIZED: NO** for this architecture phase.

The smallest future prototype, after explicit authorization, is a read-only
Electron P3A shell that invokes no installer and no migration: discover the
Field manifest, display health and generate tablet URLs while leaving the
existing launcher and services authoritative.

**FINAL VERDICT: P3.0 DESIGN COMPLETE — P3.1 PROTOTYPE PENDING EXPLICIT AUTHORIZATION.**
