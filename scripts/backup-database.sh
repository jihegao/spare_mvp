#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/runs/system-start"
DATABASE_PATH="${DATABASE_PATH:-$RUN_DIR/spare_mvp.sqlite3}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/runs/database-backups}"
BACKUP_LABEL="${BACKUP_LABEL:-}"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/backup-database.sh [--database PATH] [--backup-dir DIR] [--label LABEL]

Backs up the file-backed spare_mvp SQLite database.
Defaults:
  database:   runs/system-start/spare_mvp.sqlite3
  backup dir: runs/database-backups
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database)
      DATABASE_PATH="${2:-}"
      shift 2
      ;;
    --backup-dir)
      BACKUP_DIR="${2:-}"
      shift 2
      ;;
    --label)
      BACKUP_LABEL="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$DATABASE_PATH" || -z "$BACKUP_DIR" ]]; then
  usage
  exit 2
fi

if [[ ! -f "$DATABASE_PATH" ]]; then
  echo "Database not found: $DATABASE_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
safe_label="$(printf '%s' "$BACKUP_LABEL" | tr -c 'A-Za-z0-9_.-' '-' | sed -E 's/-+/-/g; s/^-|-$//g')"
label_suffix=""
if [[ -n "$safe_label" ]]; then
  label_suffix="-$safe_label"
fi
backup_path="$BACKUP_DIR/spare_mvp-$timestamp$label_suffix.sqlite3"

if [[ -e "$backup_path" ]]; then
  backup_path="$BACKUP_DIR/spare_mvp-$timestamp$label_suffix-$$.sqlite3"
fi

python3 - "$DATABASE_PATH" "$backup_path" <<'PY'
import os
import sqlite3
import sys
import urllib.parse

source_path = os.path.abspath(sys.argv[1])
backup_path = os.path.abspath(sys.argv[2])

source_uri = "file:" + urllib.parse.quote(source_path) + "?mode=ro"
source = sqlite3.connect(source_uri, uri=True)
try:
    destination = sqlite3.connect(backup_path)
    try:
        source.backup(destination)
        destination.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        destination.commit()
        check = destination.execute("PRAGMA quick_check").fetchone()
        if not check or check[0] != "ok":
            raise SystemExit(f"backup quick_check failed: {check[0] if check else 'no result'}")
    finally:
        destination.close()
finally:
    source.close()
PY

echo "Backup written: $backup_path"
