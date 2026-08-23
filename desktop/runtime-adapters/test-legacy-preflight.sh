#!/bin/sh
set -eu
ROOT=${1:-"$HOME/.sj-legacy-test"}
case "$ROOT" in "$HOME/.sj-legacy-test"*) ;; *) echo 'FAIL unsafe root'; exit 1;; esac
[ "$(uname -s)" = Darwin ] || { echo 'FAIL host OS'; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo 'FAIL host arch'; exit 1; }
echo 'LEGACY PREFLIGHT = BLOCKED: no certified self-contained engine payload'
exit 1
