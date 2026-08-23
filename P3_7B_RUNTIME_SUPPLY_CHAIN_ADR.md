# P3.7B — Runtime Supply-Chain ADR

## Decision

**RECOMMENDED TRUST MODEL = Option B — SurfJudging certified builder.**
The clean target verifies one immutable SurfJudging-signed manifest and its payload hashes; it does not acquire runtime binaries directly.

**RECOMMENDED BUILDER = dedicated pinned CI/builder, producing platform-specific bundles.**
GitHub Actions is suitable for reproducible assembly and retention; a dedicated macOS Intel runner is required for macOS-specific validation/signing later.

**RECOMMENDED SIGNATURE METHOD = minisign.**
It is small, cross-platform, offline-verifiable, automation-friendly, supports key IDs and rotation, and has lower operator burden than GPG. Cosign remains an option for OCI provenance, not the operator-facing installer trust root.

## Current evidence

- P3.7A, payload transfer, target access, and clean baseline: PASS.
- Target: MacBookPro12,1, macOS 13.7.8, Intel x86_64, 8 GB RAM.
- Lima 2.1.1 hash is independently confirmed.
- Docker 29.0.1 and Colima 0.10.3 hashes are local-only evidence; independent vendor verification is not established.
- **INSTALL AUTHORIZED NOW = NO.**

## Options

### Option A — target-side vendor acquisition

Rejected as the production trust model. It requires every clean target to validate heterogeneous vendor checksum/signature/attestation formats, is sensitive to URL/tag drift, needs Internet at installation time, and complicates support and rollback. TLS and GitHub release existence alone are insufficient.

### Option B — certified builder

The builder pins URLs, versions, source revisions and upstream digests; records upstream verification and SBOM/provenance where available; creates OCI archives, runtime binaries, runtime definition, migrations, frontend, and Release Manifest V3; signs the manifest; and publishes immutable artifacts.

## Trust chain

SurfJudging release public key → signed Manifest V3 → hashes for desktop/runtime binaries, container archives, frontend, migrations and runtime definition → offline bootstrap verification → installation authorization.

No private key is stored in Git or on a competition machine. Key IDs are embedded in the manifest; rotation publishes a new public key through a separately trusted application release.

## Manifest V3

Bind: `desktopVersion`, `frontendRelease`, `sourceRevision`, `expectedSchema`, `migrationDigest`, `runtimeVersion`, `runtimeDefinitionDigest`, platform, architecture, bundle version, signing key ID, every payload filename/size/SHA256, and signature.

## Offline installation

Verify public key and signature, then every hash, platform/architecture, disk and resource requirements. Only after all checks pass: import images, initialize DB, apply migrations, start services, and verify runtime identity/schema. Any mismatch is a hard stop; no Internet repair or unsigned bypass.

## Policies

- Build/release Internet: **YES**, only in the trusted builder.
- Clean-target installation Internet: **NO**.
- Field operation Internet: **NO**; LAN/local runtime only.
- No automatic runtime upgrades. Updates require a new signed bundle, regression certification, immutable retention, and rollback to the prior bundle.
- URL replacement, retagging, digest change, disappearing assets, or missing vendor checksums invalidate the release input and require a new reviewed build.

## Current downloads and target impact

- Docker download: **KEEP FOR EVIDENCE ONLY**; do not install.
- Colima download: **KEEP FOR EVIDENCE ONLY**; do not install.
- Lima download: **KEEP FOR EVIDENCE ONLY**; its hash is confirmed but it is not sufficient to authorize the runtime alone.
- The clean-machine baseline remains valid and suitable for a later signed bundle; no target mutation occurred.

## Platform strategy

Publish separate signed bundles for macOS Intel x86_64, macOS arm64, and Windows x64. Do not use an ambiguous universal runtime bundle. Container payloads remain architecture-specific and are validated against the selected VM/runtime.

## Security and UX

Signature failure, hash mismatch, manifest mismatch, insufficient resources, or wrong architecture means `INSTALL AUTHORIZED = NO`. Operator UX should expose: VERIFYING SURFJUDGING RELEASE → PREPARING FIELD RUNTIME → IMPORTING OFFLINE SERVICES → INITIALIZING DATABASE → STARTING FIELD → READY.

## Next implementation

**P3.7B-BUILDER:** produce one signed amd64 test runtime bundle for the existing clean Intel Mac, transfer it to `192.168.1.99`, verify offline, then resume P3.7B. Builder implementation is not authorized in this ADR phase.

## Final decision

```text
RECOMMENDED TRUST MODEL = SurfJudging certified builder + signed offline bundle
RECOMMENDED BUILDER = pinned CI/dedicated builder with macOS Intel validation
RECOMMENDED SIGNATURE METHOD = minisign
CLEAN TARGET INTERNET REQUIRED = NO
FIELD INTERNET REQUIRED = NO
UPSTREAM DOWNLOADS OCCUR = BUILD TIME
CURRENT DOCKER DOWNLOAD = KEEP FOR EVIDENCE ONLY
CURRENT COLIMA DOWNLOAD = KEEP FOR EVIDENCE ONLY
CURRENT LIMA DOWNLOAD = KEEP FOR EVIDENCE ONLY
P3.7B NEXT ACTION = implement P3.7B-BUILDER, then transfer signed amd64 bundle
INSTALL AUTHORIZED NOW = NO
```
