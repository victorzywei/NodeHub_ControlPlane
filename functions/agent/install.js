const script = `#!/usr/bin/env bash
set -euo pipefail

API_BASE=""
NODE_ID=""
NODE_TOKEN=""
TLS_DOMAIN=""
TLS_DOMAIN_ALT=""
GITHUB_MIRROR=""
CF_API_TOKEN=""
HEARTBEAT_INTERVAL=600
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
    --tls-domain-alt) TLS_DOMAIN_ALT="$2"; shift 2 ;;
    --github-mirror) GITHUB_MIRROR="$2"; shift 2 ;;
    --cf-api-token) CF_API_TOKEN="$2"; shift 2 ;;
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

mkdir -p "$STATE_DIR" "$AGENT_ROOT" "$CONFIG_ROOT"
chmod 700 "$STATE_DIR" "$AGENT_ROOT" "$CONFIG_ROOT"

echo "Installing official Xray and Sing-box binaries..."
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)
    XRAY_ARCH="64"
    SINGBOX_ARCH="amd64"
    ;;
  aarch64|arm64)
    XRAY_ARCH="arm64-v8a"
    SINGBOX_ARCH="arm64"
    ;;
  *)
    echo "Warning: Unsupported CPU architecture for pre-compiled binaries: $ARCH. You may need to install Xray/Sing-box manually."
    XRAY_ARCH=""
    ;;
esac

if [[ -n "$XRAY_ARCH" ]]; then
  if ! command -v unzip >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
    echo "Attempting to install unzip and tar to extract binaries..."
    if command -v apt-get >/dev/null 2>&1; then apt-get update >/dev/null && apt-get install -y unzip tar >/dev/null; fi
    if command -v dnf >/dev/null 2>&1; then dnf install -y unzip tar >/dev/null; fi
    if command -v yum >/dev/null 2>&1; then yum install -y unzip tar >/dev/null; fi
  fi
  
  if ! command -v xray >/dev/null 2>&1 && [[ ! -x /usr/local/bin/xray ]]; then
    echo "Downloading latest Xray-core..."
    mkdir -p /tmp/nodehub-xray
    if curl -fsSL -o /tmp/xray.zip "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-\${XRAY_ARCH}.zip"; then
      unzip -q -o /tmp/xray.zip -d /tmp/nodehub-xray || true
      if [[ -f /tmp/nodehub-xray/xray ]]; then
        if command -v install >/dev/null 2>&1; then
          install -m 755 /tmp/nodehub-xray/xray /usr/local/bin/xray
          install -d -m 755 /usr/local/etc/xray /usr/local/share/xray /var/log/xray
          install -m 644 /tmp/nodehub-xray/geoip.dat /usr/local/share/xray/geoip.dat 2>/dev/null || true
          install -m 644 /tmp/nodehub-xray/geosite.dat /usr/local/share/xray/geosite.dat 2>/dev/null || true
        else
          mkdir -p /usr/local/etc/xray /usr/local/share/xray /var/log/xray
          chmod 755 /usr/local/etc/xray /usr/local/share/xray /var/log/xray 2>/dev/null || true
          mv /tmp/nodehub-xray/xray /usr/local/bin/xray
          chmod 755 /usr/local/bin/xray
          mv /tmp/nodehub-xray/geoip.dat /usr/local/share/xray/geoip.dat 2>/dev/null || true
          mv /tmp/nodehub-xray/geosite.dat /usr/local/share/xray/geosite.dat 2>/dev/null || true
          chmod 644 /usr/local/share/xray/geoip.dat /usr/local/share/xray/geosite.dat 2>/dev/null || true
        fi
        echo "Xray-core installed to /usr/local/bin/xray (FHS standard path)"
      else
        echo "Xray-core extraction failed."
      fi
    else
      echo "Failed to download Xray-core, please check network or run manually."
    fi
    rm -rf /tmp/xray.zip /tmp/nodehub-xray
  else
    echo "Xray-core is already installed."
  fi

  if ! command -v sing-box >/dev/null 2>&1 && [[ ! -x /usr/local/bin/sing-box ]]; then
    echo "Downloading latest sing-box..."
    SINGBOX_LATEST_URL=$(curl -w "%{url_effective}" -I -L -s -S "https://github.com/SagerNet/sing-box/releases/latest" -o /dev/null)
    SINGBOX_LATEST_TAG=$(echo "$SINGBOX_LATEST_URL" | grep -oE '[^/]+$')
    SINGBOX_VERSION=\${SINGBOX_LATEST_TAG#v}
    
    if [[ -n "$SINGBOX_VERSION" && "$SINGBOX_VERSION" != "latest" ]]; then
      SINGBOX_TAR="sing-box-\${SINGBOX_VERSION}-linux-\${SINGBOX_ARCH}.tar.gz"
      SINGBOX_URL="https://github.com/SagerNet/sing-box/releases/download/\${SINGBOX_LATEST_TAG}/\${SINGBOX_TAR}"
      if curl -fsSL -o /tmp/sing-box.tar.gz "$SINGBOX_URL"; then
        tar -xzf /tmp/sing-box.tar.gz -C /tmp/ || true
        if [[ -f "/tmp/sing-box-\${SINGBOX_VERSION}-linux-\${SINGBOX_ARCH}/sing-box" ]]; then
          if command -v install >/dev/null 2>&1; then
            install -m 755 "/tmp/sing-box-\${SINGBOX_VERSION}-linux-\${SINGBOX_ARCH}/sing-box" /usr/local/bin/sing-box
            install -d -m 755 /etc/sing-box /var/lib/sing-box /var/log/sing-box
          else
            mkdir -p /etc/sing-box /var/lib/sing-box /var/log/sing-box
            chmod 755 /etc/sing-box /var/lib/sing-box /var/log/sing-box 2>/dev/null || true
            mv "/tmp/sing-box-\${SINGBOX_VERSION}-linux-\${SINGBOX_ARCH}/sing-box" /usr/local/bin/sing-box
            chmod 755 /usr/local/bin/sing-box
          fi
          echo "sing-box installed to /usr/local/bin/sing-box (official standard path)"
        else
          echo "sing-box extraction failed."
        fi
      else
        echo "Failed to download sing-box (URL: $SINGBOX_URL), please check network."
      fi
      rm -rf /tmp/sing-box.tar.gz "/tmp/sing-box-\${SINGBOX_VERSION}-linux-\${SINGBOX_ARCH}"
    else
      echo "Failed to detect sing-box latest version."
    fi
  else
    echo "sing-box is already installed."
  fi
fi

CONFIG_FILE="$CONFIG_ROOT/config.env"
RUNNER_SCRIPT="$AGENT_ROOT/agent-runner.sh"
HEARTBEAT_SERVICE="/etc/systemd/system/nodehub-heartbeat.service"
RECONCILE_SERVICE="/etc/systemd/system/nodehub-reconcile.service"

cat > "$CONFIG_FILE" <<EOF
API_BASE="$API_BASE"
NODE_ID="$NODE_ID"
NODE_TOKEN="$NODE_TOKEN"
TLS_DOMAIN="$TLS_DOMAIN"
TLS_DOMAIN_ALT="$TLS_DOMAIN_ALT"
GITHUB_MIRROR="$GITHUB_MIRROR"
CF_API_TOKEN="$CF_API_TOKEN"
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
ERROR_FILE="$STATE_DIR/last-error.log"

mkdir -p "$STATE_DIR"
touch "$EVENTS_FILE"
touch "$ERROR_FILE"
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

trim_text() {
  printf '%s' "$1" | tr '\\r\\n\\t' '   '
}

json_escape() {
  printf '%s' "$1" | tr '\\r\\n\\t' '   ' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g'
}

set_last_error() {
  local message
  message="$(trim_text "$1")"
  printf '%s' "$message" > "$ERROR_FILE"
}

clear_last_error() {
  : > "$ERROR_FILE"
}

read_last_error() {
  if [[ ! -f "$ERROR_FILE" ]]; then
    echo ""
    return
  fi

  local message
  message="$(cat "$ERROR_FILE" 2>/dev/null || true)"
  trim_text "$message"
}

detect_protocol_app_version() {
  local cmd_timeout=""
  if command -v timeout >/dev/null 2>&1; then
    cmd_timeout="timeout 5"
  fi

  if command -v xray >/dev/null 2>&1; then
    $cmd_timeout xray version 2>/dev/null | head -n 1 | tr -d '\\r\\n' || true
    return
  fi

  if command -v sing-box >/dev/null 2>&1; then
    $cmd_timeout sing-box version 2>/dev/null | head -n 1 | tr -d '\\r\\n' || true
    return
  fi

  echo ""
}

cpu_usage_percent() {
  if [[ ! -r /proc/stat ]]; then
    echo "null"
    return
  fi

  local user1 nice1 system1 idle1 iowait1 irq1 softirq1 steal1
  local user2 nice2 system2 idle2 iowait2 irq2 softirq2 steal2
  read -r _ user1 nice1 system1 idle1 iowait1 irq1 softirq1 steal1 _ < /proc/stat || {
    echo "null"
    return
  }

  sleep 0.2

  read -r _ user2 nice2 system2 idle2 iowait2 irq2 softirq2 steal2 _ < /proc/stat || {
    echo "null"
    return
  }

  local total1 total2 idle_total1 idle_total2 total_delta idle_delta usage_x100
  total1=$((user1 + nice1 + system1 + idle1 + iowait1 + irq1 + softirq1 + steal1))
  total2=$((user2 + nice2 + system2 + idle2 + iowait2 + irq2 + softirq2 + steal2))
  idle_total1=$((idle1 + iowait1))
  idle_total2=$((idle2 + iowait2))
  total_delta=$((total2 - total1))
  idle_delta=$((idle_total2 - idle_total1))

  if [[ "$total_delta" -le 0 ]]; then
    echo "null"
    return
  fi

  usage_x100=$(( (10000 * (total_delta - idle_delta)) / total_delta ))
  awk "BEGIN { printf \\"%.2f\\", $usage_x100 / 100 }"
}

memory_stats() {
  if [[ ! -r /proc/meminfo ]]; then
    echo "null null null"
    return
  fi

  local total_kb available_kb used_kb used_mb total_mb usage_x100 usage_percent
  total_kb="$(awk '/MemTotal:/ { print $2 }' /proc/meminfo)"
  available_kb="$(awk '/MemAvailable:/ { print $2 }' /proc/meminfo)"

  if [[ -z "$total_kb" || -z "$available_kb" || "$total_kb" -le 0 ]]; then
    echo "null null null"
    return
  fi

  used_kb=$((total_kb - available_kb))
  if [[ "$used_kb" -lt 0 ]]; then
    used_kb=0
  fi

  used_mb=$((used_kb / 1024))
  total_mb=$((total_kb / 1024))
  usage_x100=$(( (10000 * used_kb) / total_kb ))
  usage_percent="$(awk "BEGIN { printf \\"%.2f\\", $usage_x100 / 100 }")"

  echo "$used_mb $total_mb $usage_percent"
}

build_heartbeat_payload() {
  local current_version deploy_info protocol_version error_message cpu_usage
  local memory_used memory_total memory_usage
  local deploy_json protocol_json error_json

  current_version="$(read_current_version)"
  deploy_info="applied_version=v$current_version"
  protocol_version="$(detect_protocol_app_version)"
  error_message="$(read_last_error)"
  cpu_usage="$(cpu_usage_percent)"
  read -r memory_used memory_total memory_usage <<< "$(memory_stats)"

  deploy_json="$(json_escape "$deploy_info")"
  protocol_json="$(json_escape "$protocol_version")"
  error_json="$(json_escape "$error_message")"

  echo "{\\"node_id\\":\\"$NODE_ID\\",\\"deploy_info\\":\\"$deploy_json\\",\\"protocol_app_version\\":\\"$protocol_json\\",\\"error_message\\":\\"$error_json\\",\\"cpu_usage_percent\\":$cpu_usage,\\"memory_used_mb\\":$memory_used,\\"memory_total_mb\\":$memory_total,\\"memory_usage_percent\\":$memory_usage}"
}

heartbeat_once() {
  local payload
  payload="$(build_heartbeat_payload)"

  if curl -fsS --max-time 15 -X POST "$API_BASE/agent/heartbeat" \\
    -H "X-Node-Token: $NODE_TOKEN" \\
    -H "Content-Type: application/json" \\
    -d "$payload" >/dev/null; then
    return 0
  fi

  set_last_error "heartbeat report failed"
  return 1
}

json_number_field() {
  local key="$1"
  local payload="$2"
  echo "$payload" | tr -d '\\r\\n' | grep -o "\\"$key\\":[0-9][0-9]*" | head -n 1 | grep -o "[0-9][0-9]*"
}

json_bool_field() {
  local key="$1"
  local payload="$2"
  if echo "$payload" | tr -d '\\r\\n' | grep -q "\\"$key\\":true"; then
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
  printf '{"event_id":"%s","type":"apply_result","status":"%s","applied_version":%s,"message":"%s","occurred_at":"%s"}\\n' \\
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
  payload="{\\"node_id\\":\\"$NODE_ID\\",\\"events\\":[$event_rows]}"

  if curl -fsS --max-time 15 -X POST "$API_BASE/agent/events" \\
    -H "X-Node-Token: $NODE_TOKEN" \\
    -H "Content-Type: application/json" \\
    -d "$payload" >/dev/null; then
    : > "$EVENTS_FILE"
    return 0
  fi

  set_last_error "pending events flush failed"
  return 1
}

apply_target_version() {
  local target_version="$1"

  if [[ -x "$APPLY_HOOK" ]]; then
    if ! "$APPLY_HOOK" "$target_version"; then
      set_last_error "release apply failed"
      enqueue_apply_event "failed" "$target_version" "release apply failed"
      return 1
    fi
  fi

  if echo "$target_version" > "$VERSION_FILE"; then
    enqueue_apply_event "ok" "$target_version" "release applied"
    clear_last_error
    return 0
  fi

  set_last_error "release apply failed"
  enqueue_apply_event "failed" "$target_version" "release apply failed"
  return 1
}

reconcile_once() {
  local current_version
  local response
  local desired_version
  local needs_update

  current_version="$(read_current_version)"

  response="$(curl -fsS --max-time 15 "$API_BASE/agent/reconcile?node_id=$NODE_ID&current_version=$current_version" \\
    -H "X-Node-Token: $NODE_TOKEN")" || {
    set_last_error "reconcile request failed"
    return 1
  }

  desired_version="$(json_number_field "desired_version" "$response")"
  needs_update="$(json_bool_field "needs_update" "$response")"

  if [[ "$needs_update" != "true" ]]; then
    clear_last_error
    return 0
  fi

  if [[ -z "$desired_version" ]]; then
    set_last_error "invalid reconcile response"
    return 1
  fi

  if [[ "$desired_version" -le "$current_version" ]]; then
    clear_last_error
    return 0
  fi

  apply_target_version "$desired_version"
}

heartbeat_loop() {
  while true; do
    heartbeat_once || true
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

watchdog_check() {
  start_service() {
    local sname="$1"
    if ! kill -0 "$(cat "$STATE_DIR/\${sname}.pid" 2>/dev/null)" 2>/dev/null; then
       nohup bash "$0" "$sname" > "$STATE_DIR/\${sname}.log" 2>&1 &
       echo $! > "$STATE_DIR/\${sname}.pid"
    fi
  }
  start_service "heartbeat"
  start_service "reconcile"
}

case "$MODE" in
  heartbeat)
    echo $$ > "$STATE_DIR/heartbeat.pid"
    heartbeat_loop
    ;;
  reconcile)
    echo $$ > "$STATE_DIR/reconcile.pid"
    reconcile_loop
    ;;
  cron_check)
    watchdog_check
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

USE_SYSTEMD=0
if command -v systemctl >/dev/null 2>&1 && systemctl | grep -q '\\-\\.mount' >/dev/null 2>&1; then
  USE_SYSTEMD=1
elif [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; then
  USE_SYSTEMD=1
fi

if [[ "$USE_SYSTEMD" -eq 1 ]]; then
  systemctl daemon-reload
  systemctl enable --now nodehub-heartbeat.service
  systemctl enable --now nodehub-reconcile.service
  systemctl restart nodehub-heartbeat.service nodehub-reconcile.service

  echo "Agent services installed via systemd:"
  echo "- nodehub-heartbeat.service"
  echo "- nodehub-reconcile.service"
  echo "Check status with: systemctl status nodehub-heartbeat.service nodehub-reconcile.service --no-pager"
else
  echo "systemd not detected. Falling back to cron-based watchdog daemon."
  if command -v crontab >/dev/null 2>&1; then
    (crontab -l 2>/dev/null | grep -v 'agent-runner.sh cron_check' || true; echo "* * * * * bash $AGENT_ROOT/agent-runner.sh cron_check") | crontab -
  else
    echo "WARNING: crontab is not available. The agent is running in background, but will NOT automatically restart on reboot."
    echo "Please install cron, or start it manually after reboot: bash $AGENT_ROOT/agent-runner.sh cron_check"
  fi
  bash "$AGENT_ROOT/agent-runner.sh" cron_check
  echo "Agent services started via background watchdog."
  echo "Check logs in $STATE_DIR/heartbeat.log and $STATE_DIR/reconcile.log"
fi

if [[ -n "$TLS_DOMAIN" || -n "$TLS_DOMAIN_ALT" ]]; then
  echo "Applying for SSL certificates..."
  ACME_SH_DIR="/root/.acme.sh"
  ACME_SH_EXEC="$ACME_SH_DIR/acme.sh"

  if command -v socat >/dev/null 2>&1; then :; else
    if command -v apt-get >/dev/null 2>&1; then apt-get update >/dev/null && apt-get install -y socat >/dev/null; fi
    if command -v dnf >/dev/null 2>&1; then dnf install -y socat >/dev/null; fi
    if command -v yum >/dev/null 2>&1; then yum install -y socat >/dev/null; fi
  fi

  if [[ -n "$TLS_DOMAIN" ]]; then
    MAIN_DOMAIN="$TLS_DOMAIN"
  else
    MAIN_DOMAIN="$TLS_DOMAIN_ALT"
  fi

  if [[ ! -x "$ACME_SH_EXEC" ]]; then
    echo "Installing acme.sh..."
    if [[ -n "$GITHUB_MIRROR" ]]; then
      MIRROR="\${GITHUB_MIRROR%/}"
      curl -fsSL "$MIRROR/https://raw.githubusercontent.com/acmesh-official/acme.sh/master/acme.sh" | sh -s email=admin@$MAIN_DOMAIN
    else
      curl -fsSL https://get.acme.sh | sh -s email=admin@$MAIN_DOMAIN
    fi
  fi

  if [[ -x "$ACME_SH_EXEC" ]]; then
    $ACME_SH_EXEC --upgrade --auto-upgrade
    $ACME_SH_EXEC --set-default-ca --server letsencrypt

    DOMAINS_ARGS=""
    if [[ -n "$TLS_DOMAIN" ]]; then DOMAINS_ARGS="$DOMAINS_ARGS -d $TLS_DOMAIN"; fi
    if [[ -n "$TLS_DOMAIN_ALT" ]]; then DOMAINS_ARGS="$DOMAINS_ARGS -d $TLS_DOMAIN_ALT"; fi

    mkdir -p "$CONFIG_ROOT/cert"
    CERT_DIR="$CONFIG_ROOT/cert"

    if [[ -n "$CF_API_TOKEN" ]]; then
      echo "Using CF DNS API for validation..."
      export CF_Token="$CF_API_TOKEN"
      $ACME_SH_EXEC --issue $DOMAINS_ARGS --dns dns_cf --keylength ec-256
    else
      echo "Using Standalone mode for validation..."
      $ACME_SH_EXEC --issue $DOMAINS_ARGS --standalone --keylength ec-256
    fi

    $ACME_SH_EXEC --install-cert -d "$MAIN_DOMAIN" --ecc \\
      --key-file "$CERT_DIR/server.key" \\
      --fullchain-file "$CERT_DIR/server.crt"
    echo "SSL Certificate installed to $CERT_DIR"
  else
    echo "acme.sh installation failed!"
  fi
fi
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
