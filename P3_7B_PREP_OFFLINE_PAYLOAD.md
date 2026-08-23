# P3.7B-PREP — Offline Certification Payload

P3.7B PREP-R3 = PASS (Engine API payload completed)

## P3.7B-PREP-R2 — Colima Export Forensics

EXPORT FORENSICS:
DOCKER CLIENT = 29.7.1 | DOCKER SERVER = 29.5.2
COLIMA = 0.10.3, macOS Virtualization.Framework, x86_64, Docker runtime
RUNTIME = Docker via Colima | STORAGE DRIVER = overlayfs
IMAGE STORE = Docker Engine/containerd-backed store at `/var/lib/docker`
CONTAINERD ACCESS = socket reported by Colima, not used directly
NERDCTL = unavailable | CTR = unavailable | BUILDX = unavailable

POSTGRES IMAGE:
ID = sha256:5a8cb2e4acf7845a50e557bff8dcfb3e3c73b410e66c3cd011105fc09d8ff13b
DIGEST = supabase/postgres@sha256:5a8cb2e4acf7845a50e557bff8dcfb3e3c73b410e66c3cd011105fc09d8ff13b
ARCH = amd64/linux | LAYERS = 24 | VIRTUAL SIZE = 409219973 bytes

CONTROL EXPORT:
WITH `--platform linux/amd64` = HUNG/FAIL (zero-byte partial, no exit/stderr)
WITHOUT `--platform` = HUNG/FAIL (partial reached 373710848 bytes, then stopped with no exit)
SMALL FRONTEND CONTROL = HUNG/FAIL (zero-byte output after 15 seconds)
CONCLUSION = failure is not Postgres-only and not caused solely by `--platform`; current Docker save hangs for large and small local images.

ALTERNATIVE METHODS AVAILABLE = none (nerdctl/ctr/buildx absent; Engine API export not attempted)
CANONICAL P3.7B EXPORT METHOD = not established
POSTGRES ARCHIVE = incomplete; archive format/identity/SHA256 not validated
IMAGE PULLS = 0

PAYLOAD PATH = none (incomplete temporary exports were removed)
ARCH = amd64/linux images
IMAGE COUNT = 7 identities verified locally; 0 complete archives retained
IMAGE SIZE = not available
FINAL SIZE = not available
TOP SHA256 = not available

ROOT CAUSE = PROVEN EXPORT-PIPELINE BLOCKER. `docker save --platform linux/amd64 supabase/postgres:15.1.0.147` targets a 409,219,973-byte local image, starts with no stderr, produces a zero-byte partial stream, and remains running beyond the bounded observation window. Docker context/daemon remain healthy and `docker image inspect` succeeds. This is not a missing-image or disk-space failure (785 GB free); it is a Docker/Colima image-export hang. No exit code was available because the process did not terminate.

The seven pinned identities were inspected successfully:
frontend `surfjudging-field:surfjudging-2026.08.08-p2.5.7-36dba46dcd63`,
Postgres `15.1.0.147`, PostgREST `v11.2.0`, Realtime `v2.25.50`,
GoTrue `v2.132.3`, Kong `2.8.1`, Storage `v0.40.4`.
All reported linux/amd64 and exact local image IDs/digests were captured.

The local `docker save` export still did not complete for the large Postgres
archive. The hung process and incomplete output were removed. No partial
archive was retained or imported. This prevents a false transferable bundle claim.

BOOTSTRAP SELF-CONTAINED = NO (not packaged; future prerequisite is a Docker-compatible runtime)
EXTERNAL PREREQUISITES = Docker-compatible runtime; actual clean target must provide virtualization/runtime
SECRET SCAN = NOT RUN (no final payload exists)
LEGACY FIELD UNCHANGED = YES (no runtime/volume operation performed)
P3.6 BACKUP PRESERVED = YES
CLOUD MODIFIED = NO
P3.7B EXECUTED = NO
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO

POSTGRES EXPORT: EXIT = unavailable (hung); TIME = exceeded bounded observation;
SIZE = 0-byte partial; SHA256 = not applicable; VALIDATION = not reached.
IMAGE PULLS = 0

The logical manifest/bootstrap implementation remains in P3.7A and no
image archives or bundle binaries were committed to Git.

## R3 FINAL DECISION

ENGINE API = Docker 29.5.2, API 1.54, Unix socket
`/Users/rene/.colima/default/docker.sock`.
`GET /images/{name}/get` succeeded for frontend and Postgres and then all
five remaining pinned images. OCI archive manifest/config digests matched
the exact local image identities; all are linux/amd64.

CANONICAL EXPORT METHOD = Docker Engine API image get (not CLI save)
PAYLOAD PATH = `/private/tmp/SurfJudging-P3.7B-Offline-Certification-amd64/`
IMAGE COUNT = 7 | IMAGES RAW TOTAL = 646 MB | FINAL TRANSFER SIZE = 677351424 bytes
TOP MANIFEST SHA256 = `b49a1a99a433819ba3d16a542a9283ee5fd23042aa3e0acb0519860dd91b8304`
FINAL PAYLOAD VERIFY = PASS (12 files, 7 archives, no partial files)
SECRET SCAN = PASS
BOOTSTRAP SELF-CONTAINED = NO
EXTERNAL PREREQUISITES = Docker-compatible runtime/virtualization; no repo, git, npm, Node.js or Homebrew
LEGACY FIELD UNCHANGED = YES | P3.6 BACKUP PRESERVED = YES
CLOUD MODIFIED = NO | P3.7B EXECUTED = NO | P3.7 FULL PASS = NO | P3.8 AUTHORIZED = NO
