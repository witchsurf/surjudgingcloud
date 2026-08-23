# P3.7C Host-Adaptive Runtime

The release layer (manifest, signature, verifier, frontend, migrations,
images and schema) is independent from the host runtime layer. A runtime
profile supplies only a validated container engine and adapter; it cannot
define sporting or database authority.

Detection is read-only and records OS, architecture, version, Docker CLI and
daemon/server identity, Colima/Lima presence, VZ capability, disk and RAM.
Selection is deterministic and fail-closed: validated existing Docker first,
then a certified native/bundled profile, otherwise `NO_CERTIFIED_RUNTIME_PROFILE`.

Approved host policy: an already reachable compatible Docker daemon selects
`macos-intel-existing-docker`; Intel Ventura selects a separately certified
Docker Desktop Intel Ventura pack; Intel Sonoma and newer select the matching
certified Docker Desktop Intel pack; Linux x86_64 selects native Docker; and
Apple Silicon selects a separate ARM profile. Docker Desktop packs are runtime
profiles only and never redefine the SurfJudging release identity.

Every adapter must implement `runtime_detect`, `runtime_preflight`,
`runtime_start`, `runtime_stop`, `runtime_status`, `runtime_socket`,
`runtime_import_image`, `runtime_compose`, and
`runtime_cleanup_failed_install`; adapter hashes are checked before use.
Existing Docker operations are namespace-scoped to `surfjudging_`; no global
prune, context overwrite, unrelated container deletion, or registry pull is
allowed. Recovery cleans only resources owned by the selected adapter.

Current Sandy target detection is read-only only. No installation or transfer
was performed. The next certification target is
`macos-intel-existing-docker`; VZ Ventura and legacy profiles remain rejected
until explicit evidence exists.

Read-only Sandy evidence: macOS `13.7.8`, `x86_64`, no Docker CLI, no
reachable Docker daemon, no Colima/Lima in PATH, and approximately 24 GiB
available in the home filesystem. Selection therefore returns
`NO_CERTIFIED_RUNTIME_PROFILE`; no installation is authorized.

Existing-Docker certification was not run: the developer host exposes Docker
CLI 29.7.1 and Compose 5.4.0, but its Colima socket is unreachable, and no
separate Intel certification host with a running daemon is available. No
Docker resources were created and no daemon/global configuration was changed.

`macos-intel-legacy` remains blocked: VZ Ventura compatibility is unproven
and the self-contained QEMU runtime closure was not produced. Generic
bootstrap must reject this profile until an engine payload passes offline,
relocation, amd64, networking, recovery, and resource gates.

Podman Machine 5.8.2 is now the candidate engine. Upstream publishes an
official macOS amd64 installer (SHA256
`2312f91523aeb168709f35d41576ade763c891c3991befe7173aac0edf133af9`) and
documents AppleHV on macOS. Upstream also states Intel Mac support is
best-effort; no Ventura target, offline local-image, API/Compose, or recovery
certification was performed. The profile remains blocked and cannot be selected.
