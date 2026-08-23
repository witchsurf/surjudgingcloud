# P3.4 — Clean-machine Installation & Runtime Architecture

**Nature:** architecture + non-destructive compatibility spike only. No
runtime install, image pull, Docker configuration, database mutation, migration,
installer, Cloud or Field deployment was performed.

## Current dependencies

| Dependency | Current constraint/use | Final status |
|---|---|---|
| Electron/Node | desktop shell; bundled Electron runtime | required in app |
| Colima + Lima | current certified Mac Docker VM | P3 transition; not final assumption |
| Docker CLI/daemon | Compose lifecycle | runtime capability, managed boundary |
| PostgreSQL `supabase/postgres:15.1.0.147` | authoritative Field DB | required |
| Realtime `supabase/realtime:v2.25.50` | live updates, tenant `surfjudging_realtime` | required |
| PostgREST `v11.2.0` | REST/RPC/RLS | required |
| GoTrue `v2.132.3` | local auth/JWT | required until proven reducible |
| Kong `2.8.1` | API gateway/CORS | required for current tablet contract |
| Storage `v0.40.4` | Supabase storage | required if current features use it |
| Studio/Meta | administration/introspection | optional in competition runtime |
| Analytics/Vector/Edge/Mailpit | not in the certified local Compose | development/unknown; not package assumptions |
| bash/curl | current launcher probes | implementation detail to abstract |
| ssh/git/Homebrew | HP/dev workflows | not final runtime prerequisites |

Images are pinned tags today, not digests. Exact compressed sizes and
multi-architecture manifests must be measured in a later image audit; no
unverified size or universal architecture claim is made here.

## Clean-machine matrix

- **MAC-A:** lacks Docker/Colima, images, repo, Node and shell tooling. Current
  launcher cannot reach READY. Final installer must carry or provision a
  managed runtime and offline image set.
- **MAC-B:** Docker Desktop can supply a daemon, but context/ownership/licensing
  and resource policies must be checked; it is supported as a transition, not
  silently required.
- **MAC-C:** closest to today’s certified path; Desktop can observe/use the
  existing daemon after validating context and owned containers.

## Architecture options and decisions

| Option | Assessment |
|---|---|
| A — operator Colima + CLI | simplest engineering, poor clean-machine UX |
| B — Desktop installs/configures runtime | better UX, needs UAC/admin, signing and rollback |
| C — bundled runtime/images | best offline story, large installer and support/licensing burden |
| D — native services | highest correctness/RLS/Realtime migration risk |
| E — hybrid | recommended incremental path |

**DOCKER DESKTOP = supported but optional during transition; not mandatory and
not silently installed.**

**COLIMA = P3 transition mechanism, not final product contract.** It remains a
useful Mac developer/certification runtime; final Desktop should own or wrap an
isolated runtime rather than rely on Homebrew. Apple Silicon and Intel both
remain candidates, subject to image-manifest certification.

**MAC FINAL RUNTIME = managed isolated container runtime (hybrid rollout).**
**WINDOWS FINAL RUNTIME = managed Docker/WSL2 candidate; Windows is not yet
certified.**

## CPU and Windows gap

Target `darwin/arm64`, `darwin/x64`, `win32/x64`; arm64 Windows is deferred.
Every image must prove a compatible `linux/amd64` or `linux/arm64` manifest.
Windows requires WSL2/virtualization or an equivalent managed runtime, UAC,
firewall onboarding, NTFS data paths and service startup adapters. Bash, SSH,
`ifconfig`/`route`, POSIX permissions and rsync must be replaced by typed
platform APIs. Windows support is **not claimed**.

## Runtime ownership and data

Final Desktop must use a SurfJudging-owned project namespace and labels, never
stop unlabeled containers, and never touch unrelated Docker projects. P3.2’s
current names are `surfjudging`, `surfjudging_postgres`, `surfjudging_auth`,
`surfjudging_realtime`, `surfjudging_storage`, `surfjudging_rest`, and
`surfjudging_kong`; future Compose must add a project label before automated
ownership is trusted.

Canonical data roots:

```text
macOS:  ~/Library/Application Support/SurfJudging/
Windows: %APPDATA%\\SurfJudging\\
  postgres/ backups/ logs/ config/ runtime/ images/ diagnostics/
```

Data is outside the app bundle, survives upgrades/runtime recreation and is
preserved on uninstall by default.

## Initialization and adoption

