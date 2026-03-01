#!/usr/bin/env bash
set -euo pipefail

############################################
# NodeHub Agent Bootstrap (portable version)
# - system mode (root) or user mode fallback
# - install xray + sing-box (official releases)
# - install agent runner + systemd services (or cron watchdog)
# - optional acme.sh issue certs (standalone or CF DNS)
############################################

# ---------- Defaults ----------
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

# ---------- Helpers ----------
log()  { printf '%s\n' "[INFO] $*"; }
warn() { printf '%s\n' "[WARN] $*" >&2; }
die()  { printf '%s\n' "[ERR ] $*" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

is_root() { [[ "${EUID:-$(id -u)}" -eq 0 ]]; }

mktempdir() {
  local d
  d="$(mktemp -d 2>/dev/null || mktemp -d -t nodehub)"
  echo "$d"
}

cleanup_dir=""
cleanup() {
  [[ -n "${cleanup_dir:-}" && -d "$cleanup_dir" ]] && rm -rf "$cleanup_dir" || true
}
trap cleanup EXIT

# Portable sed -i (GNU/BSD/BusyBox)
sedi() {
  # usage: sedi 's/a/b/g' file
  local expr="$1" file="$2"
  if sed --version >/dev/null 2>&1; then
    # GNU sed
    sed -i "$expr" "$file"
  else
    # BSD sed (macOS) / some busybox variants support -i ''
    sed -i '' "$expr" "$file" 2>/dev/null || {
      # last resort: temp file rewrite
      local tmp
      tmp="$(mktemp 2>/dev/null || mktemp -t sedi)"
      sed "$expr" "$file" > "$tmp"
      cat "$tmp" > "$file"
      rm -f "$tmp"
    }
  fi
}

# URL join for optional mirror that expects: MIRROR/https://github.com/...
wrap_url() {
  local url="$1"
  if [[ -n "$GITHUB_MIRROR" ]]; then
    printf '%s/%s' "${GITHUB_MIRROR%/}" "$url"
  else
    printf '%s' "$url"
  fi
}

# Install packages if possible (best-effort)
install_pkgs() {
  # $@ = packages
  local pkgs=("$@")
  if is_root; then
    if need_cmd apt-get; then
      DEBIAN_FRONTEND=noninteractive apt-get update -y >/dev/null 2>&1 || true
      DEBIAN_FRONTEND=noninteractive apt-get install -y "${pkgs[@]}" >/dev/null 2>&1 || return 1
      return 0
    fi
    if need_cmd dnf; then
      dnf install -y "${pkgs[@]}" >/dev/null 2>&1 || return 1
      return 0
    fi
    if need_cmd yum; then
      yum install -y "${pkgs[@]}" >/dev/null 2>&1 || return 1
      return 0
    fi
    if need_cmd zypper; then
      zypper --non-interactive install -y "${pkgs[@]}" >/dev/null 2>&1 || return 1
      return 0
    fi
    if need_cmd pacman; then
      pacman -Sy --noconfirm "${pkgs[@]}" >/dev/null 2>&1 || return 1
      return 0
    fi
    if need_cmd apk; then
      apk add --no-cache "${pkgs[@]}" >/dev/null 2>&1 || return 1
      return 0
    fi
  fi
  return 1
}

require_or_install() {
  # $1=cmd, rest=pkgs
  local cmd="$1"; shift
  if need_cmd "$cmd"; then return 0; fi
  warn "Missing command: $cmd"
  if [[ $# -gt 0 ]]; then
    if install_pkgs "$@"; then
      log "Installed dependency via package manager: $*"
      need_cmd "$cmd" && return 0
    fi
  fi
  return 1
}

# ---------- Arg parsing ----------
usage() {
  cat <<EOF
Usage:
  $0 --api-base <URL> --node-id <ID> --node-token <TOKEN> [options]

Options:
  --tls-domain <domain>
  --tls-domain-alt <domain>
  --github-mirror <mirror_prefix>   e.g. https://ghproxy.com
  --cf-api-token <token>           Cloudflare API token for DNS validation
  --heartbeat-interval <seconds>   default: 600
  --reconcile-interval <seconds>   default: 15
  --state-dir <dir>                default: /var/lib/nodehub-agent
  --agent-root <dir>               default: /usr/local/lib/nodehub-agent
  --config-root <dir>              default: /etc/nodehub-agent
EOF
}

need_value() {
  local opt="$1" val="${2:-}"
  [[ -n "$val" ]] || die "Option '$opt' requires a value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-base)         need_value "$1" "${2:-}"; API_BASE="$2"; shift 2 ;;
    --node-id)          need_value "$1" "${2:-}"; NODE_ID="$2"; shift 2 ;;
    --node-token)       need_value "$1" "${2:-}"; NODE_TOKEN="$2"; shift 2 ;;
    --tls-domain)       need_value "$1" "${2:-}"; TLS_DOMAIN="$2"; shift 2 ;;
    --tls-domain-alt)   need_value "$1" "${2:-}"; TLS_DOMAIN_ALT="$2"; shift 2 ;;
    --github-mirror)    need_value "$1" "${2:-}"; GITHUB_MIRROR="$2"; shift 2 ;;
    --cf-api-token)     need_value "$1" "${2:-}"; CF_API_TOKEN="$2"; shift 2 ;;
    --heartbeat-interval) need_value "$1" "${2:-}"; HEARTBEAT_INTERVAL="$2"; shift 2 ;;
    --reconcile-interval) need_value "$1" "${2:-}"; RECONCILE_INTERVAL="$2"; shift 2 ;;
    --state-dir)        need_value "$1" "${2:-}"; STATE_DIR="$2"; shift 2 ;;
    --agent-root)       need_value "$1" "${2:-}"; AGENT_ROOT="$2"; shift 2 ;;
    --config-root)      need_value "$1" "${2:-}"; CONFIG_ROOT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (use --help)" ;;
  esac
