#!/bin/bash
set -euo pipefail

echo "======================================"
echo "  SURF JUDGING VM CLEANUP"
echo "======================================"
echo ""

echo ">>> Disk usage before cleanup"
df -h
echo ""

echo ">>> Docker space before cleanup"
docker system df || true
echo ""

echo ">>> Removing stopped containers"
docker container prune -f || true
echo ""

echo ">>> Removing dangling images"
docker image prune -f || true
echo ""

echo ">>> Removing unused build cache"
docker builder prune -af || true
echo ""

echo ">>> Removing unused networks"
docker network prune -f || true
echo ""

echo ">>> Docker space after cleanup"
docker system df || true
echo ""

echo ">>> Disk usage after cleanup"
df -h
echo ""

echo "Cleanup completed."
