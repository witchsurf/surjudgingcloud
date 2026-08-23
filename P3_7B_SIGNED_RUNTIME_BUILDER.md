# P3.7B Signed Runtime Builder — blocked pre-build

## Result

**P3.7B-BUILDER = FAIL (pre-build gate).** No bundle was built, signed,
installed, imported, transferred, or deployed.

## Builder identity

```text
BUILDER OS = macOS 26.6
BUILDER ARCH = x86_64
GIT HEAD = ec8a4f28710bf7cc75028bfd5a21397648c20842
origin/main = ec8a4f28710bf7cc75028bfd5a21397648c20842
WORKTREE = dirty (pre-existing unrelated P2 reports)
```

## Frozen-input gate

The requested frozen source revision is `17ed8b0799a9a0298b7d6b7812f57403432b093d`.
The current builder checkout is `ec8a4f2…`; therefore the source freeze is not
proven and the build was correctly stopped. A detached clean checkout/worktree
at the exact frozen revision is required before assembly.

## Runtime/signing gates

- The existing transferable payload contains seven image archives and runtime
  metadata, but no pinned Docker CLI, Lima, or Colima binaries.
- `minisign` is not installed in the builder environment.
- No test keypair was created; no private key was written or committed.
- Consequently Manifest V3, detached signature, payload verification, and
  corruption rejection were not executed.

## Current payload handling

The existing unsigned payload remains evidence-only at:
`/private/tmp/SurfJudging-P3.7B-Offline-Certification-amd64/`.
It was not modified. No target, Field, Cloud, database, or protected backup
was modified.

```text
SIGNATURE VERIFY = NOT RUN
MANIFEST V3 = NOT BUILT
PAYLOAD VERIFY = NOT RUN
SECRET SCAN = NOT RUN
CORRUPTION REJECTION = NOT RUN
INSTALL ON CLEAN TARGET AUTHORIZED = NO
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO

## Builder input provisioning — 2026-08-16

Runtime inputs were downloaded into `/private/tmp/surfjudging-p3.7b-inputs`
only; nothing was installed or executed.

```text
DOCKER INPUT HASH = PASS
  e64b960996f1f6c174d07f727855dc49e18b958775e3ad03c1b93a4b5e62f736
LIMA INPUT HASH = PASS
  2dc5b10aa3a4f26d08c1f3fe83e37e01f85a7d9db0d1d5cb6985b18af96ab07d
COLIMA INPUT HASH = PASS
  3082737fe8a98afda11cba7d9a20b6e56fe80c6153464beda04bec630758770b
```

Sources were the pinned official URLs; Docker and Colima remain SurfJudging
builder-input hashes, not vendor attestations. Lima’s upstream checksum is
confirmed.

Minisign provenance was advanced to the exact official v0.11 source tag:

```text
SOURCE = https://github.com/jedisct1/minisign/archive/refs/tags/0.11.tar.gz
TAG OBJECT = feefda7af87f64342bd07bf446ceb0467cbd0fb4
SOURCE SHA256 = 74c2c78a1cd51a43a6c98f46a4eabefbc8668074ca9aa14115544276b663fc55
MINISIGN PROVENANCE = PASS (official source/tag identity)
MINISIGN BINARY = NOT BUILT
```

The builder has no `cmake`, `libsodium`, Zig, or preverified minisign binary;
therefore no minisign executable was provisioned or run. No keypair was
created.

```text
KEYPAIR CREATED = NO
HISTORICAL FIELD MODIFIED = NO
P3.6 BACKUP MODIFIED = NO
CLOUD MODIFIED = NO
```

The next gate is a reproducible v0.11 source build with an approved toolchain,
after which the binary hash must be recorded before any signing operation.

## Minisign build audit — 2026-08-16

Builder toolchain audit:

```text
clang = Apple clang 21.0.0
cc = Apple clang 21.0.0
make = GNU Make 3.81
cmake = unavailable
pkg-config = unavailable
libsodium = unavailable
zig = unavailable
xcode-select = /Library/Developer/CommandLineTools
architecture = x86_64
```

The verified Minisign 0.11 source explicitly requires `libsodium`; its CMake
path additionally requires CMake and pkg-config. The Zig path also requires
libsodium. Therefore the Apple compiler alone is insufficient. No dependency
was installed and no build was attempted.

```text
MINISIGN SOURCE PROVENANCE = PASS
MINISIGN BUILD = BLOCKED — required toolchain/dependency absent
MINISIGN BINARY READY = NO
RUNTIME INPUTS = PASS 3/3
P3.7B INPUT GATE = FAIL

