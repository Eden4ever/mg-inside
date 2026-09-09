#!/usr/bin/env bash
set -euo pipefail
case "${RENEWED_LINEAGE:-}" in
  /etc/letsencrypt/live/desktop.meta-gravity.com|/etc/letsencrypt/live/identity.meta-gravity.com)
    nginx -t
    systemctl reload nginx
    ;;
esac
