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
WARP_LICENSE=""
ARGO_TOKEN=""
ARGO_DOMAIN=""
INSTALL_WARP=0
INSTALL_ARGO=0

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

# Direct URL without mirror (for API requests)
direct_url() {
  local url="$1"
  printf '%s' "$url"
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
  --install-warp                   install and register warp-go
  --warp-license <key>             WARP+ license key for warp-go registration
  --install-argo                   install cloudflared and start tunnel
  --argo-token <token>             Cloudflare Tunnel token (fixed tunnel)
  --argo-domain <domain>           Cloudflare Tunnel fixed domain
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
    --install-warp)     INSTALL_WARP=1; shift ;;
    --warp-license)     need_value "$1" "${2:-}"; WARP_LICENSE="$2"; shift 2 ;;
    --install-argo)     INSTALL_ARGO=1; shift ;;
    --argo-token)       need_value "$1" "${2:-}"; ARGO_TOKEN="$2"; shift 2 ;;
    --argo-domain)      need_value "$1" "${2:-}"; ARGO_DOMAIN="$2"; shift 2 ;;
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

# Backward compatibility for older control-plane commands:
# If explicit install flags are absent, infer intent from legacy params.
if [[ "$INSTALL_WARP" -ne 1 && -n "$WARP_LICENSE" ]]; then
  INSTALL_WARP=1
fi
if [[ "$INSTALL_ARGO" -ne 1 ]] && ([[ -n "$ARGO_TOKEN" ]] || [[ -n "$ARGO_DOMAIN" ]]); then
  INSTALL_ARGO=1
fi

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
# API requests always go direct (no mirror) to avoid API proxy issues
get_latest_github_tag() {
  # $1=owner/repo, $2=fallback_version (optional)
  local repo="$1"
  local fallback="${2:-}"
  local api tag
  
  # Always use direct API URL (no mirror for API requests)
  api="$(direct_url "https://api.github.com/repos/${repo}/releases/latest")"
  
  # Try multiple parsing methods for robustness
  tag="$(curl -fsSL "$api" 2>/dev/null | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
  
  # Fallback: try simpler parsing
  if [[ -z "$tag" ]]; then
    tag="$(curl -fsSL "$api" 2>/dev/null | tr -d '\r\n' | sed 's/.*"tag_name":"\([^"]*\)".*/\1/')"
  fi
  
  # Fallback: use redirect URL method (more reliable, no API limit)
  # This also uses direct URL without mirror
  if [[ -z "$tag" || "$tag" == *"{"* ]]; then
    local redirect_url
    redirect_url="$(direct_url "https://github.com/${repo}/releases/latest")"
    tag="$(curl -fsSL -I "$redirect_url" 2>/dev/null | grep -i '^location:' | sed 's/.*\/tag\/\([^[:space:]]*\).*/\1/' | tr -d '\r\n')"
  fi
  
  # If all methods failed and fallback version provided, use it
  if [[ -z "$tag" || "$tag" == *"{"* ]] && [[ -n "$fallback" ]]; then
    warn "Failed to detect latest release tag from GitHub API, using fallback version: $fallback"
    tag="$fallback"
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
  # Use fallback version v1.13.0 if API fails
  tag="$(get_latest_github_tag "SagerNet/sing-box" "v1.13.0" || echo "v1.13.0")"
  [[ -n "$tag" && "$tag" != "latest" ]] || tag="v1.13.0"

  local ver="${tag#v}"
  local tarname="sing-box-${ver}-linux-${SINGBOX_ARCH}.tar.gz"
  local url
  # File download uses mirror if configured
  url="$(wrap_url "https://github.com/SagerNet/sing-box/releases/download/${tag}/${tarname}")"

  cleanup_dir="$(mktempdir)"
  local tgz="${cleanup_dir}/sing-box.tar.gz"

  log "Downloading sing-box ${tag}: $url"
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

# ---------- Install cloudflared ----------
CLOUDFLARED_BIN=""
if [[ "$INSTALL_MODE" == "user" ]]; then
  CLOUDFLARED_BIN="${HOME}/.local/bin/cloudflared"
else
  CLOUDFLARED_BIN="/usr/local/bin/cloudflared"
fi

install_cloudflared() {
  if need_cmd cloudflared || [[ -x "$CLOUDFLARED_BIN" ]]; then
    log "cloudflared already installed."
    return 0
  fi

  local cf_arch=""
  case "$ARCH" in
    x86_64|amd64) cf_arch="amd64" ;;
    aarch64|arm64) cf_arch="arm64" ;;
    armv7l|armv7) cf_arch="arm" ;;
    i386|i686) cf_arch="386" ;;
    *)
      warn "Unsupported architecture for cloudflared: $ARCH"
      return 1
      ;;
  esac

  local url
  # Cloudflared must be fetched from official upstream binary release.
  url="$(direct_url "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cf_arch}")"

  log "Downloading cloudflared: $url"
  mkdir -p "$(dirname "$CLOUDFLARED_BIN")" || true
  curl -fsSL -o "$CLOUDFLARED_BIN" "$url" || { warn "Failed to download cloudflared"; return 1; }
  chmod 755 "$CLOUDFLARED_BIN"
  log "cloudflared installed to: $CLOUDFLARED_BIN"
}