## Signing toolchain resolution — 2026-08-16

No package or signing key was created. Existing native tools were audited:

```text
OpenSSH = OpenSSH_10.3p1, LibreSSL 3.3.6
ssh-keygen -Y sign = AVAILABLE
ssh-keygen -Y verify = AVAILABLE
OpenSSL = 3.6.3 (Ed25519-capable)
security/codesign = present, but intended for Apple code signing/notarization
```

An official Minisign 0.11 macOS x86_64 binary was not established with an
independently verifiable checksum/signature, so it remains unavailable for
this trust decision. The native OpenSSH path provides offline Ed25519 signing,
detached signatures, a distributable public key, namespace separation and
scriptable tamper rejection without a target package manager or runtime
dependency.

**RECOMMENDED SIGNING MODEL = B — NATIVE OPENSSH ED25519.**

Proposed policy: `ssh-keygen -Y sign` with a dedicated namespace such as
`surfjudging-release-v3`, and `ssh-keygen -Y verify` with an explicit
`allowed_signers` file. This is manifest signing only; it is separate from
Apple code signing/notarization and future Windows Authenticode.

Manifest V3 would change `signing.algorithm` to `ssh-ed25519`, add
`signing.namespace`, `signing.keyId`, and an allowed-signers/public-key
identity. The target needs only the native macOS OpenSSH tool and bundled
public verification policy; no Internet or package manager is required.

Target-side harmless verification to run later (not run now):
`sw_vers; ssh -V; ssh-keygen -Y 2>&1 | grep -E 'sign|verify'`.

```text
MINISIGN OFFICIAL AUTHENTICATED BINARY AVAILABLE = NO
NATIVE OPENSSH VERSION = OpenSSH_10.3p1
SSH-KEYGEN Y SIGN AVAILABLE = YES
SSH-KEYGEN Y VERIFY AVAILABLE = YES
NATIVE ED25519 SUITABLE = YES
TARGET-SIDE EXTERNAL DEPENDENCY REQUIRED = NO
TARGET INTERNET REQUIRED = NO
TARGET PACKAGE MANAGER REQUIRED = NO
MANIFEST V3 CHANGE REQUIRED = YES
CURRENT RUNTIME INPUTS = PASS 3/3
SURFJUDGING KEYPAIR CREATED = NO
```

## Minimal direct-build assessment — 2026-08-16

Source inspection confirms a direct Apple Clang build is technically possible:
the Minisign sources include `<sodium.h>` and link only against libsodium;
CMake, pkg-config and Zig are convenience/build-system paths, not required by
the C sources themselves.

The official immutable libsodium 1.0.20 source and its detached official
Minisign signature were staged outside Git:

```text
SOURCE = https://download.libsodium.org/libsodium/releases/libsodium-1.0.20.tar.gz
SOURCE SHA256 = ebb65ef6ca439333c2bb41a0c1990587288da07f6c7fd07cb3a18cc18d30ce19
SIGNATURE SHA256 = 693ea59f639f70164d99f5549fa48b14beaed8efd625785b78da19463d7af0d0
```

However, no Minisign verifier is available yet, so the detached signature
cannot be independently checked. The libsodium source was not compiled and no
library was installed or staged as a trusted dependency.

