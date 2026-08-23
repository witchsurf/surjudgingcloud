# P3.7 — Clean-Mac First-Run & Offline Runtime Bundle

P3.7A = IMPLEMENTED / TESTED
P3.7B = NOT RUN (this developer Mac is not a clean environment)

TARGET:
MACOS = supported transition target; ARCH = current observed containers linux/amd64 (Apple Silicon host requires compatible emulation or native bundle proof)
VIRTUALIZATION = required; current transition runtime is Colima/Docker
CLEAN ENVIRONMENT = NOT AVAILABLE / NOT CLAIMED

RUNTIME:
TRANSITION OR FINAL = TRANSITION PROTOTYPE (Colima/Docker); FINAL PRODUCT RUNTIME = NOT CLAIMED
IMPLEMENTATION = deterministic offline bundle manifest, payload SHA-256 verification, first-run gate
OWNERSHIP = future `com.surfjudging.runtime=true` labels
ISOLATION = explicit future project/network/volume namespaces; no live labels or runtime changes

BUNDLE:
VERSION = 0.1.0 prototype
FRONTEND = bound release/source revision fields
IMAGES = required Field services only: frontend, Postgres, PostgREST, Realtime, Auth, Kong, Storage
RUNTIME DEFINITION = digest-bound field
MIGRATION DIGEST = digest-bound field
TOTAL SIZE = not produced (image archives intentionally not generated/committed)
SHA256 = deterministic top-level and payload digest implementation
INTEGRITY = PASS (corruption/missing-payload tests)

SERVICES INCLUDED = frontend, postgres, rest, realtime, auth, kong, storage
SERVICES EXCLUDED = Studio, Meta, Analytics, Vector, Edge Runtime, Mailpit

FIRST RUN:
INTERNET = OFFLINE gate implemented; no live clean-machine proof
PUBLIC REQUESTS = not observed in isolated test
RUNTIME PREP / IMAGE IMPORT / DB INIT / MIGRATIONS / STARTUP = prototype gates only
SCHEMA / LAN / READY = deterministic state-machine gates only
TOTAL TIME = not measured (no isolated clean target)

HEALTH: FRONTEND/API/POSTGRES/REALTIME/AUTH/STORAGE = not claimed for P3.7 isolated target
ROUTES: ADMIN/JUDGE/PRIORITY/DISPLAY/OVERLAY = not run in clean target
OFFLINE UI = NOT RUN
REALTIME = NOT RUN (would require isolated DB fixture)
SPORTING SMOKE = NOT RUN
RESTART PERSISTENCE = NOT RUN
OWNED REPAIR = NOT RUN

LEGACY FIELD:
UNCHANGED = YES | CERTIFIED STATE PRESERVED = YES | P3.6 BACKUP PRESERVED = YES
TESTS = P3.1 PASS; P3.2 PASS; P3.3 PASS; P3.4 PASS; P3.5 PASS; P3.7A 28 tests PASS
CLOUD MODIFIED = NO | PRODUCTION DMG = NO

P3.7A BUNDLE/BOOTSTRAP = PASS
P3.7B CLEAN-MACHINE = NOT RUN
P3.7 FULL PASS = NO

Next gate: obtain a clean supported macOS VM or isolated Mac, transfer the offline bundle, block public Internet, and execute P3.7B. Do not proceed to DMG production.

## P3.7B — Clean Environment Assessment

ENVIRONMENT:
TYPE = developer Mac; not a clean target
MAC MODEL/VM = model not exposed by sandbox; no macOS VM provider available
MACOS = 26.6
ARCH = x86_64 (Intel)
RAM = 64 GB | FREE DISK = approximately 785 GB
VIRTUALIZATION = Docker/Colima tooling exists, but Colima is not running; no `tart` or `multipass` detected
CLEAN BASELINE PROVEN = NO

DECISION = B — SEPARATE PHYSICAL MAC REQUIRED (or a separately provisioned macOS VM).
The current host contains the repository, Docker state and protected legacy Field;
an isolated Docker project on this host would not satisfy the clean-machine contract.

PAYLOAD / FIRST RUN / OFFLINE / HEALTH / ROUTES / SPORTING SMOKE / REALTIME /
RESTART PERSISTENCE / CLEAN-TARGET BACKUP = NOT RUN because no qualifying clean target exists.
No image archives were generated and no production installer was created.

NATIVE ARM64 CERTIFIED = NO
AMD64 CERTIFIED = NO (the existing Field images are linux/amd64, but clean-target execution was not performed)
P3.7A = PASS | P3.7B = NOT RUN | P3.7 FULL PASS = NO

Minimum next environment: separate Intel Mac or isolated macOS VM with no repository,
Node/npm, SurfJudging images, DB, or runtime state; transfer the complete offline payload,
then block public Internet while retaining local/LAN connectivity.
