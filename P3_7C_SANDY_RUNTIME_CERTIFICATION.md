# P3.7C — Sandy Docker Desktop runtime-only certification

Status: BLOCKED at the documented privileged installation gate. No Docker
Desktop, SurfJudging image, database, migration, Cloud or historical Field
was modified.

## Pre-install baseline (read-only, 2026-08-16)

- Target: `sandylaraise@192.168.1.99`, MacBookPro12,1
- macOS 13.7.8 (22H730), `x86_64`
- RAM: 8 GiB; root disk: 113 GiB total, 21 GiB used, 24 GiB available
- `/Applications/Docker.app`: ABSENT
- Docker CLI/daemon: ABSENT
- `~/.docker`: ABSENT
- containers/images/volumes: not applicable (Docker absent)

## Gate

`sudo -n -v` over the dedicated non-interactive SSH channel returned:
`sudo: a password is required`. Therefore installation cannot be performed
non-interactively. The exact manual gate is to install the verified official
`Docker.dmg` (SHA-256
`fac73a1edc91e6bce5a449e83e3d0b537f19df74c5f51af4705e479cf0d32515`) using a
local graphical/admin session, then confirm Docker Desktop is installed and
engine-ready. No password was requested or stored by Codex.

## Certification status

INSTALLER IDENTITY: VERIFIED
INSTALL: NOT RUN (privileged gate)
FIRST START OFFLINE: NOT RUN
DOCKER DAEMON READY: NOT RUN
LOCAL OFFLINE TESTS: NOT RUN
SECOND START OFFLINE: NOT RUN
RESOURCE BUDGET: PRECHECK PASS; post-install measurement pending
PROFILE CERTIFIED: NO
SURFJUDGING INSTALLED: NO
SIGNED RELEASE REBUILT: NO
CLOUD MODIFIED: NO
FIELD MODIFIED: NO
P3.7 FULL PASS: NO
P3.8 AUTHORIZED: NO