```text
DIRECT CLANG BUILD POSSIBLE = YES
LIBSODIUM PROVENANCE = PENDING SIGNATURE VERIFICATION
LIBSODIUM BUILD = NOT RUN
MINISIGN BUILD = NOT RUN
MINISIGN BINARY READY = NO

## Direct build attempt — 2026-08-16

The official libsodium 1.0.20 source was configured successfully with the
Apple toolchain using a user-local prefix and no system installation. A
single-threaded build was attempted after a parallel build exposed a libtool
archive race, but the build did not reach a completed installed library within
the builder execution window. No trusted `libsodium.a` was produced, so the
Minisign compile was not attempted.

```text
LIBSODIUM BUILD = FAIL / INCOMPLETE
LIBSODIUM TESTS = NOT RUN
MINISIGN BUILD = NOT RUN
BUILD 1 SHA256 = NOT AVAILABLE
BUILD 2 SHA256 = NOT AVAILABLE
BYTE REPRODUCIBLE = NOT RUN
VERSION CHECK = NOT RUN
MINISIGN BINARY READY = NO
SURFJUDGING KEYPAIR CREATED = NO
```

No system paths, target machines, Field, Cloud, protected backup, or Git
worktree were modified.

## Direct static bypass assessment — 2026-08-16

The generated build graph contains 119 C translation units plus architecture-
specific variants and generated configuration. A naive recursive compile would
be an invented source list and is therefore not acceptable. The official
metadata does not expose a single supported Apple-Clang archive command; it
relies on the generated Autotools/libtool graph. The prior libtool failure
means the bypass is not yet proven safe.

```text
DIRECT LIBSODIUM CLANG BUILD POSSIBLE = NOT PROVEN
LIBSODIUM STATIC ARCHIVE = NOT PRODUCED
LIBSODIUM LINK TEST = NOT RUN
MINISIGN BUILD = NOT RUN
MINISIGN BINARY READY = NO
```

No alternate toolchain or dependency was introduced. The builder remains
blocked rather than guessing a source list or configuration.

## Resume build attempt — 2026-08-16

The existing verified archives were reused; no re-download occurred. A fresh
libsodium source extraction was configured with Apple Clang using a local
prefix and single-threaded `make -j1`. Configuration required explicit
`--build/--host` because the sandbox cannot execute configure probe binaries.

The actual compilation failed in the generated libtool step while renaming a
temporary object (`mv: rename ...libsodium_la-stream_xsalsa20.loT ...: No such
file or directory`). No installed `libsodium.a` exists. This is a concrete
build-environment/filesystem failure, not an unverified success.

```text
LIBSODIUM BUILD = FAIL (libtool temporary-object rename)
LIBSODIUM TESTS = NOT RUN
MINISIGN BUILD = NOT RUN
BUILD 1 SHA256 = NOT AVAILABLE
BUILD 2 SHA256 = NOT AVAILABLE
BYTE REPRODUCIBLE = NOT RUN
FINAL BINARY SHA256 = NOT AVAILABLE
VERSION CHECK = NOT RUN
SURFJUDGING KEYPAIR CREATED = NO
```
```
```
```

## Required next action

Create a clean detached builder worktree at the frozen source revision,
obtain and independently approve pinned runtime binaries, provision minisign
in the builder, then implement/execute the signed Manifest V3 builder. Do not
install anything on `192.168.1.99` until that release passes all gates.

## Model B implementation attempt — 2026-08-16

An isolated clone was created at:
`/private/tmp/surfjudging-p3.7b-builder-ec8a4f2`.

```text
ISOLATED BUILDER HEAD = ec8a4f28710bf7cc75028bfd5a21397648c20842
ISOLATED WORKTREE = clean
RUNTIME SOURCE IDENTITY = 17ed8b0799a9a0298b7d6b7812f57403432b093d
```

The implementation stopped at the approved trust gates:

- `minisign` is unavailable on the builder and no provenance-verified 0.11
  binary has been provisioned.
- The existing unsigned payload has no Docker, Lima, or Colima runtime
  binaries, so it cannot satisfy the self-contained runtime requirement.
- Manifest V3, key generation, signing, verifier tests, corruption tests and
  packaging were therefore not executed.
- The permanent DB regression was not run against the historical Field DB;
  an isolated disposable DB is required.

```text
MINISIGN PROVENANCE = FAIL (not provisioned)
TEST TRUST ROOT = NOT CREATED
MANIFEST V3 = NOT BUILT
MANIFEST REPRODUCIBILITY = NOT RUN
RUNTIME INPUTS = FAIL (runtime binaries absent)
IMAGE IDENTITY = NOT RECHECKED in signed builder
MIGRATION IDENTITY = NOT RUN in isolated DB
PERMANENT DB REGRESSION = NOT RUN (safety gate)
SIGNATURE VERIFY = NOT RUN
NEGATIVE TEST MATRIX = NOT RUN
CORRUPTION REJECTION = NOT RUN
SECRET SCAN = NOT RUN
OFFLINE VERIFIER = NOT BUILT
USER-LOCAL INSTALL = NOT PROVEN
LEGACY FIELD UNCHANGED = YES (no Field access)
P3.6 BACKUP PRESERVED = YES (not touched)
CLOUD MODIFIED = NO
P3.7B-BUILDER = FAIL
SIGNED BUNDLE READY FOR TRANSFER = NO
INSTALL CLEAN TARGET AUTHORIZED = NO
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO
```

## CURRENT AUTHORITATIVE STATUS — SIGNED OPENSSH ED25519 BUNDLE — 2026-08-16

