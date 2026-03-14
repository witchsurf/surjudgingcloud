#!/bin/bash
set -euo pipefail

echo "======================================"
echo "  SURF JUDGING VM NETWORK DIAGNOSTICS"
echo "======================================"
echo ""

echo ">>> Host identity"
hostname || true
hostname -I 2>/dev/null || true
echo ""

if command -v ip >/dev/null 2>&1; then
  echo ">>> Interfaces"
  ip -brief addr || true
  echo ""

  echo ">>> Routes"
  ip route || true
  echo ""

  echo ">>> Route to public Internet"
  ip route get 1.1.1.1 || true
  echo ""
fi

if command -v nmcli >/dev/null 2>&1; then
  echo ">>> NetworkManager devices"
  nmcli device status || true
  echo ""
fi

echo ">>> SSH listener"
ss -ltnp 2>/dev/null | grep ':22 ' || echo "No SSH listener found on port 22"
echo ""

if command -v systemctl >/dev/null 2>&1; then
  echo ">>> OpenSSH service"
  systemctl --no-pager --full status ssh 2>/dev/null || systemctl --no-pager --full status sshd 2>/dev/null || true
  echo ""
fi

echo ">>> Surf Judging ports"
ss -ltnp 2>/dev/null | grep -E ':(8000|8080)\b' || echo "Ports 8000/8080 not currently listening"
echo ""

echo ">>> Resolver configuration"
cat /etc/resolv.conf 2>/dev/null || true
echo ""

echo "Recommendations:"
echo "1. Keep a single bridged NIC active for the VM when possible."
echo "2. Avoid switching the Mac between Wi-Fi networks during a deployment."
echo "3. If the VM advertises a new IP, always redeploy using that exact address."
echo "4. If SSH disappears but Docker ports stay up, inspect the VM bridge/NAT mode first."
