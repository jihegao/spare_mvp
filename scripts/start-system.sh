#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-start}"
if [[ $# -gt 0 ]]; then
  shift
fi
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-4173}"
RUN_DIR="$ROOT_DIR/runs/system-start"
DATABASE_PATH="${DATABASE_PATH:-$RUN_DIR/spare_mvp.sqlite3}"

APP_PY="$ROOT_DIR/.abm-mesa-test-env/bin/python"

usage() {
  echo "Usage: $0 [start|stop|restart]" >&2
}

while [[ $# -gt 0 ]]; do
  usage
  exit 2
  shift
done

stop_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    echo "No listener on port $port"
    return
  fi

  echo "Stopping listener(s) on port $port: $pids"
  kill $pids
  sleep 1
}

wait_for_port() {
  local port="$1"
  local label="$2"
  for _ in {1..30}; do
    if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return
    fi
    sleep 0.5
  done
  echo "$label did not start listening on port $port" >&2
  exit 1
}

require_executable() {
  local path="$1"
  if [[ ! -x "$path" ]]; then
    echo "Missing executable: $path" >&2
    exit 1
  fi
}

start_detached() {
  local launcher_python="$1"
  local log_path="$2"
  shift 2
  "$launcher_python" - "$ROOT_DIR" "$log_path" "$@" <<'PY'
import subprocess
import sys

cwd = sys.argv[1]
log_path = sys.argv[2]
cmd = sys.argv[3:]
log = open(log_path, "ab")
process = subprocess.Popen(
    cmd,
    cwd=cwd,
    stdin=subprocess.DEVNULL,
    stdout=log,
    stderr=subprocess.STDOUT,
    close_fds=True,
    start_new_session=True,
)
print(process.pid)
PY
}

stop_app() {
  stop_port "$APP_PORT"
  rm -f "$RUN_DIR/app.pid"
}

stop_start_targets() {
  stop_app
}

stop_system() {
  stop_app
}

start_system() {
  require_executable "$APP_PY"
  mkdir -p "$RUN_DIR"

  if [[ "${SKIP_INITIAL_STOP:-0}" != "1" ]]; then
    stop_start_targets
  fi

  echo "Starting spare_mvp app on http://$HOST:$APP_PORT/front/"
  APP_PID="$(start_detached "$APP_PY" "$RUN_DIR/app.log" "$APP_PY" -m src.spare_mvp_backend.http_server --host "$HOST" --port "$APP_PORT" --database "$DATABASE_PATH")"
  echo "$APP_PID" >"$RUN_DIR/app.pid"

  wait_for_port "$APP_PORT" "spare_mvp app"

  echo "App PID: $APP_PID"
  echo "Database: $DATABASE_PATH"
  echo "Open: http://$HOST:$APP_PORT/front/"
}

case "$MODE" in
  start)
    start_system
    ;;
  stop)
    stop_system
    ;;
  restart)
    stop_start_targets
    SKIP_INITIAL_STOP=1
    start_system
    ;;
  *)
    usage
    exit 2
    ;;
esac
