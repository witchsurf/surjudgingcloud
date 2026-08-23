# P3.7B — Clean Intel Mac Offline First-Install Certification

STATUS = BLOCKED at runtime provisioning gate (SSH sudo timestamp unavailable).

## Resume attempt — SSH (CURRENT)

REQUESTED TARGET = `sandylaraise@192.168.1.99`
SSH COMMAND = dedicated key `~/.ssh/surfjudging_p37b`, BatchMode
RESULT = **PASS** — hostname 192.168.1.99, macOS 13.7.8 (22H730), x86_64
TARGET ACCESS = PASS

## Clean target evidence

CLEAN MACHINE BASELINE = PASS
Docker = absent; Colima = absent; Homebrew = absent; Node/npm = absent.
Payload files = 13; free disk = 27 GiB; RAM = 8 GiB; Hypervisor support = 1.

RUNTIME PROVISIONING = BLOCKED: `sudo -n -v` returned
`sudo: a password is required`. Internet is reachable, but the approved
standard runtime provisioning path (Colima/Docker CLI installation) cannot
be completed non-interactively without a user password. No password was
requested, stored, or bypassed.

No offline boundary, image import, bootstrap, database, or service operation
was executed. The developer host was not used as a substitute.

## Superseded historical note

The earlier pre-credential entry stating `TARGET ACCESS = FAIL` is superseded
by the current SSH evidence above. Target access is now PASS. The current
blocker is specifically the non-interactive sudo gate.

REQUIRED MANUAL ACTION = execute the approved privileged runtime-provisioning
commands directly on the clean target after opening the target's local
interactive terminal (or otherwise make the sudo timestamp available to the
SSH session). Do not alter sudoers or provide the password to Codex.

TARGET REQUESTED:
MacBookPro12,1, macOS 13.7.8, Intel x86_64, 8 GB RAM, ~27 GiB free.

CURRENT CONTROLLABLE HOST (read-only check):
hostname = 192.168.1.100; macOS 26.6; x86_64; 64 GB RAM; Colima context.
This is the prepared developer environment, not the declared clean target.

CLEAN MACHINE BASELINE = NOT VERIFIED
TRANSFER INTEGRITY = PREVIOUSLY PASS (12/12 payload files, 7/7 archives)
RUNTIME PROVISIONING = NOT RUN ON TARGET
OFFLINE BOUNDARY = NOT RUN
IMAGE IMPORT = NOT RUN
IMAGE PULLS = 0 (this session)
FIRST INSTALL / MIGRATIONS / FINAL SCHEMA = NOT RUN
SOURCE == SERVED = NOT RUN
LOCAL DB / REALTIME / ADMIN / JUDGE / DISPLAY / PRIORITY / OVERLAY / LAN = NOT RUN
RESTART / MAC REBOOT / PERSISTENCE / BACKUP / RESTORE = NOT RUN
RESOURCE MEASUREMENTS = NOT RUN

No target Mac control channel, SSH session, remote desktop, or attached
runtime was provided. Executing these steps on the current host would
invalidate the clean-machine certification and risk mixing legacy state.

CLOUD MODIFIED = NO
HISTORICAL FIELD MODIFIED = NO
P3.7B = NOT RUN
P3.7 FULL PASS = NO
P3.8 AUTHORIZED = NO

Required continuation: run the procedure on the physical MacBookPro12,1
itself (or provide a genuinely isolated control channel), transfer the
payload, then record all mandatory offline/health/persistence evidence.

## Manual provisioning plan (prepared, not executed by Codex)

SELECTED TRANSITION RUNTIME = Colima 0.10.3 + Docker CLI 29.0.1 x86_64;
QEMU/Lima are required for Ventura Intel Hypervisor.Framework transition.
Docker Desktop is not required. Homebrew is used only for QEMU/Lima because
their coordinated Ventura-compatible dependencies are not otherwise proven
on this target; Docker CLI and Colima are installed as versioned user-local
artifacts. The commands record SHA-256/version evidence and do not touch
SurfJudging images or databases.

Manual command block:

```sh
set -e
mkdir -p "$HOME/bin" "$HOME/Desktop/p3.7b-runtime-evidence"
export PATH="$HOME/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Runtime dependency only; no SurfJudging image is pulled.
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install qemu lima

# Versioned user-local Docker CLI for Intel macOS.
curl -fL https://download.docker.com/mac/static/stable/x86_64/docker-29.0.1.tgz -o "$HOME/Desktop/p3.7b-runtime-evidence/docker-29.0.1.tgz"
tar -xzf "$HOME/Desktop/p3.7b-runtime-evidence/docker-29.0.1.tgz" -C "$HOME/bin" --strip-components=1 docker/docker
curl -fL https://github.com/abiosoft/colima/releases/download/v0.10.3/colima-Darwin-x86_64 -o "$HOME/bin/colima"
chmod 755 "$HOME/bin/docker" "$HOME/bin/colima"

docker --version | tee "$HOME/Desktop/p3.7b-runtime-evidence/docker-version.txt"
colima version | tee "$HOME/Desktop/p3.7b-runtime-evidence/colima-version.txt"
brew list --versions qemu lima | tee "$HOME/Desktop/p3.7b-runtime-evidence/qemu-lima-versions.txt"
shasum -a 256 "$HOME/Desktop/p3.7b-runtime-evidence/docker-29.0.1.tgz" "$HOME/bin/colima" | tee "$HOME/Desktop/p3.7b-runtime-evidence/artifact-sha256.txt"

colima start --runtime docker --vm-type qemu --cpu 2 --memory 4 --disk 20 --arch x86_64
docker context show
docker version
docker image ls
```

Expected gate: Docker/Colima available, zero SurfJudging images, zero
SurfJudging containers. Stop and report if Homebrew/sudo fails or Colima
cannot start on Ventura 13.7.8. Do not proceed to offline boundary here.
