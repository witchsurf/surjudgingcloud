# P3.2 — Controlled Field Lifecycle Manager

## Scope

P3.2 adds an isolated, typed infrastructure manager to `desktop/`. It calls
only the existing certified `scripts/start-surfjudging-field-mac.sh` with the
fixed `--no-caffeinate` argument and stops only the allowlisted Field service
containers. No sporting API, SQL, migration, Cloud sync or deployment path is
available through IPC.

```text
DESKTOP VERSION = 0.2.0-p3.2
STATE MACHINE = STOPPED → CHECKING_RUNTIME → STARTING → WAITING_DB
  → VERIFYING_IDENTITY → READY; READY → STOP_CHECK → STOPPING → STOPPED
ERROR/RUNTIME_UNAVAILABLE are bounded terminal states with logs/retry.
```

## Start and identity

```text
CURRENT STATE = READY (Field already healthy)
START RESULT = ALREADY_RUNNING
IDEMPOTENT = PASS (concurrent start requests share one operation)
DUPLICATE PROCESS = NONE
```

The live bridge test returned `ALREADY_RUNNING` with no launcher invocation.
Startup only reaches READY after a valid Field manifest, API health and one
verified LAN candidate. A port-open response without identity is insufficient.

```text
HOST = 10.0.0.10
RELEASE = surfjudging-2026.08.14-p2.7.78-lineage-fix
REVISION = 17ed8b0799a9a0298b7d6b7812f57403432b093d
SCHEMA = 20260814220000_fix_exhaustive_ranking_lineage_division
MATCH = YES
```

## Stop safety and live restart

Fresh REST truth reported zero `running` heats before the cycle. The manager
returned `allowed=true`; no renderer cache was used. Explicit confirmation was
then supplied through the typed bridge.

```text
ANY RUNNING HEAT = NO
DB SOURCE = Field REST / authoritative heats table
STOP ALLOWED = YES
CONFIRMATION = YES
STOP RESULT = STOPPED
STOP SCOPE = surfjudging, postgres, auth, realtime, storage, rest, kong
VOLUMES = PRESERVED; no `down -v`, prune or data deletion
```

The first implementation run exposed and fixed only a prototype path error
(launcher root resolution); the certified launcher then ran successfully. The
final controlled cycle completed:

```text
LIVE RESTART = PASS
STOP TIME = completed; frontend unavailable during stop
START TIME = launcher completed and identity became READY
DB BEFORE/AFTER MATCH = YES
FIELD READY AFTER = YES
CLIENT RECOVERY = YES — existing Admin/Judge/Display tabs hydrated again
```

Post-cycle proof: pointers A=`mamelles_open_cadet_r1_h1`,
B=`mamelles_open_cadet_r2_h2`; scores `206`; interferences `6`; manifest,
release and schema unchanged. No heat status changed.

Window close and Electron quit do not invoke `stopField`; the Field remains
running for tablets. Explicit Stop Field is the only shutdown path.

## Failure handling and tests

The manager has bounded startup/stop timeouts, recent redacted log buffering
(maximum 200 lines), runtime-unavailable and identity/health timeout states,
and one singleton health poller while READY. The permanent suite covers:

```text
P3.1 REGRESSION = PASS (5 tests)
P3.2 UNIT = PASS (5 tests; total 10)
```

Covered tests include already-running detection, start idempotency, safe stop
confirmation, running-heat stop denial and bounded log behavior. Failure
fixtures are represented by injected manager doubles; no live sabotage was
performed. Port conflict, malformed manifest and API timeout resolve through
the same identity/health timeout path and remain retryable.

## Security

```text
CONTEXT ISOLATION = true
NODE INTEGRATION = false
GENERIC SHELL IPC = NO
ALLOWLIST = fixed launcher path/argument; fixed Docker executable + fixed
  service names; typed probes only
```

The renderer cannot select executable paths or arguments. No arbitrary SQL,
Compose mutation, migration, Cloud credential, service-role key or secret is
exposed.

```text
CLOUD MODIFIED = NO
FIELD SPORTING DATA MODIFIED = NO
PRODUCTION DMG = NO
```

## Verdict

```text
P3.2 PASS = YES
P3.3 = NOT IMPLEMENTED
P3.2 FINAL VERDICT = CONTROLLED FIELD LIFECYCLE CERTIFIED
```

Next candidate only: P3.3 operator control center (QR, richer diagnostics,
backup visibility and recovery UX). No P3.3 implementation was started.
