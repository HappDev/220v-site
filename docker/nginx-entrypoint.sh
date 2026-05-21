#!/bin/sh
set -eu

HTPASSWD_FILE="/etc/nginx/admin.htpasswd"

if [ -n "${ADMIN_BASIC_USER:-}" ] && [ -n "${ADMIN_BASIC_PASSWORD:-}" ]; then
  htpasswd -bcB "$HTPASSWD_FILE" "$ADMIN_BASIC_USER" "$ADMIN_BASIC_PASSWORD" >/dev/null
else
  printf '%s\n' "admin:disabled" > "$HTPASSWD_FILE"
  echo "WARN: ADMIN_BASIC_USER/ADMIN_BASIC_PASSWORD are not set; /admin/redis is inaccessible."
fi

exec /docker-entrypoint.sh "$@"
