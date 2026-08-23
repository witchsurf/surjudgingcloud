# P3.5 — Owned Runtime & Bootstrap Prototype

DESKTOP VERSION = 0.3.0-p3.3 (prototype; P3.5 model targets 0.3.0-p3.5)

CURRENT FIELD:
PLATFORM = macOS host / linux containers; ARCH = amd64 images
DOCKER CONTEXT = colima
OWNERSHIP = LEGACY_CERTIFIED_RUNTIME (Compose project `infra`, network `infra_surfjudging_network`)
RELEASE = surfjudging-2026.08.14-p2.7.78-lineage-fix
REVISION = 17ed8b0799a9a0298b7d6b7812f57403432b093d
SCHEMA = 20260814220000_fix_exhaustive_ranking_lineage_division
DATA LOCATION = Docker volume `infra_postgres-data` (read-only observed)

IMAGE INVENTORY = `surfjudging-field:...p2.5.7` (local sha256:92d614…; linux/amd64),
Postgres 15.1.0.147, GoTrue v2.132.3, Realtime v2.25.50,
PostgREST v11.2.0, Kong 2.8.1, Storage v0.40.4; Meta/Studio are auxiliary.
Realtime tenant observed = `surfjudging_realtime`.

RUNTIME MANIFEST = PASS (example schema in `desktop/runtime/`; no secrets)
INTEGRITY = PASS (stable SHA-256 implemented and tested)
PRODUCTION SIGNATURE = NOT IMPLEMENTED (design boundary only)
MIGRATION DIGEST = deterministic helper implemented; production set not adopted
RUNTIME DEFINITION DIGEST = deterministic manifest field/helper implemented
COMPATIBILITY = LEGACY_CERTIFIED; engine returns exact INCOMPATIBLE reasons on drift
LEGACY CERTIFIED = YES; OWNED MANAGED = not claimed for current containers

BOOTSTRAP DRY RUN = PASS: platform → arch → runtime → manifest → images → existing Field → compatibility;
stops at `EXISTING_FIELD_FOUND` and never installs/adopts automatically.
FUTURE DATA ROOT = `~/Library/Application Support/SurfJudging/`
EXISTING FIELD = FOUND; ADOPTION REQUIRED = YES (future P3.6 decision)

OWNED FILTER = PASS: only explicit future `com.surfjudging.runtime=true` + service labels are owned;
legacy detection is separate. Mixed `supabase_*` development containers are not owned.
REPAIR PLAN = DRY RUN ONLY; no delete/recreate/pull/command execution.

TESTS: P3.1 = PASS; P3.2 = PASS; P3.3 = PASS; P3.4 = PASS; P3.5 = 20 tests PASS.
DB BEFORE/AFTER MATCH = YES (read-only inventory)
CLOUD MODIFIED = NO | FIELD MODIFIED = NO | RUNTIME INSTALLED = NO | IMAGES PULLED = NO
PRODUCTION DMG = NO

P3.5 PASS = YES

Next gate: P3.6 may define local data root, verified backup and safe adoption. Not implemented here.