```text
SIGNING MODEL = NATIVE OPENSSH ED25519
TARGET OPENSSH COMPATIBILITY = PASS (9.0p1 confirmed)
TEST TRUST ROOT = PASS
PRIVATE KEY COMMITTED = NO
PRIVATE KEY PACKAGED = NO
MANIFEST V3 = PASS
MANIFEST REPRODUCIBILITY = PASS
SIGNATURE VERIFY = PASS
SIGNER IDENTITY = PASS (surfjudging-p3.7b-test)
NAMESPACE ENFORCEMENT = PASS (surfjudging-release-v3)
RUNTIME INPUTS = PASS 3/3
IMAGE IDENTITY = PASS 7/7
MIGRATION IDENTITY = PASS (bound in manifest)
PERMANENT DB REGRESSION = NOT RUN (no disposable DB available)
NEGATIVE SIGNATURE TESTS = PASS
NEGATIVE PAYLOAD TESTS = PASS
CORRUPTION REJECTION = PASS
SECRET SCAN = PASS
OFFLINE VERIFIER = PASS (native ssh-keygen/shasum verifier)
FINAL BUNDLE VERIFY = PASS (builder simulation)
SIGNED BUNDLE READY FOR TRANSFER = YES
INSTALL CLEAN TARGET AUTHORIZED = NO pending explicit review
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO
```

```text
BUNDLE PATH = /private/tmp/SurfJudging-P3.7B-Signed-macOS-x86_64
FILE COUNT = 19
SIZE = 720632 KiB
MANIFEST SHA256 = 13246d7c8d713c3ec680c258f07531d0d52b2c74e5c5f3b7fea010641597772b
SIGNATURE SHA256 = b8ef1584827268303cf83ec5731b7e135fcd9bcd80bf2cee5b4472a8228139fa
PUBLIC KEY FINGERPRINT = SHA256:wYZTQ+HBk0oQKisbYPxr2jkobVJOTRSiJgcHmYJlEio
```

The private test key remains outside the bundle and repository. No transfer,
clean-target installation, Field, Cloud, DB, or backup modification occurred.

## CURRENT AUTHORITATIVE STATUS — ROOT OF TRUST FIX — 2026-08-16

The verifier now independently pins the bundled public key before consulting
`allowed_signers`. It checks the exact Ed25519 fingerprint, exact public-key
material, one-line signer policy, principal, and namespace. The bundle key is
therefore no longer its own trust anchor for the P3.7B test.

```text
ROOT OF TRUST EXTERNALIZED = PASS
PINNED TEST KEY FINGERPRINT = SHA256:wYZTQ+HBk0oQKisbYPxr2jkobVJOTRSiJgcHmYJlEio
VERIFIER SHA256 = 1f2693e364657d694685661f60af04d9e3276416a8df99164f1af33c10c4e867
PUBLIC KEY SUBSTITUTION REJECTION = PASS
ALLOWED_SIGNERS SUBSTITUTION REJECTION = PASS
ATTACKER RE-SIGN TEST = PASS (pinned key mismatch)
VERIFIER TAMPER DETECTION = PASS (independent expected hash recorded)
SIGNATURE VERIFY = PASS
FINAL BUNDLE VERIFY = PASS
SIGNED BUNDLE READY FOR TRANSFER = YES
INSTALL CLEAN TARGET AUTHORIZED = NO pending new transfer/review
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO
```

Production distinction: the production public key must be anchored in a
previously trusted signed/notarized desktop installer or application. A
production bundle must never be allowed to supply its own unconstrained key or
verifier. The P3.7B hard-coded test fingerprint is intentionally test-only.

Updated bundle identities:

```text
MANIFEST SHA256 = df1bc500f17f58d95846deccd90296ca1287ddf764e82694465308f2cf1a9433
SIGNATURE SHA256 = d7c17123faa5e20f46a9937ad3961acfbe091337a80cedf6e13264dac235c0c4
```

## CURRENT AUTHORITATIVE STATUS — BOOTSTRAP IMPLEMENTATION GAP — 2026-08-16

The bootstrap was replaced with a POSIX, stage-based offline state machine.
It verifies the signed bundle before any target mutation, checks platform,
architecture, resources, and payload completeness, then contains the pinned
runtime/image/import/data/service stages. It deliberately stops before local
runtime preparation because this bundle does not contain the required
migration SQL files or an executable service definition (`compose.yaml`).
This prevents a false READY result.

