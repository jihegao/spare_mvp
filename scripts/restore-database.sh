#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/runs/system-start"
DATABASE_PATH="${DATABASE_PATH:-$RUN_DIR/spare_mvp.sqlite3}"
FORCE=0
BACKUP_PATH=""

usage() {
  cat >&2 <<'EOF'
Usage: scripts/restore-database.sh --force [--database PATH] BACKUP_FILE

Restores a spare_mvp SQLite database backup.
Stop the local system before restoring:
  npm run stop:system

Defaults:
  database: runs/system-start/spare_mvp.sqlite3
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database)
      DATABASE_PATH="${2:-}"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$BACKUP_PATH" ]]; then
        usage
        exit 2
      fi
      BACKUP_PATH="$1"
      shift
      ;;
  esac
done

if [[ -z "$DATABASE_PATH" || -z "$BACKUP_PATH" ]]; then
  usage
  exit 2
fi

if [[ ! -f "$BACKUP_PATH" ]]; then
  echo "Backup not found: $BACKUP_PATH" >&2
  exit 1
fi

if [[ -e "$DATABASE_PATH" && "$FORCE" != "1" ]]; then
  echo "Refusing to overwrite $DATABASE_PATH without --force" >&2
  exit 1
fi

python3 - "$BACKUP_PATH" <<'PY'
import os
import sqlite3
import sys
import urllib.parse

backup_path = os.path.abspath(sys.argv[1])
backup_uri = "file:" + urllib.parse.quote(backup_path) + "?mode=ro"
connection = sqlite3.connect(backup_uri, uri=True)
try:
    check = connection.execute("PRAGMA quick_check").fetchone()
    if not check or check[0] != "ok":
        raise SystemExit(f"backup quick_check failed: {check[0] if check else 'no result'}")
finally:
    connection.close()
PY

mkdir -p "$(dirname "$DATABASE_PATH")"
temp_path="$DATABASE_PATH.restore.$$"
cp "$BACKUP_PATH" "$temp_path"
mv "$temp_path" "$DATABASE_PATH"
rm -f "$DATABASE_PATH-wal" "$DATABASE_PATH-shm"

echo "Database restored: $DATABASE_PATH"