done

[[ -n "$API_BASE" && -n "$NODE_ID" && -n "$NODE_TOKEN" ]] || {
  usage
  die "Missing required args: --api-base --node-id --node-token"
}

# ---------- Basic deps ----------
require_or_install curl curl ca-certificates || die "curl is required (install it and retry)."
# unzip/tar are needed for xray/sing-box extraction; try best-effort
require_or_install tar tar || warn "tar not found; sing-box extraction may fail unless already installed."
require_or_install unzip unzip || warn "unzip not found; xray extraction may fail unless already installed."

# openssl is needed for SSL certificate operations
if ! need_cmd openssl; then
  warn "openssl not found; will attempt to install if needed for SSL certificates."
fi

# ---------- Install mode / directories ----------
INSTALL_MODE="system"
if mkdir -p "$STATE_DIR" "$AGENT_ROOT" "$CONFIG_ROOT" >/dev/null 2>&1; then
  INSTALL_MODE="system"
else
  warn "No permission for system directories; switching to user-mode install."
  INSTALL_MODE="user"
  STATE_DIR="${HOME}/.local/share/nodehub-agent"
  AGENT_ROOT="${HOME}/.local/lib/nodehub-agent"
  CONFIG_ROOT="${HOME}/.config/nodehub-agent"
  mkdir -p "$STATE_DIR" "$AGENT_ROOT" "$CONFIG_ROOT" || die "Failed to create user directories."
fi

chmod 700 "$STATE_DIR" "$AGENT_ROOT" "$CONFIG_ROOT" 2>/dev/null || true

# Ensure user bin in PATH for current session if user-mode
if [[ "$INSTALL_MODE" == "user" ]]; then
  mkdir -p "${HOME}/.local/bin"
  export PATH="${HOME}/.local/bin:${PATH}"
fi

# ---------- Arch mapping ----------
ARCH="$(uname -m || true)"
XRAY_ARCH=""
SINGBOX_ARCH=""
case "$ARCH" in
  x86_64|amd64) XRAY_ARCH="64"; SINGBOX_ARCH="amd64" ;;
  aarch64|arm64) XRAY_ARCH="arm64-v8a"; SINGBOX_ARCH="arm64" ;;
  armv7l|armv7) XRAY_ARCH="arm32-v7a"; SINGBOX_ARCH="armv7" ;;
  i386|i686) XRAY_ARCH="32"; SINGBOX_ARCH="386" ;;
  *)
    warn "Unsupported architecture for prebuilt install: $ARCH"
    XRAY_ARCH=""
    SINGBOX_ARCH=""
    ;;
esac

# ---------- Binary paths ----------
if [[ "$INSTALL_MODE" == "user" ]]; then
  XRAY_BIN="${HOME}/.local/bin/xray"
  XRAY_ETC="${HOME}/.config/xray"
  XRAY_SHARE="${HOME}/.local/share/xray"
  XRAY_LOG="${HOME}/.local/share/xray/logs"

  SINGBOX_BIN="${HOME}/.local/bin/sing-box"
  SINGBOX_ETC="${HOME}/.config/sing-box"
  SINGBOX_LIB="${HOME}/.local/share/sing-box"
  SINGBOX_LOG="${HOME}/.local/share/sing-box/logs"
else
  XRAY_BIN="/usr/local/bin/xray"
  XRAY_ETC="/usr/local/etc/xray"
  XRAY_SHARE="/usr/local/share/xray"
  XRAY_LOG="/var/log/xray"

  SINGBOX_BIN="/usr/local/bin/sing-box"
  SINGBOX_ETC="/etc/sing-box"
  SINGBOX_LIB="/var/lib/sing-box"
  SINGBOX_LOG="/var/log/sing-box"
fi