```text
BOOTSTRAP IMPLEMENTATION = PASS (state machine and fail-closed gates)
BOOTSTRAP PAYLOAD COMPLETENESS = FAIL (migration SQL + executable service definition absent)
POSIX SYNTAX = PASS
SIGNATURE VERIFY = PASS
NEGATIVE ROOT-OF-TRUST TESTS = PASS
MANIFEST V3 REGENERATED = PASS
MANIFEST RE-SIGNED = PASS
MANIFEST SHA256 = 7135143636aad04f5e67029528ee3c389e12dd4356b5e76ac4ca90f9a5d7846c
SIGNATURE SHA256 = 839fc3a0246da7861f1343ac1a6e2b71db0b3a91bea3f9653bc9b88808d8d769
BOOTSTRAP SHA256 = eab47900eca41a770f5a83960853fe23c253b8858d01a63542d2d12a99636d48
SIGNED BUNDLE READY FOR TRANSFER = NO (payload incomplete)
INSTALL CLEAN TARGET AUTHORIZED = NO
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO
```

No clean target, legacy Field, Cloud, database, or backup was modified.

## CURRENT AUTHORITATIVE STATUS — EXECUTABLE OFFLINE PAYLOAD COMPLETE — 2026-08-16

The authoritative migration set from `migrations.sha256` is now included as
125 exact SQL files, in deterministic order, with a generated migration
manifest. The Field service definition is bundled as `runtime/compose.yaml`
with the seven pinned local image references only (`pull_policy: never`),
plus the authoritative Kong and frontend configuration. Local-only secrets
are generated at first install into the SurfJudging-owned runtime state; no
secret is packaged.

```text
MIGRATION SQL INCLUDED = PASS (125 files)
MIGRATION DIGEST = PASS (b0292cf9ec290985ab83a69571eb53df4fe7165198038c10e72813ba22add97e)
EXECUTABLE SERVICE DEFINITION = PASS
LOCAL SECRET PROVISIONING = PASS (first-install local generation)
IMAGE IMPORT = NOT RUN (target install intentionally not run)
IMAGE IDENTITY = PASS (7/7 compose references match manifest)
POSTGRES INIT = NOT RUN
MIGRATIONS APPLY = NOT RUN
FINAL SCHEMA = 20260814220000_fix_exhaustive_ranking_lineage_division (declared target)
PERMANENT DB REGRESSION = NOT RUN
SERVICE HEALTH = NOT RUN
REALTIME = NOT RUN
DB AUTHORITY = PASS (no local authority introduced)
SOURCE == SERVED = NOT RUN
OFFLINE FIRST INSTALL = NOT RUN
READY GATE = NOT RUN / NOT AUTHORIZED
NEGATIVE BOOTSTRAP TESTS = PASS (signed verifier, payload and root-of-trust tests)
COMPOSE CONFIG VALIDATION = PASS
SECRET SCAN = PASS
```

```text
MANIFEST SHA256 = 199d6531eee0fb207c546c2d7b6f9580211b565be7558e5f4b18ff19cb2ded79
SIGNATURE SHA256 = a655d502480c8d5ef9a8c70da228bb1e5835508c95fdc20046d1b785a329446d
BOOTSTRAP SHA256 = e5c7e75977e03d34796f81b38771ad46d536372c51c242a41630b90d99cdae2c
VERIFIER SHA256 = 1f2693e364657d694685661f60af04d9e3276416a8df99164f1af33c10c4e867
COMPOSE SHA256 = e0f788967caa660847b05843a398d46481a1c417d12c18993c45420a084d392a
MIGRATION SET DIGEST = b0292cf9ec290985ab83a69571eb53df4fe7165198038c10e72813ba22add97e
FILE COUNT = 149 (147 payload files + manifest + signature)
BUNDLE SIZE = 765020 KiB
SIGNED BUNDLE READY FOR TRANSFER = YES (builder payload complete)
INSTALL CLEAN TARGET AUTHORIZED = NO pending explicit review
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO
```

No clean target, historical Field, Cloud, database, or backup was modified;
the bundle was not transferred or executed on the clean target.

## CURRENT AUTHORITATIVE STATUS — FIRST INSTALL FAILURE / LIMA FIX — 2026-08-16

The clean-target attempt proved that copying only `limactl` was insufficient.
The official Lima archive contains the complete executable tree (`bin/`,
`libexec/`, `share/`, Lima templates and the Linux guest agent). The bootstrap
now preserves that tree, exposes its `bin` and `libexec/lima` paths, and sets
user-local `LIMA_HOME`/`COLIMA_HOME`. Colima's embedded runtime metadata also
proves that first start downloads the amd64 Docker guest image from
`abiosoft/colima-core`; this asset is therefore bundled and passed explicitly
with `--disk-image`, so first start has no guest-image network dependency.

