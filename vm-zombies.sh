#!/bin/bash
set -euo pipefail

echo "======================================"
echo "  SURF JUDGING ZOMBIE DIAGNOSTICS"
echo "======================================"
echo ""

if ! command -v ps >/dev/null 2>&1; then
  echo "ps command not available."
  exit 1
fi

ZOMBIES=$(ps -eo pid=,ppid=,stat=,comm=,args= | awk '$3 ~ /^Z/ { print }')

if [ -z "$ZOMBIES" ]; then
  echo "No zombie processes found."
  exit 0
fi

echo ">>> Zombie processes"
echo "$ZOMBIES"
echo ""

echo ">>> Grouped by parent PID"
echo "$ZOMBIES" | awk '{ count[$2]++ } END { for (ppid in count) print ppid, count[ppid] }' | sort -k2 -nr
echo ""

TOP_PPID=$(echo "$ZOMBIES" | awk '{ count[$2]++ } END { max=0; top=""; for (ppid in count) if (count[ppid] > max) { max=count[ppid]; top=ppid } print top }')

if [ -n "${TOP_PPID:-}" ]; then
  echo ">>> Worst parent process: PPID $TOP_PPID"
  ps -fp "$TOP_PPID" || true
  echo ""

  if command -v pstree >/dev/null 2>&1; then
    echo ">>> Process tree"
    pstree -aps "$TOP_PPID" || true
    echo ""
  fi
fi

echo "Recommendation:"
echo "1. Identify the recurring parent PID."
echo "2. Restart only that service/process instead of rebooting the VM."
echo "3. If the parent is a containerized process, restart the container."