mkdir -p "$XRAY_ETC" "$XRAY_SHARE" "$XRAY_LOG" 2>/dev/null || true
mkdir -p "$SINGBOX_ETC" "$SINGBOX_LIB" "$SINGBOX_LOG" 2>/dev/null || true

# ---------- Install Xray ----------
install_xray() {
  [[ -n "$XRAY_ARCH" ]] || { warn "Skip Xray install (unsupported arch)."; return 0; }
  if need_cmd xray || [[ -x "$XRAY_BIN" ]]; then
    log "Xray already installed."
    return 0
  fi
  require_or_install unzip unzip || die "unzip is required to install Xray."

  cleanup_dir="$(mktempdir)"
  local zip="${cleanup_dir}/xray.zip"
  local url
  url="$(wrap_url "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${XRAY_ARCH}.zip")"

  log "Downloading Xray: $url"
  curl -fsSL -o "$zip" "$url" || die "Failed to download Xray from: $url"

  unzip -q -o "$zip" -d "$cleanup_dir" || die "Failed to unzip Xray package."
  [[ -f "${cleanup_dir}/xray" ]] || die "Xray binary not found after extraction."

  mkdir -p "$(dirname "$XRAY_BIN")" || true
  mv "${cleanup_dir}/xray" "$XRAY_BIN"
  chmod 755 "$XRAY_BIN"

  [[ -f "${cleanup_dir}/geoip.dat" ]] && mv "${cleanup_dir}/geoip.dat" "$XRAY_SHARE/geoip.dat" || true
  [[ -f "${cleanup_dir}/geosite.dat" ]] && mv "${cleanup_dir}/geosite.dat" "$XRAY_SHARE/geosite.dat" || true
  chmod 644 "$XRAY_SHARE/geoip.dat" "$XRAY_SHARE/geosite.dat" 2>/dev/null || true

  log "Xray installed to: $XRAY_BIN"
}

# ---------- Install sing-box ----------
# Use GitHub API to get latest tag; parse without jq.
get_latest_github_tag() {
  # $1=owner/repo
  local repo="$1"
  local api tag
  api="$(wrap_url "https://api.github.com/repos/${repo}/releases/latest")"
  
  # Try multiple parsing methods for robustness
  tag="$(curl -fsSL "$api" 2>/dev/null | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
  
  # Fallback: try simpler parsing
  if [[ -z "$tag" ]]; then
    tag="$(curl -fsSL "$api" 2>/dev/null | tr -d '\r\n' | sed 's/.*"tag_name":"\([^"]*\)".*/\1/')"
  fi
  
  # Fallback: use redirect URL method (more reliable, no API limit)
  if [[ -z "$tag" || "$tag" == *"{"* ]]; then
    local redirect_url
    redirect_url="$(wrap_url "https://github.com/${repo}/releases/latest")"
    tag="$(curl -fsSL -I "$redirect_url" 2>/dev/null | grep -i '^location:' | sed 's/.*\/tag\/\([^[:space:]]*\).*/\1/' | tr -d '\r\n')"
  fi
  
  echo "$tag"
}

install_singbox() {
  [[ -n "$SINGBOX_ARCH" ]] || { warn "Skip sing-box install (unsupported arch)."; return 0; }
  if need_cmd sing-box || [[ -x "$SINGBOX_BIN" ]]; then
    log "sing-box already installed."
    return 0
  fi
  require_or_install tar tar || die "tar is required to install sing-box."

  local tag
  tag="$(get_latest_github_tag "SagerNet/sing-box" || true)"
  [[ -n "$tag" && "$tag" != "latest" ]] || die "Failed to detect sing-box latest release tag."

  local ver="${tag#v}"
  local tarname="sing-box-${ver}-linux-${SINGBOX_ARCH}.tar.gz"
  local url
  url="$(wrap_url "https://github.com/SagerNet/sing-box/releases/download/${tag}/${tarname}")"

  cleanup_dir="$(mktempdir)"
  local tgz="${cleanup_dir}/sing-box.tar.gz"

  log "Downloading sing-box: $url"
  curl -fsSL -o "$tgz" "$url" || die "Failed to download sing-box from: $url"

  tar -xzf "$tgz" -C "$cleanup_dir" || die "Failed to extract sing-box tarball."
  local extracted="${cleanup_dir}/sing-box-${ver}-linux-${SINGBOX_ARCH}/sing-box"
  [[ -f "$extracted" ]] || die "sing-box binary not found after extraction."

  mkdir -p "$(dirname "$SINGBOX_BIN")" || true
  mv "$extracted" "$SINGBOX_BIN"
  chmod 755 "$SINGBOX_BIN"

  log "sing-box installed to: $SINGBOX_BIN"
}

log "Installing official Xray and sing-box binaries (best-effort)..."
install_xray || true
install_singbox || true

# ---------- Write config + runner ----------
CONFIG_FILE="${CONFIG_ROOT}/config.env"
RUNNER_SCRIPT="${AGENT_ROOT}/agent-runner.sh"
HOOK_DIR="${AGENT_ROOT}/hooks"
APPLY_HOOK="${HOOK_DIR}/apply.sh"

mkdir -p "$HOOK_DIR" || true

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
AGENT_ROOT="$AGENT_ROOT"
CONFIG_ROOT="$CONFIG_ROOT"
EOF
chmod 600 "$CONFIG_FILE" || true

# Runner: minimal external deps (curl/awk/grep/sed)
cat > "$RUNNER_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
[[ -n "$MODE" ]] || { echo "Usage: $0 {heartbeat|reconcile|cron_check}" >&2; exit 1; }

CONFIG_FILE="__NODEHUB_CONFIG_FILE__"
[[ -f "$CONFIG_FILE" ]] || { echo "config file missing: $CONFIG_FILE" >&2; exit 1; }

# shellcheck source=/dev/null
source "$CONFIG_FILE"

EVENTS_FILE="$STATE_DIR/pending-events.jsonl"
VERSION_FILE="$STATE_DIR/current-version"
ERROR_FILE="$STATE_DIR/last-error.log"
APPLY_HOOK="${AGENT_ROOT}/hooks/apply.sh"

mkdir -p "$STATE_DIR"
touch "$EVENTS_FILE" "$ERROR_FILE"
[[ -f "$VERSION_FILE" ]] || echo "0" > "$VERSION_FILE"

trim_text() { printf '%s' "${1:-}" | tr '\r\n\t' '   '; }

json_escape() {
  # escape backslash + quote; normalize whitespace
  printf '%s' "${1:-}" | tr '\r\n\t' '   ' | sed 's/\\/\\\\/g; s/"/\\"/g'
}

set_last_error() { printf '%s' "$(trim_text "${1:-}")" > "$ERROR_FILE"; }
clear_last_error() { : > "$ERROR_FILE"; }
read_last_error() { [[ -f "$ERROR_FILE" ]] && trim_text "$(cat "$ERROR_FILE" 2>/dev/null || true)" || echo ""; }

read_current_version() {
  local raw
  raw="$(tr -d '\r\n' < "$VERSION_FILE" 2>/dev/null || echo "0")"
  [[ "$raw" =~ ^[0-9]+$ ]] && echo "$raw" || echo "0"
}

detect_protocol_app_version() {
  local cmd_timeout=""
  command -v timeout >/dev/null 2>&1 && cmd_timeout="timeout 5"

  if command -v xray >/dev/null 2>&1; then
    $cmd_timeout xray version 2>/dev/null | head -n 1 | tr -d '\r\n' || true
    return
  fi
  if command -v sing-box >/dev/null 2>&1; then
    $cmd_timeout sing-box version 2>/dev/null | head -n 1 | tr -d '\r\n' || true
    return
  fi
  echo ""
}

cpu_usage_percent() {
  [[ -r /proc/stat ]] || { echo "null"; return; }
  local user1 nice1 system1 idle1 iowait1 irq1 softirq1 steal1
  local user2 nice2 system2 idle2 iowait2 irq2 softirq2 steal2
  read -r _ user1 nice1 system1 idle1 iowait1 irq1 softirq1 steal1 _ < /proc/stat || { echo "null"; return; }
  sleep 0.2
  read -r _ user2 nice2 system2 idle2 iowait2 irq2 softirq2 steal2 _ < /proc/stat || { echo "null"; return; }

  local total1 total2 idle_total1 idle_total2 total_delta idle_delta usage_x100
  total1=$((user1 + nice1 + system1 + idle1 + iowait1 + irq1 + softirq1 + steal1))
  total2=$((user2 + nice2 + system2 + idle2 + iowait2 + irq2 + softirq2 + steal2))
  idle_total1=$((idle1 + iowait1))
  idle_total2=$((idle2 + iowait2))
  total_delta=$((total2 - total1))
  idle_delta=$((idle_total2 - idle_total1))
  [[ "$total_delta" -gt 0 ]] || { echo "null"; return; }

  usage_x100=$(( (10000 * (total_delta - idle_delta)) / total_delta ))
  awk "BEGIN { printf \"%.2f\", $usage_x100 / 100 }"
}

memory_stats() {
  [[ -r /proc/meminfo ]] || { echo "null null null"; return; }
  local total_kb available_kb used_kb used_mb total_mb usage_x100 usage_percent
  total_kb="$(awk '/MemTotal:/ { print $2 }' /proc/meminfo 2>/dev/null || echo "")"
  available_kb="$(awk '/MemAvailable:/ { print $2 }' /proc/meminfo 2>/dev/null || echo "")"
  [[ -n "$total_kb" && -n "$available_kb" && "$total_kb" -gt 0 ]] || { echo "null null null"; return; }
  used_kb=$((total_kb - available_kb)); [[ "$used_kb" -lt 0 ]] && used_kb=0
  used_mb=$((used_kb / 1024)); total_mb=$((total_kb / 1024))
  usage_x100=$(( (10000 * used_kb) / total_kb ))
  usage_percent="$(awk "BEGIN { printf \"%.2f\", $usage_x100 / 100 }")"
  echo "$used_mb $total_mb $usage_percent"
}

build_heartbeat_payload() {
  local current_version deploy_info protocol_version error_message cpu_usage
  local memory_used memory_total memory_usage
  current_version="$(read_current_version)"
  deploy_info="applied_version=v${current_version}"
  protocol_version="$(detect_protocol_app_version)"
  error_message="$(read_last_error)"
  cpu_usage="$(cpu_usage_percent)"
  read -r memory_used memory_total memory_usage <<< "$(memory_stats)"

  local deploy_json protocol_json error_json
  deploy_json="$(json_escape "$deploy_info")"
  protocol_json="$(json_escape "$protocol_version")"
  error_json="$(json_escape "$error_message")"

  echo "{\"node_id\":\"$NODE_ID\",\"deploy_info\":\"$deploy_json\",\"protocol_app_version\":\"$protocol_json\",\"error_message\":\"$error_json\",\"cpu_usage_percent\":$cpu_usage,\"memory_used_mb\":$memory_used,\"memory_total_mb\":$memory_total,\"memory_usage_percent\":$memory_usage}"
}

heartbeat_once() {
  local payload
  payload="$(build_heartbeat_payload)"
  if curl -fsS --max-time 15 -X POST "$API_BASE/agent/heartbeat" \
      -H "X-Node-Token: $NODE_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$payload" >/dev/null; then
    return 0
  fi
  set_last_error "heartbeat report failed"
  return 1
}

json_number_field() {
  local key="${1}" payload="${2}"
  echo "$payload" | tr -d '\r\n' | sed 's/[{}]/ /g' | tr ',' '\n' | awk -F: -v k="\"$key\"" '$1 ~ k { gsub(/[^0-9]/,"",$2); print $2; exit }'
}

json_bool_field() {
  local key="${1}" payload="${2}"
  echo "$payload" | tr -d '\r\n' | grep -q "\"$key\":true" && echo "true" || echo "false"
}

generate_event_id() {
  if [[ -r /proc/sys/kernel/random/uuid ]]; then cat /proc/sys/kernel/random/uuid; return; fi
  command -v uuidgen >/dev/null 2>&1 && uuidgen | tr 'A-Z' 'a-z' && return
  date +%s%N
}

enqueue_apply_event() {
  local status="$1" version="$2" message="$3"
  local now event_id
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  event_id="$(generate_event_id)"
  local msg
  msg="$(json_escape "$message")"
  printf '{"event_id":"%s","type":"apply_result","status":"%s","applied_version":%s,"message":"%s","occurred_at":"%s"}\n' \
    "$event_id" "$status" "$version" "$msg" "$now" >> "$EVENTS_FILE"
}

flush_pending_events() {
  [[ -s "$EVENTS_FILE" ]] || return 0
  local event_rows payload
  event_rows="$(awk 'NF { if (c++ > 0) printf(","); printf("%s", $0) } END { print "" }' "$EVENTS_FILE")"
  [[ -n "$event_rows" ]] || return 0
  payload="{\"node_id\":\"$NODE_ID\",\"events\":[$event_rows]}"
  if curl -fsS --max-time 15 -X POST "$API_BASE/agent/events" \
      -H "X-Node-Token: $NODE_TOKEN" \
      -H "Content-Type: application/json" \
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
  local current_version response desired_version needs_update
  current_version="$(read_current_version)"

  response="$(curl -fsS --max-time 15 "$API_BASE/agent/reconcile?node_id=$NODE_ID&current_version=$current_version" \
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
  [[ -n "$desired_version" ]] || { set_last_error "invalid reconcile response"; return 1; }

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
    local pidfile="$STATE_DIR/${sname}.pid"
    local logfile="$STATE_DIR/${sname}.log"
    local pid=""
    [[ -f "$pidfile" ]] && pid="$(cat "$pidfile" 2>/dev/null || true)" || true
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    nohup bash "$0" "$sname" > "$logfile" 2>&1 &
    echo $! > "$pidfile"
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

# Replace placeholder config path
CONFIG_FILE_ESCAPED="$(printf '%s' "$CONFIG_FILE" | sed 's/[\/&]/\\&/g')"
sedi "s/__NODEHUB_CONFIG_FILE__/${CONFIG_FILE_ESCAPED}/g" "$RUNNER_SCRIPT"
chmod 700 "$RUNNER_SCRIPT" || true

# ---------- systemd service files ----------
if [[ "$INSTALL_MODE" == "user" ]]; then
  HEARTBEAT_SERVICE="${HOME}/.config/systemd/user/nodehub-heartbeat.service"
  RECONCILE_SERVICE="${HOME}/.config/systemd/user/nodehub-reconcile.service"
  mkdir -p "${HOME}/.config/systemd/user"
else
  HEARTBEAT_SERVICE="/etc/systemd/system/nodehub-heartbeat.service"
  RECONCILE_SERVICE="/etc/systemd/system/nodehub-reconcile.service"
fi

# Determine systemd targets
SYSTEMD_TARGET="multi-user.target"
[[ "$INSTALL_MODE" == "user" ]] && SYSTEMD_TARGET="default.target"

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
WantedBy=$SYSTEMD_TARGET
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
WantedBy=$SYSTEMD_TARGET
EOF

# ---------- Enable via systemd if possible; else cron watchdog ----------
USE_SYSTEMD=0
SYSTEMCTL_USER_FLAG=""

if need_cmd systemctl; then
  if [[ "$INSTALL_MODE" == "user" ]]; then
    # user systemd available?
    if systemctl --user show-environment >/dev/null 2>&1; then
      USE_SYSTEMD=1
      SYSTEMCTL_USER_FLAG="--user"
    else
      warn "User-mode systemd not available (no user session)."
    fi
  else
    # system systemd available?
    if [[ -d /run/systemd/system ]]; then
      USE_SYSTEMD=1
      SYSTEMCTL_USER_FLAG=""
    fi
  fi
fi

log "================================================"
log "NodeHub Agent Bootstrap"
log "================================================"
log "Install Mode: $INSTALL_MODE"
log "Node ID: $NODE_ID"
log "TLS Domain: ${TLS_DOMAIN:-<none>}"
log "TLS Domain Alt: ${TLS_DOMAIN_ALT:-<none>}"
log "Heartbeat Interval: $HEARTBEAT_INTERVAL"
log "Reconcile Interval: $RECONCILE_INTERVAL"
log "State Directory: $STATE_DIR"
log "Agent Root: $AGENT_ROOT"
log "Config Root: $CONFIG_ROOT"
log "================================================"

if [[ "$USE_SYSTEMD" -eq 1 ]]; then
  log "Installing services via systemd..."
  systemctl $SYSTEMCTL_USER_FLAG daemon-reload || true
  systemctl $SYSTEMCTL_USER_FLAG enable --now nodehub-heartbeat.service || die "Failed to enable nodehub-heartbeat.service"
  systemctl $SYSTEMCTL_USER_FLAG enable --now nodehub-reconcile.service || die "Failed to enable nodehub-reconcile.service"
  systemctl $SYSTEMCTL_USER_FLAG restart nodehub-heartbeat.service nodehub-reconcile.service || true

  log "Services installed:"
  log "- nodehub-heartbeat.service"
  log "- nodehub-reconcile.service"
  log "Check status:"
  log "  systemctl $SYSTEMCTL_USER_FLAG status nodehub-heartbeat.service nodehub-reconcile.service --no-pager"
else
  warn "systemd not available; using cron-based watchdog fallback."

  # Ensure cron exists or try install
  if ! need_cmd crontab; then
    warn "crontab not found."
    if is_root; then
      install_pkgs cron cronie crond busybox-cron >/dev/null 2>&1 || true
    fi
  fi

  if is_root && [[ -d /etc/cron.d ]]; then
    # safer for root: /etc/cron.d
    local_cron="/etc/cron.d/nodehub-agent"
    cat > "$local_cron" <<EOF
* * * * * root bash "$RUNNER_SCRIPT" cron_check >/dev/null 2>&1
EOF
    chmod 644 "$local_cron" || true
    log "Installed cron watchdog: $local_cron"
  elif need_cmd crontab; then
    # user cron
    (crontab -l 2>/dev/null | grep -v 'agent-runner.sh cron_check' || true; \
      echo "* * * * * bash \"$RUNNER_SCRIPT\" cron_check >/dev/null 2>&1") | crontab -
    log "Installed cron watchdog via crontab."
  else
    warn "Cron not available. Agent will start now but won't auto-restart on reboot."
  fi

  # start watchdog now
  bash "$RUNNER_SCRIPT" cron_check || true
  log "Watchdog started. Logs:"
  log "  $STATE_DIR/heartbeat.log"
  log "  $STATE_DIR/reconcile.log"
fi

# ---------- SSL certificate issuance (optional) ----------
# Try acme.sh first (if openssl available), fallback to lego
issue_certs() {
  [[ -n "$TLS_DOMAIN" || -n "$TLS_DOMAIN_ALT" ]] || return 0

  log "Applying for SSL certificates..."

  # Try acme.sh first if openssl is available
  if need_cmd openssl; then
    if issue_certs_acme; then
      return 0
    fi
    warn "acme.sh failed, trying lego as fallback..."
  else
    log "openssl not found, using lego (no openssl dependency)..."
  fi

  # Fallback to lego
  issue_certs_lego
}

# Method 1: acme.sh (requires openssl)
issue_certs_acme() {
  log "Using acme.sh for certificate issuance..."

  local ACME_SH_DIR
  if [[ "$INSTALL_MODE" == "user" ]]; then
    ACME_SH_DIR="${HOME}/.acme.sh"
  else
    ACME_SH_DIR="/root/.acme.sh"
  fi
  local ACME_SH_EXEC="${ACME_SH_DIR}/acme.sh"

  local MAIN_DOMAIN="$TLS_DOMAIN"
  [[ -z "$MAIN_DOMAIN" ]] && MAIN_DOMAIN="$TLS_DOMAIN_ALT"

  # Install acme.sh if not present
  if [[ ! -x "$ACME_SH_EXEC" ]]; then
    log "Installing acme.sh..."
    
    cleanup_dir="$(mktempdir)"
    local acme_repo_url="https://github.com/acmesh-official/acme.sh/archive/refs/heads/master.tar.gz"
    local acme_tarball="${cleanup_dir}/acme.sh.tar.gz"
    local repo_url
    repo_url="$(wrap_url "$acme_repo_url")"
    
    if ! curl -fsSL "$repo_url" -o "$acme_tarball" 2>/dev/null; then
      warn "Failed to download acme.sh"
      return 1
    fi
    
    if ! tar -xzf "$acme_tarball" -C "$cleanup_dir" 2>/dev/null; then
      warn "Failed to extract acme.sh"
      return 1
    fi
    
    local acme_src
    acme_src="$(find "$cleanup_dir" -maxdepth 1 -type d -name 'acme.sh-*' | head -n 1)"
    if [[ ! -d "$acme_src" ]]; then
      warn "acme.sh source directory not found"
      return 1
    fi
    
    cd "$acme_src" || return 1
    if ! ./acme.sh --install \
      --home "$ACME_SH_DIR" \
      --config-home "${ACME_SH_DIR}/data" \
      --cert-home "${ACME_SH_DIR}/certs" \
      --accountemail "admin@${MAIN_DOMAIN}" \
      --nocron 2>/dev/null; then
      cd - >/dev/null || true
      warn "acme.sh installation failed"
      return 1
    fi
    cd - >/dev/null || true
  fi

  [[ -x "$ACME_SH_EXEC" ]] || {
    warn "acme.sh not found after installation"
    return 1
  }

  "$ACME_SH_EXEC" --upgrade --auto-upgrade >/dev/null 2>&1 || true
  "$ACME_SH_EXEC" --set-default-ca --server letsencrypt >/dev/null 2>&1 || true

  local DOMAINS_ARGS=()
  [[ -n "$TLS_DOMAIN" ]] && DOMAINS_ARGS+=(-d "$TLS_DOMAIN")
  [[ -n "$TLS_DOMAIN_ALT" ]] && DOMAINS_ARGS+=(-d "$TLS_DOMAIN_ALT")

  mkdir -p "${CONFIG_ROOT}/cert"
  local CERT_DIR="${CONFIG_ROOT}/cert"

  # Issue certificate
  if [[ -n "$CF_API_TOKEN" ]]; then
    log "Using Cloudflare DNS validation..."
    if ! CF_Token="$CF_API_TOKEN" "$ACME_SH_EXEC" --issue "${DOMAINS_ARGS[@]}" --dns dns_cf --keylength ec-256 2>/dev/null; then
      warn "acme.sh certificate issuance failed"
      return 1
    fi
  else
    if ! is_root; then
      warn "Standalone mode requires root (bind :80)"
      return 1
    fi
    
    # Try to install socat for standalone mode
    if ! need_cmd socat && is_root; then
      install_pkgs socat >/dev/null 2>&1 || true
    fi
    
    log "Using standalone validation (port 80)..."
    if ! "$ACME_SH_EXEC" --issue "${DOMAINS_ARGS[@]}" --standalone --keylength ec-256 2>/dev/null; then
      warn "acme.sh standalone issuance failed"
      return 1
    fi
  fi

  # Install certificate
  if ! "$ACME_SH_EXEC" --install-cert -d "$MAIN_DOMAIN" --ecc \
    --key-file "$CERT_DIR/server.key" \
    --fullchain-file "$CERT_DIR/server.crt" 2>/dev/null; then
    warn "acme.sh certificate installation failed"
    return 1
  fi

  log "SSL certificate installed via acme.sh to: $CERT_DIR"
  return 0
}

# Method 2: lego (standalone binary, no dependencies)
issue_certs_lego() {
  log "Using lego for certificate issuance..."

  local LEGO_BIN
  if [[ "$INSTALL_MODE" == "user" ]]; then
    LEGO_BIN="${HOME}/.local/bin/lego"
  else
    LEGO_BIN="/usr/local/bin/lego"
  fi

  # Install lego if not present
  if [[ ! -x "$LEGO_BIN" ]]; then
    log "Installing lego ACME client..."
    
    local LEGO_ARCH=""
    case "$ARCH" in
      x86_64|amd64) LEGO_ARCH="amd64" ;;
      aarch64|arm64) LEGO_ARCH="arm64" ;;
      armv7l|armv7) LEGO_ARCH="armv7" ;;
      i386|i686) LEGO_ARCH="386" ;;
      *)
        warn "Unsupported architecture for lego: $ARCH"
        return 1
        ;;
    esac
    
    # Get latest lego version
    local lego_version
    lego_version="$(curl -fsSL "$(wrap_url "https://api.github.com/repos/go-acme/lego/releases/latest")" 2>/dev/null | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || echo "v4.20.4")"
    [[ -z "$lego_version" || "$lego_version" == *"{"* ]] && lego_version="v4.20.4"
    
    local lego_tarball="lego_${lego_version}_linux_${LEGO_ARCH}.tar.gz"
    local lego_url
    lego_url="$(wrap_url "https://github.com/go-acme/lego/releases/download/${lego_version}/${lego_tarball}")"
    
    cleanup_dir="$(mktempdir)"
    local lego_tar="${cleanup_dir}/lego.tar.gz"
    
    log "Downloading lego: $lego_url"
    if ! curl -fsSL "$lego_url" -o "$lego_tar" 2>/dev/null; then
      warn "Failed to download lego"
      return 1
    fi
    
    if ! tar -xzf "$lego_tar" -C "$cleanup_dir" 2>/dev/null; then
      warn "Failed to extract lego"
      return 1
    fi
    
    if [[ ! -f "${cleanup_dir}/lego" ]]; then
      warn "lego binary not found after extraction"
      return 1
    fi
    
    mkdir -p "$(dirname "$LEGO_BIN")" || true
    mv "${cleanup_dir}/lego" "$LEGO_BIN"
    chmod 755 "$LEGO_BIN"
    
    log "lego installed to: $LEGO_BIN"
  fi

  # Prepare certificate directory
  mkdir -p "${CONFIG_ROOT}/cert"
  local CERT_DIR="${CONFIG_ROOT}/cert"
  local LEGO_DATA_DIR="${CONFIG_ROOT}/.lego"
  
  # Build domain arguments
  local MAIN_DOMAIN="$TLS_DOMAIN"
  [[ -z "$MAIN_DOMAIN" ]] && MAIN_DOMAIN="$TLS_DOMAIN_ALT"
  
  local DOMAIN_ARGS=()
  [[ -n "$TLS_DOMAIN" ]] && DOMAIN_ARGS+=(--domains "$TLS_DOMAIN")
  [[ -n "$TLS_DOMAIN_ALT" ]] && DOMAIN_ARGS+=(--domains "$TLS_DOMAIN_ALT")
  
  # Issue certificate
  if [[ -n "$CF_API_TOKEN" ]]; then
    log "Using Cloudflare DNS validation..."
    export CF_DNS_API_TOKEN="$CF_API_TOKEN"
    
    if ! "$LEGO_BIN" --path "$LEGO_DATA_DIR" \
        --email "admin@${MAIN_DOMAIN}" \
        --dns cloudflare \
        --key-type ec256 \
        "${DOMAIN_ARGS[@]}" \
        run 2>/dev/null; then
      warn "lego certificate issuance failed"
      return 1
    fi
  else
    if ! is_root; then
      warn "Standalone mode requires root (bind :80)"
      return 1
    fi
    
    log "Using standalone validation (port 80)..."
    if ! "$LEGO_BIN" --path "$LEGO_DATA_DIR" \
        --email "admin@${MAIN_DOMAIN}" \
        --http \
        --key-type ec256 \
        "${DOMAIN_ARGS[@]}" \
        run 2>/dev/null; then
      warn "lego standalone issuance failed"
      return 1
    fi
  fi
  
  # Copy certificates to target directory
  local LEGO_CERT_DIR="${LEGO_DATA_DIR}/certificates"
  if [[ -f "${LEGO_CERT_DIR}/${MAIN_DOMAIN}.crt" && -f "${LEGO_CERT_DIR}/${MAIN_DOMAIN}.key" ]]; then
    cp "${LEGO_CERT_DIR}/${MAIN_DOMAIN}.crt" "${CERT_DIR}/server.crt"
    cp "${LEGO_CERT_DIR}/${MAIN_DOMAIN}.key" "${CERT_DIR}/server.key"
    chmod 600 "${CERT_DIR}/server.key"
    chmod 644 "${CERT_DIR}/server.crt"
    log "SSL certificate installed via lego to: $CERT_DIR"
    return 0
  else
    warn "Certificate files not found after lego issuance"
    return 1
  fi
}

issue_certs || true

log "Done."