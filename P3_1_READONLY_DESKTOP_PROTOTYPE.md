# P3.1 — Read-only Desktop Field Control Center Prototype

## Scope and safety

Implemented an isolated `desktop/` Electron prototype. It observes the
existing Field runtime only. No START, CLOSE, SAVE, score, assignment, pointer,
migration, backup restore, Cloud sync, deployment, Docker restart or Compose
change was performed.

## Result

```text
FRAMEWORK = Electron
DESKTOP VERSION = 0.1.0-p3.1
CONTEXT ISOLATION = true
NODE INTEGRATION = false
IPC ALLOWLIST = read-only discovery, probes, health, URLs, diagnostics copy
```

The preload exposes typed methods only; there is no generic command execution,
filesystem bridge, shell bridge or environment-variable exposure to the
renderer. `openUrl` accepts HTTP(S) URLs only.

## Discovery and Field identity

Network discovery uses local IPv4 interfaces, rejects loopback/link-local and
Docker/Colima/bridge interfaces where identifiable, and probes
`http://IP:8080/deployment-manifest.json`. A candidate is valid only when the
manifest says `deploymentMode=field` and contains release, revision and schema.
Multiple valid candidates are not guessed.

```text
INTERFACES = local IPv4 interfaces (dynamic; no hard-coded Field IP)
CANDIDATES = 10.0.0.10
SELECTED FIELD = 10.0.0.10 (single valid manifest candidate)
SELECTION PROOF = manifest HTTP 200, deploymentMode=field
HOST = 10.0.0.10
RELEASE = surfjudging-2026.08.14-p2.7.78-lineage-fix
REVISION = 17ed8b0799a9a0298b7d6b7812f57403432b093d
SCHEMA = 20260814220000_fix_exhaustive_ranking_lineage_division
```

## Health and prerequisites

```text
FRONTEND = HEALTHY
MANIFEST = HEALTHY
API = HEALTHY
REALTIME = UNKNOWN (not faked green by this read-only prototype)
INTERNET = UNKNOWN
CLOUD = UNKNOWN (informational only)
DOCKER CLI = FOUND
COLIMA = FOUND
DOCKER DAEMON = REACHABLE (observed only; not started)
```

## URLs

```text
ADMIN = http://10.0.0.10:8080/admin
JUDGE = http://10.0.0.10:8080/judge
PRIORITY = http://10.0.0.10:8080/priority
DISPLAY = http://10.0.0.10:8080/display
OVERLAY = http://10.0.0.10:8080/overlay
```

## Tests

- **UNIT = PASS** — five Node tests: interface filtering, manifest validation,
  ambiguity handling, URL generation and health status mapping.
- **LIVE MAC = PASS** — Electron launched with the existing Field host. CDP
  inspection showed `FIELD FOUND`, the certified release/revision/schema,
  healthy frontend/API, discovered prerequisites and all tablet URLs.
- **DESKTOP CLOSE = PASS** — Electron was closed with SIGINT; no Field service
  was stopped. Post-close Field checks remained unchanged.
- **INTERNET-OFF = NOT RUN** — no host networking was altered; the prototype
  reports Internet/Cloud as `UNKNOWN` rather than fabricating a result.

## DB/source safety proof

Before/after read-only Field checks matched the certified baseline:

```text
PODIUM A = mamelles_open_cadet_r1_h1
PODIUM B = mamelles_open_cadet_r2_h2
SCORES = 206
INTERFERENCES = 6
HEAT STATUSES = unchanged
```

```text
DB BEFORE/AFTER MATCH = YES
FIELD CONTINUED AFTER DESKTOP CLOSE = YES
CLOUD MODIFIED = NO
FIELD MODIFIED = NO
PRODUCTION DMG CREATED = NO
WINDOWS CLAIMED = NO
```

## Files

The prototype is isolated under `desktop/`: Electron main/preload, renderer,
shared pure discovery helpers, tests and a narrow generated-output ignore file.
No existing `frontend/`, `infra/`, `scripts/`, Compose or Supabase file was
modified.

## Next gate

```text
P3.1 PASS = YES (read-only prototype scope)
P3.2 = NOT IMPLEMENTED
```

P3.2 may be proposed next for an explicit, separately authorized controlled
Field lifecycle manager (`CHECK_RUNTIME`, `START_FIELD`, `WAIT_HEALTH`,
`READY`, `STOP_FIELD`). It must add no mutation path until its safety contract
and running-heat gate are approved.