if [[ "$INSTALL_ARGO" -eq 1 ]]; then
  log "Installing cloudflared (best-effort)..."
  install_cloudflared || true
else
  log "Argo install not enabled, skipping cloudflared."
fi

# ---------- Install warp-go + register ----------
WARPGO_BIN=""
if [[ "$INSTALL_MODE" == "user" ]]; then
  WARPGO_BIN="${HOME}/.local/bin/warp-go"
else
  WARPGO_BIN="/usr/local/bin/warp-go"
fi

install_warpgo() {
  if [[ -x "$WARPGO_BIN" ]]; then
    log "warp-go already installed."
    return 0
  fi

  local wg_arch=""
  case "$ARCH" in
    x86_64|amd64) wg_arch="amd64" ;;
    aarch64|arm64) wg_arch="arm64" ;;
    armv7l|armv7) wg_arch="arm" ;;
    *)
      warn "Unsupported architecture for warp-go: $ARCH"
      return 1
      ;;
  esac

  local url
  url="$(wrap_url "https://gitlab.com/ProjectWARP/warp-go/-/releases/permalink/latest/downloads/warp-go_linux_${wg_arch}")"

  log "Downloading warp-go: $url"
  mkdir -p "$(dirname "$WARPGO_BIN")" || true
  curl -fsSL -o "$WARPGO_BIN" "$url" || { warn "Failed to download warp-go"; return 1; }
  chmod 755 "$WARPGO_BIN"
  log "warp-go installed to: $WARPGO_BIN"
}

register_warp() {
  [[ -x "$WARPGO_BIN" ]] || { warn "warp-go not installed, skipping WARP registration"; return 1; }

  local warp_dir="$STATE_DIR/warp"
  mkdir -p "$warp_dir"

  # Skip if already registered
  if [[ -f "$warp_dir/warp.conf" && -f "$warp_dir/private_key" ]]; then
    log "WARP already registered, skipping."
    return 0
  fi

  log "Registering WARP account..."
  local warp_conf="$warp_dir/warp.conf"

  # Register new account
  if ! "$WARPGO_BIN" --register --config "$warp_conf" 2>/dev/null; then
    warn "WARP registration failed"
    return 1
  fi

  # Upgrade with license if provided
  if [[ -n "$WARP_LICENSE" ]]; then
    log "Upgrading WARP account with license..."
    # Update license in config
    if grep -q '^LicenseKey' "$warp_conf" 2>/dev/null; then
      sedi "s/^LicenseKey.*/LicenseKey = ${WARP_LICENSE}/" "$warp_conf"
    else
      echo "LicenseKey = ${WARP_LICENSE}" >> "$warp_conf"
    fi
    "$WARPGO_BIN" --update --config "$warp_conf" 2>/dev/null || warn "WARP license upgrade failed (continuing with free)"
  fi

  # Extract keys from warp.conf
  local pvk v6 reserved endpoint
  pvk="$(grep -oP '(?<=PrivateKey = ).*' "$warp_conf" 2>/dev/null || true)"
  v6="$(grep -oP '(?<=Address6 = )[^/]+' "$warp_conf" 2>/dev/null || true)"
  endpoint="$(grep -oP '(?<=Endpoint = ).*' "$warp_conf" 2>/dev/null || echo 'engage.cloudflareclient.com:2408')"
  reserved="$(grep -oP '(?<=Reserved = ).*' "$warp_conf" 2>/dev/null || echo '0,0,0')"

  # Save extracted keys for heartbeat reporting
  echo "$pvk" > "$warp_dir/private_key"
  echo "$v6" > "$warp_dir/v6"
  echo "$reserved" > "$warp_dir/reserved"
  echo "$endpoint" > "$warp_dir/endpoint"
  echo "registered" > "$STATE_DIR/warp-status"

  log "WARP registered: v6=$v6 endpoint=$endpoint"
}

if [[ "$INSTALL_WARP" -eq 1 ]]; then
  log "Installing warp-go and registering WARP..."
  install_warpgo || true
  register_warp || true
fi

