# P3.7C — Docker Desktop Intel / Ventura certification preparation

Status: PREPARED_NOT_CERTIFIED. This change defines a host profile and a
read-only certification plan; it does not install Docker Desktop or alter
Sandy, Cloud, the historical Field, or the signed SurfJudging release.

## Selected profile

- Host: Intel x86_64, macOS Ventura 13.7.8 (MacBookPro12,1), 8 GiB RAM.
- Runtime: Docker Desktop 4.48.0 (build 207573), Linux/amd64 containers.
- Installer: `Docker.dmg`, official URL recorded in
  `desktop/runtime-profiles/macos-intel-managed-docker-desktop-ventura.json`.
- Installer size: `611682395` bytes. SHA-256:
  `fac73a1edc91e6bce5a449e83e3d0b537f19df74c5f51af4705e479cf0d32515`.
  SHA-512:
  `555a7fa0b81e29a110a3a42c2e0b79fdebcd17daa6445830738253c478af9a9362a4b775d5c5058f87d1c6037d7e0e89b7b65c56c122bd739916eb2324539a5d`.
  Docker-controlled checksum metadata:
  `https://desktop.docker.com/mac/main/amd64/207573/checksums.txt`.
  Local SHA-256 matches the official checksum.
- Delivery: external verified installer (not redistributed in this repository).

Docker's official release notes date 4.48.0 to 2025-10-09 and state that
macOS 13 support ends with that release; 4.49.0 requires macOS 14. The same
release notes identify the Intel download/checksum links. Docker's Mac install
documentation requires at least 4 GiB RAM. These establish a candidate only;
they do not certify this Mac or its offline behavior.

## Required audit before any install

1. Obtain the official Intel DMG and its matching Docker checksum. Record URL,
   filename, byte size, download/build ID, SHA-256, SHA-512 if supplied.
2. Without opening the installer, inspect `codesign -dv`, Team ID, bundle ID,
   designated requirement, and Gatekeeper/notarization evidence. The builder
   inspection passed codesign verification: Developer ID Application: Docker
   Inc, Team ID `9BNSXJN65R`, bundle `com.docker.docker`, x86_64. Notarization
   remains NOT_INDEPENDENTLY_VERIFIED.
3. Inventory CLI, Compose, Engine VM, backend, helpers, credential helpers,
   plugins, firmware/resources, and generated socket paths. The actual Intel
   backend must be recorded, not inferred from Apple-silicon documentation.
4. Review Docker Desktop terms and determine whether use permits this field
   deployment. The installer remains external if redistribution is unclear.

## Offline first-run certification (procedure only)

On the clean Sandy target, after an independently approved installation:

- capture a clean baseline and establish an enforced Internet block while LAN/SSH
  remains available;
- launch Docker Desktop 4.48.0 and record every prompt/download attempt;
- configure 2 CPUs and 3 GiB RAM (4 GiB ceiling), Kubernetes off, extensions off,
  update checks off where supported, analytics off, and no registry pulls;
- prove the engine reaches ready state offline, `docker info` reports linux/amd64,
  and the Docker socket path is stable;
- only then run the approved SurfJudging offline certification payload and checks.

Mandatory gates: no hidden VM/image download, no account/license network gate,
no unexpected update, no Rosetta requirement on Intel, and no mutation of legacy
Field data. Any failed gate stops certification before importing images.

## Static package evidence

The mounted DMG contains Docker CLI, Compose, credential helpers, CLI plugins,
`com.docker.hyperkit`, LinuxKit kernel/boot image, and `componentsVersion.json`
(Docker Engine/CLI 28.5.1, Compose 2.40.0, Linux 6.10.14). This is static
evidence only; the runtime backend and offline readiness remain uncertified.

## Resource and status decision

8 GiB RAM is compatible with Docker's documented 4 GiB minimum, but leaves a
small headroom for Postgres, Realtime, browser and operator tooling. The 3 GiB
target is therefore provisional and must be measured on Sandy; 4 GiB is the
hard ceiling for this profile. Certification remains **PREPARED_NOT_CERTIFIED**.

Final status: P3.7C Docker Desktop Ventura prep = PREPARED; installation,
certification, Cloud changes, Field changes, and P3.8 are not authorized.
