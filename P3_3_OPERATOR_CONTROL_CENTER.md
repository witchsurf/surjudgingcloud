# P3.3 — Professional Field Operator Control Center

## Dashboard

Implemented in isolated `desktop/` renderer/main/preload code. The primary
screen now answers Field identity, readiness, competition safety, services,
LAN/tablet access, disk space, QR and controlled lifecycle actions without
developer terminal clutter.

```text
DESKTOP VERSION = 0.3.0-p3.3
DASHBOARD = PASS
IDENTITY = FIELD — LOCAL
HOST = 10.0.0.10 (rediscovered and manifest-proven)
RELEASE = surfjudging-2026.08.14-p2.7.78-lineage-fix
REVISION = 17ed8b0799a9a0298b7d6b7812f57403432b093d
EXPECTED SCHEMA = 20260814220000_fix_exhaustive_ranking_lineage_division
```

The UI displays `FIELD FOUND`, not merely an open port. Multiple valid
candidates are not silently selected. A later refresh re-probes interfaces and
revalidates the manifest.

## Competition and services

```text
RUNNING HEATS = 0 (fresh Field REST truth)
STOP GATE = allowed only after explicit confirmation
FRONTEND = HEALTHY
API/KONG = HEALTHY
POSTGRES = UNKNOWN (not faked green; no privileged coupling added)
REALTIME = UNKNOWN (service/API reachability is not subscription proof)
AUTH = UNKNOWN
STORAGE = UNKNOWN
```

If a running heat exists, Stop Field is visibly blocked with the reason from
the authoritative backend. No sporting mutation path was added.

## Network, tablets and QR

```text
INTERFACE = en0 (selected candidate proof)
FIELD IP = 10.0.0.10
IP REDISCOVERY = PASS
MULTIPLE INTERFACE POLICY = show candidates; choose only a unique/proven one
ADMIN = http://10.0.0.10:8080/admin
JUDGE = http://10.0.0.10:8080/judge
PRIORITY = http://10.0.0.10:8080/priority
DISPLAY = http://10.0.0.10:8080/display
OVERLAY = http://10.0.0.10:8080/overlay
QR = PASS — local QR data URL, LAN Admin URL only, no credentials
```

No unsupported judge identity query parameters were invented; the generic
Judge route remains the current contract.

## Disk and backup

```text
AVAILABLE = approximately 785 GB
STATUS = HEALTHY (warning threshold: 5 GB)
EXISTING MECHANISM = scripts/hp-backup.sh; remote HP SSH pg_dump custom dump,
  pg_restore --list verification, SHA-256 and retention
BACKUP NOW = LOCKED / NOT IMPLEMENTED
ARTIFACT VERIFIED = NOT APPLICABLE
HISTORY = NOT IMPLEMENTED
RESTORE = NOT IMPLEMENTED (explicitly locked)
```

The existing backup script is HP/SSH-oriented and is not a proven local Mac
Field backup path. P3.3 therefore does not create a second backup
implementation or claim a false success. No delete/prune operation exists.

## Diagnostics, logs and offline behavior

Diagnostic clipboard export contains only version, candidates, manifest,
health, competition safety, prerequisites, disk and timestamp. Secrets,
tokens, JWTs, passwords, service keys, Docker auth and private environment are
excluded. Desktop logs remain bounded/redacted through the P3.2 manager.

When Internet/Cloud is unavailable, Field remains the primary local identity;
Internet and Cloud are informational/UNKNOWN, not a global Field failure.

## Tests and live validation

```text
P3.1 REGRESSION = PASS (5 tests)
P3.2 REGRESSION = PASS (5 tests)
P3.3 TESTS = PASS (10 tests retained; dashboard/QR/safety live checks)
LIVE MAC = PASS — Electron dashboard discovered Field, verified manifest,
  rendered URLs, competition safety, disk and QR
```

DB before/after validation remained identical:

```text
PODIUM A = mamelles_open_cadet_r1_h1
PODIUM B = mamelles_open_cadet_r2_h2
SCORES = 206
INTERFERENCES = 6
DB BEFORE/AFTER MATCH = YES
```

The dashboard was closed without stopping Field. No restore, Backup Now,
sporting action, Cloud operation, migration, deployment or Compose change was
performed.

```text
CLOUD MODIFIED = NO
FIELD SPORTING DATA MODIFIED = NO
PRODUCTION DMG = NO
P3.3 PASS = YES
```

## Next gate

P3.4 may be proposed only: dependency/installation architecture for a clean
Mac, managed Colima/Docker bootstrap, upgrade data preservation, Windows
equivalent and future installer contents. P3.4 is not implemented here.