# ---------- Start Argo tunnel ----------
start_argo_tunnel() {
  local argo_pidfile="$STATE_DIR/cloudflared.pid"

  # Stop existing if any
  if [[ -f "$argo_pidfile" ]]; then
    local old_pid
    old_pid="$(cat "$argo_pidfile" 2>/dev/null || true)"
    [[ -n "$old_pid" ]] && kill "$old_pid" 2>/dev/null || true
    rm -f "$argo_pidfile"
  fi
  rm -f "$STATE_DIR/argo-domain" "$STATE_DIR/argo.log"

  command -v cloudflared >/dev/null 2>&1 || [[ -x "$CLOUDFLARED_BIN" ]] || { warn "cloudflared not available"; return 1; }
  local cf_bin
  cf_bin="$(command -v cloudflared 2>/dev/null || echo "$CLOUDFLARED_BIN")"

  if [[ -n "$ARGO_TOKEN" ]]; then
    # Fixed tunnel
    log "Starting Argo fixed tunnel..."
    nohup "$cf_bin" tunnel --no-autoupdate --edge-ip-version auto --protocol http2 run --token "$ARGO_TOKEN" > "$STATE_DIR/argo.log" 2>&1 &
    echo $! > "$argo_pidfile"
    [[ -n "$ARGO_DOMAIN" ]] && echo "$ARGO_DOMAIN" > "$STATE_DIR/argo-domain"
    log "Argo fixed tunnel started (domain: ${ARGO_DOMAIN:-<from-dashboard>})"
  else
    # Temp tunnel — find the first listening port from templates
    local temp_port=0
    # Default to a common port; the actual port will be from the protocol config
    temp_port=2053
    log "Starting Argo temp tunnel on port $temp_port..."
    nohup "$cf_bin" tunnel --url "http://localhost:${temp_port}" --edge-ip-version auto --no-autoupdate --protocol http2 > "$STATE_DIR/argo.log" 2>&1 &
    echo $! > "$argo_pidfile"
    sleep 8
    local temp_domain
    temp_domain="$(grep -ao 'https://[a-z0-9-]*\.trycloudflare\.com' "$STATE_DIR/argo.log" 2>/dev/null | head -n1 | sed 's|https://||')"
    [[ -n "$temp_domain" ]] && echo "$temp_domain" > "$STATE_DIR/argo-domain"
    log "Argo temp tunnel started (domain: ${temp_domain:-<pending>})"
  fi
}

if [[ "$INSTALL_ARGO" -eq 1 ]]; then
  start_argo_tunnel || true
fi

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

# Runner: control-plane artifact deployment (download + verify + atomic apply)
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

  if command -v sing-box >/dev/null 2>&1; then
    $cmd_timeout sing-box version 2>/dev/null | head -n 1 | tr -d '\r\n' || true
    return
  fi
  if command -v xray >/dev/null 2>&1; then
    $cmd_timeout xray version 2>/dev/null | head -n 1 | tr -d '\r\n' || true
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
  deploy_info="applied_rev=r${current_version}"
  protocol_version="$(detect_protocol_app_version)"
  error_message="$(read_last_error)"
  cpu_usage="$(cpu_usage_percent)"
  read -r memory_used memory_total memory_usage <<< "$(memory_stats)"

  local deploy_json protocol_json error_json warp_json argo_json argo_domain_json
  deploy_json="$(json_escape "$deploy_info")"
  protocol_json="$(json_escape "$protocol_version")"
  error_json="$(json_escape "$error_message")"

  # WARP registration data + status
  local warp_status="off" warp_pvk="" warp_v6="" warp_reserved="" warp_endpoint=""
  local warp_dir="$STATE_DIR/warp"
  if [[ -f "$STATE_DIR/warp-status" ]]; then
    warp_status="$(cat "$STATE_DIR/warp-status" 2>/dev/null || echo off)"
  fi
  if [[ -f "$warp_dir/private_key" ]]; then
    warp_pvk="$(cat "$warp_dir/private_key" 2>/dev/null || true)"
    warp_v6="$(cat "$warp_dir/v6" 2>/dev/null || true)"
    warp_reserved="$(cat "$warp_dir/reserved" 2>/dev/null || echo '0,0,0')"
    warp_endpoint="$(cat "$warp_dir/endpoint" 2>/dev/null || echo 'engage.cloudflareclient.com:2408')"
  fi
  warp_json="$(json_escape "$warp_status")"
  local warp_pvk_json warp_v6_json warp_endpoint_json
  warp_pvk_json="$(json_escape "$warp_pvk")"
  warp_v6_json="$(json_escape "$warp_v6")"
  warp_endpoint_json="$(json_escape "$warp_endpoint")"

  # Convert reserved "1,2,3" to JSON array [1,2,3]
  local warp_reserved_arr="[0,0,0]"
  if [[ -n "$warp_reserved" ]]; then
    warp_reserved_arr="[$(echo "$warp_reserved" | tr -d ' ')]"
  fi

  # Argo status
  local argo_status="off" argo_temp_domain=""
  local argo_pidfile="$STATE_DIR/cloudflared.pid"
  if [[ -f "$argo_pidfile" ]]; then
    local argo_pid
    argo_pid="$(cat "$argo_pidfile" 2>/dev/null || true)"
    if [[ -n "$argo_pid" ]] && kill -0 "$argo_pid" 2>/dev/null; then
      argo_status="running"
    else
      argo_status="stopped"
    fi
  fi
  if [[ -f "$STATE_DIR/argo-domain" ]]; then
    argo_temp_domain="$(cat "$STATE_DIR/argo-domain" 2>/dev/null || true)"
  fi
  argo_json="$(json_escape "$argo_status")"
  argo_domain_json="$(json_escape "$argo_temp_domain")"

  echo "{\"node_id\":\"$NODE_ID\",\"deploy_info\":\"$deploy_json\",\"protocol_app_version\":\"$protocol_json\",\"error_message\":\"$error_json\",\"cpu_usage_percent\":$cpu_usage,\"memory_used_mb\":$memory_used,\"memory_total_mb\":$memory_total,\"memory_usage_percent\":$memory_usage,\"warp_private_key\":\"$warp_pvk_json\",\"warp_v6\":\"$warp_v6_json\",\"warp_reserved\":$warp_reserved_arr,\"warp_endpoint\":\"$warp_endpoint_json\",\"warp_status\":\"$warp_json\",\"argo_status\":\"$argo_json\",\"argo_temp_domain\":\"$argo_domain_json\"}"
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

