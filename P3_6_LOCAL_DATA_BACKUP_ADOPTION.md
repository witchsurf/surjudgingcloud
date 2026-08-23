# P3.6 — Local Field Data Root, Verified Backup & Safe Adoption

CURRENT FIELD:
OWNERSHIP = LEGACY_CERTIFIED_RUNTIME
DATA VOLUME = infra_postgres-data (local Docker volume)
POSTGRES VERSION = 15.1
DB SIZE = 20 MB
SCHEMA = 20260814220000_fix_exhaustive_ranking_lineage_division
RUNNING HEAT = 0 (fresh DB gate)

DATA ROOT:
PATH = `~/Library/Application Support/SurfJudging/`
CREATED = YES; PERMISSIONS = user-scoped directories (0700), metadata (0600)
Subdirectories: data/postgres, backups, logs, config, runtime, images, diagnostics.

BACKUP:
METHOD = allowlisted `docker exec surfjudging_postgres pg_dump --exclude-schema=_realtime -Fc`
FILE = `surfjudging-field-20260815-201650-20260814220000_fix_exhaustive_ranking_lineage_division.dump`
SIZE = 949241 bytes
SHA256 = `4e7d187f4d2c1e2bc66995b9c663ff8bf9f84f5f1143fe0d0ba6d87971a88080`
PG_RESTORE_LIST = PASS (959 archive entries)
METADATA = sidecar contract implemented; backup marked protected/pre-adoption
VERIFIED = YES | PROTECTED = YES
LIVE DB BEFORE/AFTER MATCH = YES (events 5, heats 29, scores 206, interferences 6, assignments 78, pointers 2)

RESTORE VALIDATION = DEFERRED
RESULT = archive readability certified; no isolated restore target created in P3.6

ADOPTION:
REQUIRED = YES
METHOD = DEFERRED; prefer validated logical dump/restore into a new managed target
AUTHORIZED = NO | EXECUTED = NO
SOURCE DATA = infra_postgres-data (untouched)
TARGET DATA = none
TARGET VALIDATION = not applicable
SWITCHOVER = none
ROLLBACK = legacy volume remains intact and authoritative
OLD DATA PRESERVED = YES

CONTROL CENTER = PASS (typed backup IPC now invokes the allowlisted service; protected metadata is surfaced)
SECURITY = PASS (fixed container/arguments, no renderer shell/path/secret input; partial files removed on failure)

TESTS:
P3.1 = PASS | P3.2 = PASS | P3.3 = PASS | P3.4 = PASS | P3.5 = PASS | P3.6 = 23 tests PASS

CLOUD MODIFIED = NO
SPORTING DATA MODIFIED = NO
PRODUCTION DMG = NO
P3.6 PASS = YES (backup certified; adoption deliberately deferred)

Next gate: P3.7 may define clean-machine first-run and offline runtime/image bundle. Not implemented here.