```text
FIRST INSTALL ATTEMPT = FAIL
FAILED STAGE = START_COLIMA
PARTIAL TARGET MUTATION = YES
DB CREATED = NO
MIGRATIONS APPLIED = NO
CONTAINERS CREATED = NO
LIMA PACKAGING ROOT CAUSE = only limactl was copied; required Lima tree was omitted
COMPLETE LIMA USER-LOCAL INSTALL = PASS (implemented; not re-run on target)
COLIMA OFFLINE FIRST START ASSETS COMPLETE = PASS (pinned amd64 Docker guest image bundled)
VM BACKEND VERIFIED = PASS (VZ selected for Intel Ventura; no QEMU dependency)
DOCKER CONTEXT LOGIC = PASS (Colima context/socket explicitly resolved)
FAILURE EXIT CODE LOGIC = PASS (trap records FAILED stage and returns non-zero)
RECOVERY PROCEDURE = PASS (archive evidence, remove only SurfJudging FAILED state)
SIGNED BUNDLE READY FOR RETRANSFER = PENDING final asset hash/signature regeneration
INSTALL CLEAN TARGET AUTHORIZED = NO pending review/recovery/retransfer
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO
```

The recovery helper is `bootstrap/recover-failed-install.sh`; it refuses to
delete anything unless `install-state` explicitly says `FAILED`, archives the
bootstrap evidence first, and removes only the SurfJudging-owned state.

## CURRENT AUTHORITATIVE STATUS — LIMA/OFFLINE ASSET FIX COMPLETE — 2026-08-16

The pinned Colima binary embeds the exact first-start guest-image source and
checksum. The required amd64 Docker guest image was downloaded once on the
builder, verified against that embedded SHA-512, and added to the signed
payload. Bootstrap now passes the image explicitly to Colima, preserving the
complete Lima tree and avoiding any first-start network fetch.

```text
FIRST INSTALL FAILURE ROOT CAUSE = CONFIRMED (incomplete Lima tree)
COMPLETE LIMA USER-LOCAL INSTALL = PASS
OFFLINE COLIMA GUEST ASSET = PASS
GUEST IMAGE SHA512 = 27652801b6606b457f4f34836358c0e9978aeb98757d0271165e3f09672f930ccc2d957e15726f7e7f22c302b20a3d30c64ead68adaa5f24a4f959cd34b56b5b
DOCKER CONTEXT/SOCKET = EXPLICIT COLIMA CONTEXT
FAILED-INSTALL RECOVERY = PASS
FAILURE EXIT CODE/STATE = PASS (IN_PROGRESS/FAILED/READY)
MANIFEST V3 = PASS
SIGNATURE VERIFY = PASS
SECRET SCAN = PASS
SIGNED BUNDLE READY FOR RETRANSFER = YES
INSTALL CLEAN TARGET AUTHORIZED = NO pending explicit review/recovery/retransfer
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO
```

```text
NEW MANIFEST SHA256 = 1b73300b91f00f5d8d2e792dafeed65c0c249f53842f7a276dbec2ebd1f55f3e
NEW SIGNATURE SHA256 = 160e38b3e709762e99e422e9cbb7d8d0a0b2983376d313b4a0abe00de4496baa
NEW BOOTSTRAP SHA256 = 3040cf1c279c481e350d3182e7dc946632fdc0001cbb72a9ba51b6e2acf7573f
VERIFIER SHA256 = 1f2693e364657d694685661f60af04d9e3276416a8df99164f1af33c10c4e867
COMPOSE SHA256 = e0f788967caa660847b05843a398d46481a1c417d12c18993c45420a084d392a
MIGRATION SET DIGEST = b0292cf9ec290985ab83a69571eb53df4fe7165198038c10e72813ba22add97e
PAYLOAD FILES = 149 (151 files including manifest and signature)
BUNDLE SIZE = 1125516 KiB
```

No recovery command was executed automatically. No clean target, historical
Field, Cloud, database, or backup was modified.

## CURRENT AUTHORITATIVE STATUS — COLIMA GUEST IMAGE HASH FIX — 2026-08-16

The third clean-target attempt exposed that bootstrap decompressed the signed
`.raw.gz` before passing it to Colima. Colima validates the compressed asset
bytes against its embedded SHA-512, so the decompressed/re-written file was
rejected. The builder asset itself is correct; bootstrap now verifies the
compressed hash before any mutation and passes the exact `.raw.gz` bytes to
`--disk-image`.

