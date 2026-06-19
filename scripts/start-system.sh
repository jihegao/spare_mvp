#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-start}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-4173}"
CONTRACT_PORT="${CONTRACT_PORT:-8521}"
RUN_DIR="$ROOT_DIR/runs/system-start"
DATABASE_PATH="${DATABASE_PATH:-$RUN_DIR/spare_mvp.sqlite3}"

APP_PY="$ROOT_DIR/.abm-mesa-test-env/bin/python"
CONTRACT_PY="$ROOT_DIR/.abm-mesa-env/bin/python"

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

require_executable() {
  local path="$1"
  if [[ ! -x "$path" ]]; then
    echo "Missing executable: $path" >&2
    exit 1
  fi
}

stop_system() {
  stop_port "$APP_PORT"
  stop_port "$CONTRACT_PORT"
  rm -f "$RUN_DIR/app.pid" "$RUN_DIR/contract.pid"
}

start_system() {
  require_executable "$APP_PY"
  require_executable "$CONTRACT_PY"
  mkdir -p "$RUN_DIR"

  stop_system

  echo "Starting spare_mvp app on http://$HOST:$APP_PORT/front/"
  pushd "$ROOT_DIR" >/dev/null
  nohup "$APP_PY" -m src.spare_mvp_backend.http_server --host "$HOST" --port "$APP_PORT" --database "$DATABASE_PATH" >"$RUN_DIR/app.log" 2>&1 &
  APP_PID="$!"
  popd >/dev/null
  echo "$APP_PID" >"$RUN_DIR/app.pid"

  echo "Starting Mesa contract provider on http://$HOST:$CONTRACT_PORT"
  pushd "$ROOT_DIR" >/dev/null
  nohup "$CONTRACT_PY" src/spare_mvp_abm/contract_server.py --host "$HOST" --port "$CONTRACT_PORT" >"$RUN_DIR/contract.log" 2>&1 &
  CONTRACT_PID="$!"
  popd >/dev/null
  echo "$CONTRACT_PID" >"$RUN_DIR/contract.pid"

  sleep 1

  echo "App PID: $APP_PID"
  echo "Contract PID: $CONTRACT_PID"
  echo "Database: $DATABASE_PATH"
  echo "Open: http://$HOST:$APP_PORT/front/"
  echo "Health: http://$HOST:$CONTRACT_PORT/health"
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
