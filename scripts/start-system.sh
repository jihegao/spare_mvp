#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-start}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-4173}"
CONTRACT_PORT="${CONTRACT_PORT:-8521}"
INDEPENDENT_MESA_PORT="${INDEPENDENT_MESA_PORT:-8765}"
RUN_DIR="$ROOT_DIR/runs/system-start"
DATABASE_PATH="${DATABASE_PATH:-$RUN_DIR/spare_mvp.sqlite3}"

APP_PY="$ROOT_DIR/.abm-mesa-test-env/bin/python"
CONTRACT_PY="$ROOT_DIR/.abm-mesa-test-env/bin/python"
INDEPENDENT_MESA_PY="$ROOT_DIR/.abm-mesa-test-env/bin/python"

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

stop_system() {
  stop_port "$APP_PORT"
  stop_port "$CONTRACT_PORT"
  stop_port "$INDEPENDENT_MESA_PORT"
  rm -f "$RUN_DIR/app.pid" "$RUN_DIR/contract.pid" "$RUN_DIR/independent-mesa.pid"
}

start_system() {
  require_executable "$APP_PY"
  require_executable "$CONTRACT_PY"
  require_executable "$INDEPENDENT_MESA_PY"
  mkdir -p "$RUN_DIR"

  stop_system

  echo "Starting spare_mvp app on http://$HOST:$APP_PORT/front/"
  APP_PID="$(start_detached "$APP_PY" "$RUN_DIR/app.log" "$APP_PY" -m src.spare_mvp_backend.http_server --host "$HOST" --port "$APP_PORT" --database "$DATABASE_PATH")"
  echo "$APP_PID" >"$RUN_DIR/app.pid"

  echo "Starting Mesa contract provider on http://$HOST:$CONTRACT_PORT"
  CONTRACT_PID="$(start_detached "$CONTRACT_PY" "$RUN_DIR/contract.log" "$CONTRACT_PY" src/spare_mvp_abm/contract_server.py --host "$HOST" --port "$CONTRACT_PORT")"
  echo "$CONTRACT_PID" >"$RUN_DIR/contract.pid"

  echo "Starting independent Mesa scheme launcher on http://$HOST:$INDEPENDENT_MESA_PORT"
  INDEPENDENT_MESA_PID="$(start_detached "$INDEPENDENT_MESA_PY" "$RUN_DIR/independent-mesa.log" "$INDEPENDENT_MESA_PY" independent-mesa/server.py --host "$HOST" --port "$INDEPENDENT_MESA_PORT")"
  echo "$INDEPENDENT_MESA_PID" >"$RUN_DIR/independent-mesa.pid"

  wait_for_port "$APP_PORT" "spare_mvp app"
  wait_for_port "$CONTRACT_PORT" "Mesa contract provider"
  wait_for_port "$INDEPENDENT_MESA_PORT" "independent Mesa scheme launcher"

  echo "App PID: $APP_PID"
  echo "Contract PID: $CONTRACT_PID"
  echo "Independent Mesa PID: $INDEPENDENT_MESA_PID"
  echo "Database: $DATABASE_PATH"
  echo "Open: http://$HOST:$APP_PORT/front/"
  echo "Health: http://$HOST:$CONTRACT_PORT/health"
  echo "Schemes: http://$HOST:$INDEPENDENT_MESA_PORT/"
}

case "$MODE" in
  start)
    start_system
    ;;
  stop)
    stop_system
    ;;
  restart)
    stop_system
    start_system
    ;;
  *)
    echo "Usage: $0 [start|stop|restart]" >&2
    exit 2
    ;;
esac