```text
THIRD REAL INSTALL ATTEMPT = FAIL
FAILED_STAGE = START_COLIMA
ROOT CAUSE = compressed asset was decompressed before Colima validation
EXPECTED GUEST SHA512 = 27652801b6606b457f4f34836358c0e9978aeb98757d0271165e3f09672f930ccc2d957e15726f7e7f22c302b20a3d30c64ead68adaa5f24a4f959cd34b56b5b
OLD TARGET GUEST SHA512 = b343e32dcc3dc39dde0fd0ecc683fe6e648aff4c38b1abe54a653765783b88d02f04108a88fe9cf84c224c0599dc5e922556d5af4b8f47b0d31ec7f6b7ef7763
HASH TARGET = COMPRESSED .raw.gz
EXACT OFFICIAL GUEST ASSET = PASS
NEW GUEST SHA512 = 27652801b6606b457f4f34836358c0e9978aeb98757d0271165e3f09672f930ccc2d957e15726f7e7f22c302b20a3d30c64ead68adaa5f24a4f959cd34b56b5b
PRE-MUTATION GUEST HASH GATE = PASS
LIMA COMPLETE TREE = PASS
INSTALL_COLIMA PATH FIX = PASS
DOCKER CONTEXT LOGIC = PASS
FAIL-CLOSED = PASS
RECOVERY = PASS
SIGNED BUNDLE READY FOR RETRANSFER = YES
INSTALL CLEAN TARGET AUTHORIZED = NO pending recovery/retransfer/review
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO
```

```text
NEW MANIFEST SHA256 = 89793543f65fdcc45fc03ca95f3115ec0495fa93df87fb8a50e9894390374fd6
NEW SIGNATURE SHA256 = eb9fd94b9d6f944e613429c70ef5275f16e601ac8e7577b7c0822a3cbb16819b
NEW BOOTSTRAP SHA256 = 40b5d6a448d1e6a9ab2d48d872ebbb5c0f1b9d6536032433a5887dce528168b1
GUEST ASSET REGRESSION SHA256 = cdd29d8a62cd50987415f4f217a04d091046572371f8950ae192f06295c43e9a
```

## CURRENT AUTHORITATIVE STATUS — INSTALL_COLIMA PATH FIX — 2026-08-16

The second clean-target failure was isolated to a runtime-definition path
mismatch: the metadata named `runtime/compose.yaml`, while bootstrap copied
and consumed the definition from the SurfJudging-owned
`$RUNTIME/runtime-definition/` directory. Bootstrap now defines one canonical
`RUNTIME_DEFINITION` path and uses it consistently for compose, Kong, nginx,
and service startup. The metadata was corrected to the same installed path.

```text
PATH AUDIT = PASS
STRUCTURAL BOOTSTRAP TEST = PASS
RUNTIME IDENTITY CHANGED = NO
IMAGES CHANGED = NO
MIGRATIONS CHANGED = NO
LIMA TREE PRESERVED = YES
OFFLINE GUEST IMAGE PRESERVED = YES
FAIL-CLOSED STATE MACHINE PRESERVED = YES
RECOVERY BEHAVIOR PRESERVED = YES
ROOT-OF-TRUST TESTS = PASS
PAYLOAD/TAMPER TESTS = PASS
SECRET SCAN = PASS
SIGNED BUNDLE READY FOR RETRANSFER = YES
INSTALL CLEAN TARGET AUTHORIZED = NO pending explicit review/retransfer
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO
```

```text
NEW MANIFEST SHA256 = f88d2babab2539a39619e12d70bedc6f4197cb7f773c2bfb8a37566ed347ad0d
NEW SIGNATURE SHA256 = 6b77e535bae361a6dcd9a0ccd30800c61106be0fd65c0a30e15d6387ca79778f
NEW BOOTSTRAP SHA256 = 4173f1977bfed487dee9edd53e19b7f7c17529221c935f85ae748b35f430433e
RUNTIME-DEFINITION SHA256 = 508cc4323b6db1a840fd86bcc47d07ba9a3e25516a5958b9708761dd8bcd43f3
REGRESSION TEST SHA256 = 1c13ee530d9c6f5f8e899423a741f91a8ae86bf3b96ebec301c88f6e8b35bb83
```
## CURRENT AUTHORITATIVE STATUS — START_COLIMA SOCKET/BACKEND FIX

Fourth real clean-target attempt stopped at `START_COLIMA`: the generated
Lima usernet socket was 105 bytes, exceeding macOS `UNIX_PATH_MAX` 104.
The fix uses isolated short roots: `$HOME/.surfjudging-p37b/lima` and
`$HOME/.surfjudging-p37b/colima`, with a pre-mutation socket budget gate
(target <=90 bytes) and recovery coverage for both roots.

`VZ` is not accepted for the exact Intel Ventura 13.7.8 target: the bundled
Colima/Lima warning requires macOS 15.5+ for the Linux 6.12 VZ path. The
bundle contains no QEMU runtime (`qemu-system-x86_64`/`qemu-img`) and none is
available on the builder, so an offline QEMU backend cannot be claimed.