```text
FIRST_LAUNCH → PLATFORM → VIRTUALIZATION → RUNTIME → DATA_ROOT → IMAGES
→ DB_INIT/ADOPT → SCHEMA_VERIFY → SERVICES → IDENTITY → LAN → READY
```

Fresh initialization applies a deterministic baseline and migrations without
competition seeding. Existing Field data is detected, backed up first, adopted
and schema-verified; it is never overwritten by a fresh volume.

## Upgrade and backup design

```text
SAFE_WINDOW (no running heat) → verified local backup → stop Field
→ stage runtime/app → start DB → migrate/verify schema → start services
→ verify manifest/API/Realtime/LAN → READY
```

Rollback preserves DB data and restores the prior application/runtime bundle.
The canonical future local backup is `pg_dump --format=custom --compress`,
timestamped with metadata and SHA-256, verified by `pg_restore --list`, with
bounded retention and external export. `scripts/hp-backup.sh` is remote HP/SSH
only and is not a local Desktop backup implementation.

## Privileges, ports and firewall

Normal operation should be unprivileged. One-time runtime installation,
virtualization and firewall rules may require macOS authorization or Windows
UAC; Desktop must not run permanently as root/admin. Never use broad sudo.

Frontend `8080` and API/Kong `8000` are LAN-facing; PostgreSQL `5432` is
localhost-only in the final product. Internal Supabase services remain on the
private container network. Firewall onboarding should allow only the selected
LAN interface and required ports.

## Release manifest V2

Future release identity must bind:

```text
desktopVersion
frontendRelease + sourceRevision
runtime/Compose version
image digests
expectedSchema + migration set
```

READY is forbidden for any incompatible combination. This prevents the P2
failure class of correct source with stale bundle/runtime.

## Installer contents

**Online installer:** small signed shell + runtime bootstrap, downloads pinned
images and verifies hashes. **Full offline installer:** signed shell, runtime
adapter, all required image archives, immutable frontend release and migration
manifest; user data is generated outside the bundle. Exact size is deferred
until image architecture/size audit.

macOS requires Developer ID/hardened runtime/notarization and quarantine-aware
runtime extraction. Windows requires Authenticode, SmartScreen handling, UAC,
firewall and WSL/runtime bootstrap. No signing or installer implementation is
authorized yet.

## Service reduction

Postgres, PostgREST, Realtime, Auth and Kong are **required current Field**.
Storage is required until feature usage is proven otherwise. Studio/Meta are
optional operator tooling. Analytics, Vector, Edge runtime and Mailpit are not
required by the current local Compose and remain development/unknown. Any
reduction requires the existing DB/RPC/RLS/Realtime regression battery.

## Repair and uninstall

Repair may verify image hashes, recreate owned containers/network and restart
services without touching DB volumes. It must not prune unrelated resources.
Uninstall removes app/runtime components but preserves DB/backups; deleting
Field data is a separate, strongly confirmed action and is not implemented.

## Prototype spike and tests

Added `desktop/src/shared/compatibility.js` and four permanent tests for
platform/architecture classification, runtime status, container ownership and
release manifest completeness. The detector is read-only: it does not install,
pull, delete or reconfigure anything. The existing 10 P3.1/P3.2 tests remain
passing.

## Roadmap

1. **P3.5:** owned runtime/bootstrap prototype with signed image manifest.
2. **P3.6:** local backup/data-root implementation and adoption tests.
3. **P3.7:** clean Mac first-run and offline image bundle.
4. **P3.8:** macOS signing/notarization and repair/uninstall validation.
5. **P3.9:** Windows WSL2/runtime adapter and parity battery.

## Final decision

```text
MAC FINAL RUNTIME = managed isolated runtime, hybrid rollout
WINDOWS FINAL RUNTIME = managed Docker/WSL2 candidate, not certified
DOCKER DESKTOP = supported but optional transition
COLIMA = transition/development only
OFFLINE FIRST INSTALL = NO today; full offline image bundle required
FIELD DATA ROOT = platform Application Support/AppData root
LOCAL BACKUP = verified custom-format pg_dump + checksum/retention
CONTAINER STRATEGY = pinned, owned, labelled Compose-compatible runtime
SERVICE REDUCTION = Studio/Meta optional; core Supabase retained
P3.4 PASS = YES
P3.5 IMPLEMENTATION AUTHORIZED = NO
```

**P3.4 FINAL VERDICT: ARCHITECTURE AND READ-ONLY COMPATIBILITY SPIKE COMPLETE.**