json_string_field() {
  local key="${1}" payload="${2}"
  echo "$payload" | tr -d '\r\n' | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n1
}

extract_hook_field() {
  local key="$1" output="$2"
  printf '%s\n' "$output" | awk -F= -v target="$key" '$1==target { print substr($0, index($0, "=") + 1); exit }'
}

extract_hook_tail() {
  local output="$1"
  printf '%s\n' "$output" | awk '
    !/^(ERROR_CODE|ERROR_MESSAGE|ERROR_DETAIL|APPLY_DETAIL)=/ && NF {
      gsub(/\r/, "", $0)
      rows[++count] = $0
    }
    END {
      start = count - 2
      if (start < 1) start = 1
      for (i = start; i <= count; i++) {
        if (i > start) printf(" || ")
        printf("%s", rows[i])
      }
    }
  '
}

enqueue_apply_event() {
  local status="$1" message="$2" error_code="${3:-}" target_version="${4:-}" current_version="${5:-}"
  local msg code_json target_json current_json
  msg="$(json_escape "$message")"
  code_json="$(json_escape "$error_code")"
  if [[ "$target_version" =~ ^[0-9]+$ ]]; then
    target_json="$target_version"
  else
    target_json="null"
  fi
  if [[ "$current_version" =~ ^[0-9]+$ ]]; then
    current_json="$current_version"
  else
    current_json="null"
  fi
  printf '{"type":"apply_result","status":"%s","error_code":"%s","message":"%s","target_version":%s,"current_version":%s}\n' \
    "$status" "$code_json" "$msg" "$target_json" "$current_json" >> "$EVENTS_FILE"
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

apply_target_release() {
  local target_version="$1" artifact_url="$2" artifact_sha256="$3" reload_cmd="$4"
  local short_sha
  short_sha="${artifact_sha256:0:16}"
  [[ -n "$artifact_url" && -n "$artifact_sha256" ]] || {
    set_last_error "reconcile payload missing artifact"
    enqueue_apply_event "failed" "apply failed: rev=r${target_version}; reason=artifact metadata missing; artifact_url_present=$([[ -n "$artifact_url" ]] && echo yes || echo no); sha256_present=$([[ -n "$artifact_sha256" ]] && echo yes || echo no)" "E_RECONCILE" "$target_version" "$target_version"
    return 1
  }

  if [[ ! -x "$APPLY_HOOK" ]]; then
    set_last_error "apply hook missing"
    enqueue_apply_event "failed" "apply failed: rev=r${target_version}; reason=apply hook missing; hook=${APPLY_HOOK}" "E_HOOK" "$target_version" "$target_version"
    return 1
  fi

  local output="" err_code="" err_message="" err_detail="" hook_tail="" apply_detail="" failed_message="" success_message=""
  if ! output="$("$APPLY_HOOK" "$target_version" "$artifact_url" "$artifact_sha256" "$reload_cmd" 2>&1)"; then
    err_code="$(extract_hook_field "ERROR_CODE" "$output")"
    err_message="$(extract_hook_field "ERROR_MESSAGE" "$output")"
    err_detail="$(extract_hook_field "ERROR_DETAIL" "$output")"
    hook_tail="$(extract_hook_tail "$output")"
    [[ -n "$err_code" ]] || err_code="E_APPLY"
    [[ -n "$err_message" ]] || err_message="artifact apply failed"
    set_last_error "$err_code: $err_message"
    failed_message="apply failed: rev=r${target_version}; code=${err_code}; reason=${err_message}; sha256=${short_sha}"
    [[ -n "$err_detail" ]] && failed_message="${failed_message}; detail=${err_detail}"
    [[ -n "$hook_tail" ]] && failed_message="${failed_message}; output=${hook_tail}"
    enqueue_apply_event "failed" "$failed_message" "$err_code" "$target_version" "$target_version"
    return 1
  fi

  apply_detail="$(extract_hook_field "APPLY_DETAIL" "$output")"
  if echo "$target_version" > "$VERSION_FILE"; then
    clear_last_error
    success_message="apply ok: rev=r${target_version}; sha256=${short_sha}; reload=$([[ -n "$reload_cmd" && "$reload_cmd" != "nodehub-protocol-restart" ]] && echo custom || echo default)"
    [[ -n "$apply_detail" ]] && success_message="${success_message}; detail=${apply_detail}"
    enqueue_apply_event "ok" "$success_message" "" "$target_version" "$target_version"
    return 0
  fi

  set_last_error "E_STATE: failed to persist version"
  enqueue_apply_event "failed" "apply failed: rev=r${target_version}; code=E_STATE; reason=failed to persist version; sha256=${short_sha}" "E_STATE" "$target_version" "$target_version"
  return 1
}

reconcile_once() {
  local current_version response target_version needs_update artifact_url artifact_sha256 reload_cmd
  current_version="$(read_current_version)"

  response="$(curl -fsS --max-time 20 "$API_BASE/agent/reconcile?node_id=$NODE_ID&current_version=$current_version" \
    -H "X-Node-Token: $NODE_TOKEN")" || {
    set_last_error "reconcile request failed"
    return 1
  }

  target_version="$(json_number_field "target_version" "$response")"
  needs_update="$(json_bool_field "needs_update" "$response")"
  artifact_url="$(json_string_field "artifact_url" "$response")"
  artifact_sha256="$(json_string_field "sha256" "$response")"
  reload_cmd="$(json_string_field "reload_cmd" "$response")"

  if [[ "$needs_update" != "true" ]]; then
    clear_last_error
    return 0
  fi

  [[ -n "$target_version" ]] || {
    set_last_error "invalid reconcile response"
    enqueue_apply_event "failed" "apply failed: rev=r${current_version}; code=E_RECONCILE; reason=invalid reconcile response; payload=${response}" "E_RECONCILE" "$current_version" "$current_version"
    return 1
  }

  if [[ "$target_version" -le "$current_version" ]]; then
    clear_last_error
    return 0
  fi

  apply_target_release "$target_version" "$artifact_url" "$artifact_sha256" "$reload_cmd"
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

# Default apply hook: download -> verify -> stage -> validate -> atomic switch -> reload -> health
cat > "$APPLY_HOOK" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

TARGET_REV="${1:-}"
ARTIFACT_URL="${2:-}"
EXPECTED_SHA256="${3:-}"
RELOAD_CMD="${4:-}"

CONFIG_FILE="__NODEHUB_CONFIG_FILE__"
[[ -f "$CONFIG_FILE" ]] || { echo "ERROR_CODE=E_CONFIG"; echo "ERROR_MESSAGE=config file missing"; exit 1; }
# shellcheck source=/dev/null
source "$CONFIG_FILE"

RELEASES_DIR="$STATE_DIR/releases"
STAGING_ROOT="$STATE_DIR/staging"
CURRENT_LINK="$STATE_DIR/current"
PROTO_PIDFILE_LEGACY="$STATE_DIR/protocol.pid"
CERT_CRT="${CONFIG_ROOT}/cert/server.crt"
CERT_KEY="${CONFIG_ROOT}/cert/server.key"

mkdir -p "$RELEASES_DIR" "$STAGING_ROOT"
APPLY_STAGE="init"
APPLY_ACTION_SING_BOX=""
APPLY_ACTION_XRAY=""

fail_with() {
  local code="$1" msg="$2" extra_detail="${3:-}"
  local detail="stage=${APPLY_STAGE}; rev=r${TARGET_REV}"
  [[ -n "$APPLY_ACTION_SING_BOX" ]] && detail="${detail}; action_sing_box=${APPLY_ACTION_SING_BOX}"
  [[ -n "$APPLY_ACTION_XRAY" ]] && detail="${detail}; action_xray=${APPLY_ACTION_XRAY}"
  [[ -n "$RELOAD_CMD" ]] && detail="${detail}; reload_cmd=${RELOAD_CMD}"
  [[ -n "$extra_detail" ]] && detail="${detail}; ${extra_detail}"
  echo "ERROR_CODE=$code"
  echo "ERROR_MESSAGE=$msg"
  echo "ERROR_DETAIL=$detail"
  exit 1
}

summarize_command_output() {
  local raw="$1"
  local summary=""
  summary="$(
    printf '%s\n' "$raw" \
      | tr '\r' '\n' \
      | awk 'NF { gsub(/[[:space:]]+/, " "); sub(/^ /, ""); sub(/ $/, ""); print }' \
      | head -n 8 \
      | paste -sd ' || ' -
  )"
  [[ -n "$summary" ]] || summary="(no output)"
  printf '%s' "${summary:0:1200}"
}

calc_sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return
  fi
  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $2}'
    return
  fi
  fail_with "E_HASH" "no sha256 tool available"
}