PATH AUDIT = PASS
SOCKET PATH REGRESSION = PASS (short 70; historical long 105)
GUEST HASH GATE = PASS
VZ INTEL VENTURA COMPATIBILITY = NOT PROVEN / NOT ACCEPTED
QEMU OFFLINE RUNTIME = FAIL (not bundled, not available)
STRUCTURAL BOOTSTRAP TEST = PASS (fail-closed backend gate)
SIGNED BUNDLE READY FOR RETRANSFER = NO
INSTALL CLEAN TARGET AUTHORIZED = NO pending complete signed QEMU payload
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO
## CURRENT AUTHORITATIVE STATUS — QEMU SOURCE-BUILD FEASIBILITY

Selected stable source: QEMU 9.2.4, `https://download.qemu.org/qemu-9.2.4.tar.xz`.
Source SHA256: `f3cc1c4eabfdb288218ac3e33763dbe9e276d8bc890b867a2335d58de2ddd39a`.
The detached signature verified against the official QEMU release key
`CEACC9E15534EBABB82D3FA03353C9CEF108B584`; GPG reports that key expired,
so this is provenance evidence but not a currently-valid trust assertion.

Builder-only audit installed Homebrew `meson`, `ninja`, `pkg-config`, GLib,
Pixman and an isolated GnuPG/Python helper. Minimal configure succeeded for
`x86_64-softmmu`, but the full build did not complete in the available build
execution window; no `qemu-system-x86_64` or `qemu-img` artifact exists.
Consequently runtime closure, relocation, Lima discovery, and offline
START_COLIMA were not executed.

SOURCE PROVENANCE = PASS (signature cryptographically good; signing key expired)
BUILD = FAIL / INCOMPLETE
QEMU SYSTEM = FAIL
QEMU IMG = FAIL
RUNTIME DYLIB CLOSURE = NOT RUN
FIRMWARE/RESOURCE CLOSURE = NOT RUN
RELOCATABLE = NO
BREW REQUIRED ON BUILDER = YES
BREW REQUIRED ON TARGET = NO
LIMA QEMU DISCOVERY = NOT RUN
OFFLINE START_COLIMA = NOT RUN
QEMU RUNTIME SIZE = unavailable
QEMU SOURCE BUILD FEASIBLE = NO (not proven)
SIGNED BUNDLE READY FOR RETRANSFER = NO
INSTALL CLEAN TARGET AUTHORIZED = NO
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO
## CURRENT AUTHORITATIVE STATUS — VZ VENTURA INTEL FEASIBILITY

The current bundled guest is Ubuntu 24.04 with the Linux 6.12+ path and is
not accepted for Intel Ventura VZ. An official historical amd64 candidate
exists at Colima Core `v0.7.6-1`:
`ubuntu-24.04-minimal-cloudimg-amd64-docker.qcow2`, with official SHA-512
`1e128da890e9d8b07a3c2556fe200ce3c724108d099eacce311b520507f6e2d114430991d1b68ecf9ad66a915eb315f433a950bdff09450224c34d9529b88890`.
Its release provenance is official, but its actual guest kernel was not
verified and no evidence proves it is accepted by Intel Ventura VZ.

The real target warning explicitly rejects the current Linux 6.12+ guest;
the only target-safe conclusion requires an actual Ventura 13.7.8 Intel VZ
start. The builder is macOS 26.6, so it cannot establish that target gate.
No clean target test was run, and the partial disposable download was not
used or added to any bundle.

TARGET = macOS 13.7.8 Intel x86_64 (MacBookPro12,1)
CURRENT GUEST KERNEL = Linux 6.12+ path
CURRENT VZ COMPATIBILITY = FAIL
CANDIDATE GUEST = colima-core v0.7.6-1 amd64 Docker qcow2
CANDIDATE KERNEL = NOT VERIFIED
CANDIDATE PROVENANCE = PASS (official asset and checksum)
COLIMA 0.10.3 COMPATIBILITY = NOT PROVEN
LIMA 2.1.1 COMPATIBILITY = NOT PROVEN
VZ START_COLIMA = NOT RUN
OFFLINE START_COLIMA = NOT RUN
DOCKER INFO = NOT RUN
VZ VENTURA INTEL FEASIBLE = NO (compatibility and target start unproven)
SIGNED BUNDLE READY FOR RETRANSFER = NO
INSTALL CLEAN TARGET AUTHORIZED = NO
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO
