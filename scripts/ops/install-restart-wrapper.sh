#!/bin/bash
# Installer for the Paperclip restart wrapper (ORA-2743).
#
# Run once as root on the harness host:
#     sudo bash scripts/ops/install-restart-wrapper.sh
#
# It installs the restart wrapper + its NOPASSWD sudoers snippet, validating
# the sudoers file with `visudo -c` BEFORE it can take effect so a malformed
# drop-in can never lock you out of sudo.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER_SRC="$SRC_DIR/mc-restart-paperclip"
SUDOERS_SRC="$SRC_DIR/sudoers.d/mc-restart-paperclip"

WRAPPER_DST="/usr/local/bin/mc-restart-paperclip"
SUDOERS_DST="/etc/sudoers.d/mc-restart-paperclip"

if [ "$(id -u)" -ne 0 ]; then
  echo "install-restart-wrapper: must run as root (try: sudo bash $0)" >&2
  exit 1
fi

for f in "$WRAPPER_SRC" "$SUDOERS_SRC"; do
  [ -f "$f" ] || { echo "install-restart-wrapper: missing source file: $f" >&2; exit 1; }
done

# 1) Install the wrapper: root-owned, world-executable, not writable by others.
install -m 0755 -o root -g root "$WRAPPER_SRC" "$WRAPPER_DST"

# 2) Stage + validate the sudoers snippet in a temp file. visudo -c is the gate:
#    only an already-valid snippet is moved into /etc/sudoers.d, so a syntax
#    error aborts here and the live sudoers state is left untouched.
TMP_SUDOERS="$(mktemp)"
trap 'rm -f "$TMP_SUDOERS"' EXIT
install -m 0440 -o root -g root "$SUDOERS_SRC" "$TMP_SUDOERS"

if ! visudo -c -f "$TMP_SUDOERS" >/dev/null; then
  echo "install-restart-wrapper: sudoers validation FAILED; not installing." >&2
  exit 1
fi

install -m 0440 -o root -g root "$TMP_SUDOERS" "$SUDOERS_DST"

# 3) Final full-config sanity check now that the drop-in is in place.
if ! visudo -c >/dev/null; then
  echo "install-restart-wrapper: post-install sudoers check FAILED; removing drop-in." >&2
  rm -f "$SUDOERS_DST"
  exit 1
fi

printf '\033[32mOK\033[0m wrapper installed:\n'
printf '  %s (0755 root:root)\n' "$WRAPPER_DST"
printf '  %s (0440 root:root)\n' "$SUDOERS_DST"
printf 'Verify: sudo -n -l | grep mc-restart-paperclip\n'