decode_base64_to_file() {
  local data="$1" outfile="$2"
  if command -v base64 >/dev/null 2>&1; then
    if printf '%s' "$data" | base64 -d > "$outfile" 2>/dev/null; then return 0; fi
    if printf '%s' "$data" | base64 --decode > "$outfile" 2>/dev/null; then return 0; fi
  fi
  if command -v openssl >/dev/null 2>&1; then
    if printf '%s' "$data" | openssl base64 -d -A > "$outfile" 2>/dev/null; then return 0; fi
  fi
  return 1
}

replace_token_file() {
  local token="$1" value="$2" file="$3" esc tmp
  esc="$(printf '%s' "$value" | sed 's/[\/&]/\\&/g')"
  tmp="${file}.tmp.$$"
  sed "s/${token}/${esc}/g" "$file" > "$tmp"
  mv "$tmp" "$file"
}

extract_bundle() {
  local bundle_file="$1" out_dir="$2"
  local header line entry path b64

  header="$(head -n 1 "$bundle_file" | tr -d '\r')"
  [[ "$header" == "NODEHUB-BUNDLE-V1" ]] || fail_with "E_PARSE" "invalid bundle header"

  rm -rf "$out_dir"
  mkdir -p "$out_dir"

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" == file=* ]] || continue
    entry="${line#file=}"
    path="${entry%%|*}"
    b64="${entry#*|}"
    [[ -n "$path" && "$path" != "$entry" ]] || fail_with "E_PARSE" "invalid file entry"
    [[ "$path" != /* && "$path" != *".."* ]] || fail_with "E_PARSE" "unsafe path in bundle"

    mkdir -p "$(dirname "$out_dir/$path")"
    decode_base64_to_file "$b64" "$out_dir/$path" || fail_with "E_PARSE" "failed to decode bundle file $path"
  done < "$bundle_file"
}

pidfile_for_engine() {
  local engine="$1"
  case "$engine" in
    sing-box) printf '%s\n' "$STATE_DIR/protocol-sing-box.pid" ;;
    xray) printf '%s\n' "$STATE_DIR/protocol-xray.pid" ;;
    *) return 1 ;;
  esac
}

logfile_for_engine() {
  local engine="$1"
  case "$engine" in
    sing-box) printf '%s\n' "$STATE_DIR/protocol-sing-box.log" ;;
    xray) printf '%s\n' "$STATE_DIR/protocol-xray.log" ;;
    *) return 1 ;;
  esac
}

revfile_for_engine() {
  local engine="$1"
  case "$engine" in
    sing-box) printf '%s\n' "$STATE_DIR/protocol-sing-box.rev" ;;
    xray) printf '%s\n' "$STATE_DIR/protocol-xray.rev" ;;
    *) return 1 ;;
  esac
}

clear_engine_rev() {
  local engine="$1" revfile=""
  revfile="$(revfile_for_engine "$engine")" || return 0
  rm -f "$revfile"
}

mark_engine_rev() {
  local engine="$1" rev="$2" revfile=""
  revfile="$(revfile_for_engine "$engine")" || return 1
  printf '%s\n' "$rev" > "$revfile"
}

is_engine_running_rev() {
  local engine="$1" rev="$2" pidfile="" revfile="" pid="" active_rev=""
  pidfile="$(pidfile_for_engine "$engine")" || return 1
  revfile="$(revfile_for_engine "$engine")" || return 1

  [[ -f "$pidfile" && -f "$revfile" ]] || return 1
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  active_rev="$(cat "$revfile" 2>/dev/null || true)"
  [[ -n "$pid" && "$active_rev" == "$rev" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

stop_pidfile_process() {
  local pidfile="$1"
  local pid=""
  [[ -f "$pidfile" ]] && pid="$(cat "$pidfile" 2>/dev/null || true)" || true
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
}

stop_legacy_protocol() {
  stop_pidfile_process "$PROTO_PIDFILE_LEGACY"
}

stop_protocol_engine() {
  local engine="$1" pidfile=""
  pidfile="$(pidfile_for_engine "$engine")" || return 0
  stop_pidfile_process "$pidfile"
  clear_engine_rev "$engine"
}

start_protocol_engine() {
  local engine="$1" release_dir="$2"
  local config_file="" pidfile="" logfile=""
  pidfile="$(pidfile_for_engine "$engine")" || return 15
  logfile="$(logfile_for_engine "$engine")" || return 15

  mkdir -p "$(dirname "$pidfile")"
  mkdir -p "$(dirname "$logfile")"

  if [[ "$engine" == "sing-box" ]]; then
    config_file="$release_dir/sing-box.json"
    [[ -f "$config_file" ]] || return 11
    command -v sing-box >/dev/null 2>&1 || return 12
    nohup sing-box run -c "$config_file" > "$logfile" 2>&1 &
  elif [[ "$engine" == "xray" ]]; then
    config_file="$release_dir/xray.json"
    [[ -f "$config_file" ]] || return 13
    command -v xray >/dev/null 2>&1 || return 14
    nohup xray run -config "$config_file" > "$logfile" 2>&1 &
  else
    return 15
  fi

  local pid="$!"
  echo "$pid" > "$pidfile"
  sleep 1
  kill -0 "$pid" 2>/dev/null || return 16
  return 0
}

validate_release_engine() {
  local engine="$1" release_dir="$2"
  local check_cmd="" check_output="" rc=0 output_summary=""
  if [[ "$engine" == "sing-box" ]]; then
    [[ -f "$release_dir/sing-box.json" ]] || fail_with "E_VALIDATE" "sing-box.json missing" "engine=sing-box; file=${release_dir}/sing-box.json"
    replace_token_file "__NODEHUB_CERT_CRT__" "$CERT_CRT" "$release_dir/sing-box.json"
    replace_token_file "__NODEHUB_CERT_KEY__" "$CERT_KEY" "$release_dir/sing-box.json"
    command -v sing-box >/dev/null 2>&1 || fail_with "E_VALIDATE" "sing-box binary missing" "engine=sing-box; command=sing-box"
    check_cmd="sing-box check -c \"$release_dir/sing-box.json\""
    check_output="$(sh -lc "$check_cmd" 2>&1)" && rc=0 || rc=$?
    if [[ "$rc" -ne 0 ]]; then
      output_summary="$(summarize_command_output "$check_output")"
      fail_with "E_VALIDATE" "sing-box config check failed" "engine=sing-box; cmd=${check_cmd}; exit_code=${rc}; output=${output_summary}"
    fi
    return 0
  fi

  if [[ "$engine" == "xray" ]]; then
    [[ -f "$release_dir/xray.json" ]] || fail_with "E_VALIDATE" "xray.json missing" "engine=xray; file=${release_dir}/xray.json"
    replace_token_file "__NODEHUB_CERT_CRT__" "$CERT_CRT" "$release_dir/xray.json"
    replace_token_file "__NODEHUB_CERT_KEY__" "$CERT_KEY" "$release_dir/xray.json"
    command -v xray >/dev/null 2>&1 || fail_with "E_VALIDATE" "xray binary missing" "engine=xray; command=xray"
    check_cmd="xray run -test -config \"$release_dir/xray.json\""
    check_output="$(sh -lc "$check_cmd" 2>&1)" && rc=0 || rc=$?
    if [[ "$rc" -ne 0 ]]; then
      output_summary="$(summarize_command_output "$check_output")"
      fail_with "E_VALIDATE" "xray config check failed" "engine=xray; cmd=${check_cmd}; exit_code=${rc}; output=${output_summary}"
    fi
    return 0
  fi

  fail_with "E_VALIDATE" "unsupported engine: $engine"
}

read_manifest_field() {
  local release_dir="$1" key="$2" mf
  mf="$release_dir/manifest.env"
  [[ -f "$mf" ]] || return 0
  awk -F= -v target="$key" '$1==target{ print $2; exit }' "$mf"
}

normalize_action() {
  local action="$1"
  case "$action" in
    apply|stop) printf '%s\n' "$action" ;;
    '') printf '%s\n' "" ;;
    *) fail_with "E_PARSE" "invalid action value: $action" ;;
  esac
}

resolve_engine_actions() {
  local release_dir="$1"
  local action_sing_box="" action_xray=""
  action_sing_box="$(normalize_action "$(read_manifest_field "$release_dir" "ACTION_SING_BOX")")"
  action_xray="$(normalize_action "$(read_manifest_field "$release_dir" "ACTION_XRAY")")"

  [[ -n "$action_sing_box" ]] || fail_with "E_PARSE" "ACTION_SING_BOX missing in bundle"
  [[ -n "$action_xray" ]] || fail_with "E_PARSE" "ACTION_XRAY missing in bundle"
  printf '%s|%s\n' "$action_sing_box" "$action_xray"
}

apply_release() {
  local rev="$1" artifact_url="$2" expected_sha="$3" reload_cmd="$4"
  local tmp_dir bundle_file actual_sha release_dir stage_dir action_result
  local action_sing_box action_xray
  local reload_mode="default"
  local start_sing_box="no" start_xray="no" stop_sing_box="no" stop_xray="no"
  tmp_dir="$(mktemp -d 2>/dev/null || mktemp -d -t nodehub-apply)"
  bundle_file="$tmp_dir/bundle.txt"
  stage_dir="$STAGING_ROOT/r${rev}"
  release_dir="$RELEASES_DIR/r${rev}"

  APPLY_STAGE="download"
  curl -fsS --max-time 60 "$artifact_url" -H "X-Node-Token: $NODE_TOKEN" -o "$bundle_file" || fail_with "E_DOWNLOAD" "artifact download failed"
  APPLY_STAGE="verify_sha256"
  actual_sha="$(calc_sha256_file "$bundle_file")"
  [[ -n "$actual_sha" && "$actual_sha" == "$expected_sha" ]] || fail_with "E_HASH" "artifact sha256 mismatch"

  APPLY_STAGE="extract_bundle"
  extract_bundle "$bundle_file" "$stage_dir"
  APPLY_STAGE="parse_manifest"
  action_result="$(resolve_engine_actions "$stage_dir")"
  action_sing_box="${action_result%%|*}"
  action_xray="${action_result#*|}"
  APPLY_ACTION_SING_BOX="$action_sing_box"
  APPLY_ACTION_XRAY="$action_xray"

  if [[ "$action_sing_box" == "apply" ]]; then
    APPLY_STAGE="validate_sing_box"
    validate_release_engine "sing-box" "$stage_dir"
  fi
  if [[ "$action_xray" == "apply" ]]; then
    APPLY_STAGE="validate_xray"
    validate_release_engine "xray" "$stage_dir"
  fi

  APPLY_STAGE="activate_release"
  rm -rf "$release_dir"
  mv "$stage_dir" "$release_dir"
  ln -sfn "$release_dir" "$CURRENT_LINK"

  if [[ -n "$reload_cmd" && "$reload_cmd" != "nodehub-protocol-restart" ]]; then
    reload_mode="custom"
    APPLY_STAGE="custom_reload"
    sh -lc "$reload_cmd" >/dev/null 2>&1 || fail_with "E_RELOAD" "custom reload command failed"
  else
    APPLY_STAGE="restart_protocol"
    stop_legacy_protocol
    if [[ "$action_sing_box" == "stop" ]]; then
      stop_sing_box="yes"
      stop_protocol_engine "sing-box"
    fi
    if [[ "$action_xray" == "stop" ]]; then
      stop_xray="yes"
      stop_protocol_engine "xray"
    fi
    if [[ "$action_sing_box" == "apply" ]]; then
      if ! is_engine_running_rev "sing-box" "$rev"; then
        stop_sing_box="yes"
        stop_protocol_engine "sing-box"
        APPLY_STAGE="start_sing_box"
        start_protocol_engine "sing-box" "$release_dir" || fail_with "E_HEALTH" "failed to start sing-box process"
        start_sing_box="yes"
        APPLY_STAGE="mark_sing_box_revision"
        mark_engine_rev "sing-box" "$rev" || fail_with "E_STATE" "failed to persist sing-box revision marker"
      fi
    fi
    if [[ "$action_xray" == "apply" ]]; then
      if ! is_engine_running_rev "xray" "$rev"; then
        stop_xray="yes"
        stop_protocol_engine "xray"
        APPLY_STAGE="start_xray"
        start_protocol_engine "xray" "$release_dir" || fail_with "E_HEALTH" "failed to start xray process"
        start_xray="yes"
        APPLY_STAGE="mark_xray_revision"
        mark_engine_rev "xray" "$rev" || fail_with "E_STATE" "failed to persist xray revision marker"
      fi
    fi
  fi

  APPLY_STAGE="cleanup"
  rm -rf "$tmp_dir"

  echo "APPLY_DETAIL=stage=done; rev=r${rev}; sha256=${actual_sha}; action_sing_box=${action_sing_box}; action_xray=${action_xray}; reload_mode=${reload_mode}; stop_sing_box=${stop_sing_box}; start_sing_box=${start_sing_box}; stop_xray=${stop_xray}; start_xray=${start_xray}"
}

[[ -n "$TARGET_REV" && -n "$ARTIFACT_URL" && -n "$EXPECTED_SHA256" ]] || fail_with "E_ARGS" "missing apply arguments"
apply_release "$TARGET_REV" "$ARTIFACT_URL" "$EXPECTED_SHA256" "$RELOAD_CMD"
echo "ERROR_CODE="
echo "ERROR_MESSAGE="
exit 0
EOF

# Replace placeholder config path
CONFIG_FILE_ESCAPED="$(printf '%s' "$CONFIG_FILE" | sed 's/[\/&]/\\&/g')"
sedi "s/__NODEHUB_CONFIG_FILE__/${CONFIG_FILE_ESCAPED}/g" "$RUNNER_SCRIPT"
sedi "s/__NODEHUB_CONFIG_FILE__/${CONFIG_FILE_ESCAPED}/g" "$APPLY_HOOK"
chmod 700 "$RUNNER_SCRIPT" || true
chmod 700 "$APPLY_HOOK" || true

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
# Priority: acme.sh (if openssl available) > lego (standalone, no deps)
# acme.sh is preferred because it's more mature and feature-rich
issue_certs() {
  [[ -n "$TLS_DOMAIN" || -n "$TLS_DOMAIN_ALT" ]] || return 0

  log "Applying for SSL certificates..."

  # Try acme.sh first if openssl is available
  if need_cmd openssl; then
    log "openssl detected, using acme.sh (preferred method)..."
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
    # File download uses mirror if configured
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
      --accountemail "admin@${MAIN_DOMAIN}" 2>/dev/null; then
      cd - >/dev/null || true
      warn "acme.sh installation failed"
      return 1
    fi
    cd - >/dev/null || true
    
    log "acme.sh installed, auto-renewal enabled via cron"
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
    if ! CF_Token="$CF_API_TOKEN" "$ACME_SH_EXEC" --issue "${DOMAINS_ARGS[@]}" --dns dns_cf --keylength ec-256; then
      warn "acme.sh certificate issuance failed (check Cloudflare API token permissions)"
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
    if ! "$ACME_SH_EXEC" --issue "${DOMAINS_ARGS[@]}" --standalone --keylength ec-256; then
      warn "acme.sh standalone issuance failed"
      return 1
    fi
  fi

  # Install certificate
  if ! "$ACME_SH_EXEC" --install-cert -d "$MAIN_DOMAIN" --ecc \
    --key-file "$CERT_DIR/server.key" \
    --fullchain-file "$CERT_DIR/server.crt"; then
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
    
    # Get latest lego version (use direct API, fallback to v4.32.0)
    local lego_version
    lego_version="$(curl -fsSL "$(direct_url "https://api.github.com/repos/go-acme/lego/releases/latest")" 2>/dev/null | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || echo "v4.32.0")"
    [[ -z "$lego_version" || "$lego_version" == *"{"* ]] && lego_version="v4.32.0"
    
    local lego_tarball="lego_${lego_version}_linux_${LEGO_ARCH}.tar.gz"
    local lego_url
    # File download uses mirror if configured
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
        run; then
      warn "lego certificate issuance failed (check Cloudflare API token permissions)"
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
        run; then
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
log "================================================"
log "Certificate Auto-Renewal Information:"
log "================================================"
if need_cmd openssl && [[ -x "${ACME_SH_DIR:-/root/.acme.sh}/acme.sh" ]]; then
  log "acme.sh is installed with automatic renewal enabled."
  log "Certificates will be checked and renewed daily via cron."
  log "Check renewal status: ${ACME_SH_DIR:-/root/.acme.sh}/acme.sh --list"
elif [[ -x "/usr/local/bin/lego" ]] || [[ -x "${HOME}/.local/bin/lego" ]]; then
  log "lego is installed. For auto-renewal, add a cron job:"
  log "  0 0 * * * /usr/local/bin/lego --path /etc/nodehub-agent/.lego renew --days 30"
fi
log "================================================"
