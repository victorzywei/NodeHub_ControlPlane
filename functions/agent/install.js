const script = `#!/usr/bin/env bash
set -euo pipefail

API_BASE=""
NODE_ID=""
NODE_TOKEN=""
TLS_DOMAIN=""
HEARTBEAT_INTERVAL=15
RECONCILE_INTERVAL=15
STATE_DIR="/var/lib/nodehub-agent"
AGENT_ROOT="/usr/local/lib/nodehub-agent"
CONFIG_ROOT="/etc/nodehub-agent"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-base) API_BASE="$2"; shift 2 ;;
    --node-id) NODE_ID="$2"; shift 2 ;;
    --node-token) NODE_TOKEN="$2"; shift 2 ;;
    --tls-domain) TLS_DOMAIN="$2"; shift 2 ;;
    --heartbeat-interval) HEARTBEAT_INTERVAL="$2"; shift 2 ;;
    --reconcile-interval) RECONCILE_INTERVAL="$2"; shift 2 ;;
    --state-dir) STATE_DIR="$2"; shift 2 ;;
    --agent-root) AGENT_ROOT="$2"; shift 2 ;;
    --config-root) CONFIG_ROOT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$API_BASE" || -z "$NODE_ID" || -z "$NODE_TOKEN" ]]; then
  echo "Missing required args: --api-base --node-id --node-token" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required (systemd supervisor)" >&2
  exit 1
fi

mkdir -p "$STATE_DIR" "$AGENT_ROOT" "$CONFIG_ROOT"
chmod 700 "$STATE_DIR" "$AGENT_ROOT" "$CONFIG_ROOT"

CONFIG_FILE="$CONFIG_ROOT/config.env"
RUNNER_SCRIPT="$AGENT_ROOT/agent-runner.sh"
HEARTBEAT_SERVICE="/etc/systemd/system/nodehub-heartbeat.service"
RECONCILE_SERVICE="/etc/systemd/system/nodehub-reconcile.service"

cat > "$CONFIG_FILE" <<EOF
API_BASE="$API_BASE"
NODE_ID="$NODE_ID"
NODE_TOKEN="$NODE_TOKEN"
TLS_DOMAIN="$TLS_DOMAIN"
HEARTBEAT_INTERVAL="$HEARTBEAT_INTERVAL"
RECONCILE_INTERVAL="$RECONCILE_INTERVAL"
STATE_DIR="$STATE_DIR"
EOF
chmod 600 "$CONFIG_FILE"

cat > "$RUNNER_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -u

MODE="$1"
CONFIG_FILE="/etc/nodehub-agent/config.env"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "config file missing: $CONFIG_FILE" >&2
  exit 1
fi

# shellcheck source=/etc/nodehub-agent/config.env
source "$CONFIG_FILE"

EVENTS_FILE="$STATE_DIR/pending-events.jsonl"
VERSION_FILE="$STATE_DIR/current-version"
APPLY_HOOK="/usr/local/lib/nodehub-agent/hooks/apply.sh"

mkdir -p "$STATE_DIR"
touch "$EVENTS_FILE"
if [[ ! -f "$VERSION_FILE" ]]; then
  echo "0" > "$VERSION_FILE"
fi

read_current_version() {
  if [[ ! -f "$VERSION_FILE" ]]; then
    echo "0"
    return
  fi

  local raw
  raw="$(tr -d '\\r\\n' < "$VERSION_FILE")"
  if [[ "$raw" =~ ^[0-9]+$ ]]; then
    echo "$raw"
    return
  fi

  echo "0"
}

json_number_field() {
  local key="$1"
  local payload="$2"
  echo "$payload" | tr -d '\\r\\n' | grep -o "\"$key\":[0-9][0-9]*" | head -n 1 | grep -o "[0-9][0-9]*"
}

json_bool_field() {
  local key="$1"
  local payload="$2"
  if echo "$payload" | tr -d '\\r\\n' | grep -q "\"$key\":true"; then
    echo "true"
    return
  fi
  echo "false"
}

generate_event_id() {
  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid
    return
  fi
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr 'A-Z' 'a-z'
    return
  fi
  date +%s%N
}

enqueue_apply_event() {
  local status="$1"
  local version="$2"
  local message="$3"
  local now
  local event_id
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  event_id="$(generate_event_id)"
  printf '{"event_id":"%s","type":"apply_result","status":"%s","applied_version":%s,"message":"%s","occurred_at":"%s"}\\n' \
    "$event_id" "$status" "$version" "$message" "$now" >> "$EVENTS_FILE"
}

flush_pending_events() {
  if [[ ! -s "$EVENTS_FILE" ]]; then
    return 0
  fi

  local event_rows
  event_rows="$(awk 'NF { if (c++ > 0) printf(","); printf("%s", $0) } END { print "" }' "$EVENTS_FILE")"
  if [[ -z "$event_rows" ]]; then
    return 0
  fi

  local payload
  payload="{\\\"node_id\\\":\\\"$NODE_ID\\\",\\\"events\\\":[$event_rows]}"

  if curl -fsS --max-time 15 -X POST "$API_BASE/agent/events" \
    -H "X-Node-Token: $NODE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload" >/dev/null; then
    : > "$EVENTS_FILE"
    return 0
  fi

  return 1
}

apply_target_version() {
  local target_version="$1"

  if [[ -x "$APPLY_HOOK" ]]; then
    if ! "$APPLY_HOOK" "$target_version"; then
      enqueue_apply_event "failed" "$target_version" "release apply failed"
      return 1
    fi
  fi

  if echo "$target_version" > "$VERSION_FILE"; then
    enqueue_apply_event "ok" "$target_version" "release applied"
    return 0
  fi

  enqueue_apply_event "failed" "$target_version" "release apply failed"
  return 1
}

reconcile_once() {
  local current_version
  local response
  local desired_version
  local needs_update

  current_version="$(read_current_version)"

  response="$(curl -fsS --max-time 15 "$API_BASE/agent/reconcile?node_id=$NODE_ID&current_version=$current_version" \
    -H "X-Node-Token: $NODE_TOKEN")" || return 1

  desired_version="$(json_number_field "desired_version" "$response")"
  needs_update="$(json_bool_field "needs_update" "$response")"

  if [[ "$needs_update" != "true" ]]; then
    return 0
  fi

  if [[ -z "$desired_version" ]]; then
    return 1
  fi

  if [[ "$desired_version" -le "$current_version" ]]; then
    return 0
  fi

  apply_target_version "$desired_version"
}

heartbeat_loop() {
  while true; do
    curl -fsS --max-time 10 "$API_BASE/agent/heartbeat?node_id=$NODE_ID" \
      -H "X-Node-Token: $NODE_TOKEN" >/dev/null || true
    sleep "$HEARTBEAT_INTERVAL"
  done
}

reconcile_loop() {
  while true; do
    flush_pending_events || true
    reconcile_once || true
    sleep "$RECONCILE_INTERVAL"
  done
}

case "$MODE" in
  heartbeat)
    heartbeat_loop
    ;;
  reconcile)
    reconcile_loop
    ;;
  *)
    echo "unknown mode: $MODE" >&2
    exit 1
    ;;
esac
EOF

chmod 700 "$RUNNER_SCRIPT"

cat > "$HEARTBEAT_SERVICE" <<EOF
[Unit]
Description=NodeHub Heartbeat Loop
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$RUNNER_SCRIPT heartbeat
Restart=always
RestartSec=2
StartLimitIntervalSec=0

[Install]
WantedBy=multi-user.target
EOF

cat > "$RECONCILE_SERVICE" <<EOF
[Unit]
Description=NodeHub Reconcile Loop
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$RUNNER_SCRIPT reconcile
Restart=always
RestartSec=2
StartLimitIntervalSec=0

[Install]
WantedBy=multi-user.target
EOF

echo "NodeHub agent bootstrap"
echo "node_id=$NODE_ID"
echo "tls_domain=$TLS_DOMAIN"
echo "heartbeat_interval=$HEARTBEAT_INTERVAL"
echo "reconcile_interval=$RECONCILE_INTERVAL"
echo "state_dir=$STATE_DIR"
echo "agent_root=$AGENT_ROOT"

systemctl daemon-reload
systemctl enable --now nodehub-heartbeat.service
systemctl enable --now nodehub-reconcile.service
systemctl restart nodehub-heartbeat.service nodehub-reconcile.service

echo "Agent services installed:"
echo "- nodehub-heartbeat.service"
echo "- nodehub-reconcile.service"
echo "Check status with: systemctl status nodehub-heartbeat.service nodehub-reconcile.service --no-pager"
`

export async function onRequestGet() {
  return new Response(script, {
    status: 200,
    headers: {
      'Content-Type': 'text/x-shellscript; charset=utf-8',
      'Content-Disposition': 'inline; filename="nodehub-install.sh"',
    },
  })
}