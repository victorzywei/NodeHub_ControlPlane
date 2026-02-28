#!/usr/bin/env bash
set -euo pipefail

############################################
# NodeHub Agent Uninstall Script
# - Stop and remove systemd services or cron jobs
# - Remove agent files and configurations
# - Optionally remove xray/sing-box binaries
# - Optionally remove acme.sh and certificates
############################################

# ---------- Defaults ----------
REMOVE_BINARIES=0
REMOVE_CERTS=0
FORCE=0

# ---------- Helpers ----------
log()  { printf '%s\n' "[INFO] $*"; }
warn() { printf '%s\n' "[WARN] $*" >&2; }
die()  { printf '%s\n' "[ERR ] $*" >&2; exit 1; }

is_root() { [[ "${EUID:-$(id -u)}" -eq 0 ]]; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# ---------- Arg parsing ----------
usage() {
  cat <<EOF
Usage:
  $0 [options]

Options:
  --remove-binaries    Also remove xray and sing-box binaries
  --remove-certs       Also remove acme.sh and SSL certificates
  --force              Skip confirmation prompts
  -h, --help           Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remove-binaries) REMOVE_BINARIES=1; shift ;;
    --remove-certs) REMOVE_CERTS=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (use --help)" ;;
  esac
done

# ---------- Confirmation ----------
if [[ "$FORCE" -eq 0 ]]; then
  echo "This will uninstall NodeHub Agent and remove all related files."
  [[ "$REMOVE_BINARIES" -eq 1 ]] && echo "- Xray and sing-box binaries will be removed"
  [[ "$REMOVE_CERTS" -eq 1 ]] && echo "- acme.sh and SSL certificates will be removed"
  echo ""
  read -p "Are you sure you want to continue? (yes/no): " -r
  if [[ ! "$REPLY" =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
  fi
fi

# ---------- Detect install mode ----------
INSTALL_MODE="system"
if [[ -d "${HOME}/.local/lib/nodehub-agent" || -d "${HOME}/.config/nodehub-agent" ]]; then
  INSTALL_MODE="user"
  STATE_DIR="${HOME}/.local/share/nodehub-agent"
  AGENT_ROOT="${HOME}/.local/lib/nodehub-agent"
  CONFIG_ROOT="${HOME}/.config/nodehub-agent"
  XRAY_BIN="${HOME}/.local/bin/xray"
  SINGBOX_BIN="${HOME}/.local/bin/sing-box"
  ACME_SH_DIR="${HOME}/.acme.sh"
else
  INSTALL_MODE="system"
  STATE_DIR="/var/lib/nodehub-agent"
  AGENT_ROOT="/usr/local/lib/nodehub-agent"
  CONFIG_ROOT="/etc/nodehub-agent"
  XRAY_BIN="/usr/local/bin/xray"
  SINGBOX_BIN="/usr/local/bin/sing-box"
  ACME_SH_DIR="/root/.acme.sh"
fi

log "Detected install mode: $INSTALL_MODE"

# ---------- Stop and remove systemd services ----------
stop_systemd_services() {
  local systemctl_flag=""
  [[ "$INSTALL_MODE" == "user" ]] && systemctl_flag="--user"
  
  if need_cmd systemctl; then
    log "Stopping and disabling systemd services..."
    
    for service in nodehub-heartbeat.service nodehub-reconcile.service; do
      if systemctl $systemctl_flag is-active "$service" >/dev/null 2>&1; then
        systemctl $systemctl_flag stop "$service" 2>/dev/null || true
        log "Stopped $service"
      fi
      
      if systemctl $systemctl_flag is-enabled "$service" >/dev/null 2>&1; then
        systemctl $systemctl_flag disable "$service" 2>/dev/null || true
        log "Disabled $service"
      fi
    done
    
    # Remove service files
    if [[ "$INSTALL_MODE" == "user" ]]; then
      rm -f "${HOME}/.config/systemd/user/nodehub-heartbeat.service"
      rm -f "${HOME}/.config/systemd/user/nodehub-reconcile.service"
    else
      rm -f "/etc/systemd/system/nodehub-heartbeat.service"
      rm -f "/etc/systemd/system/nodehub-reconcile.service"
    fi
    
    systemctl $systemctl_flag daemon-reload 2>/dev/null || true
    log "Removed systemd service files"
  fi
}

# ---------- Remove cron jobs ----------
remove_cron_jobs() {
  log "Removing cron jobs..."
  
  # Remove from /etc/cron.d if exists
  if [[ -f "/etc/cron.d/nodehub-agent" ]]; then
    rm -f "/etc/cron.d/nodehub-agent"
    log "Removed /etc/cron.d/nodehub-agent"
  fi
  
  # Remove from user crontab
  if need_cmd crontab; then
    if crontab -l 2>/dev/null | grep -q 'agent-runner.sh cron_check'; then
      crontab -l 2>/dev/null | grep -v 'agent-runner.sh cron_check' | crontab - 2>/dev/null || true
      log "Removed cron job from user crontab"
    fi
  fi
}

# ---------- Stop running processes ----------
stop_processes() {
  log "Stopping running agent processes..."
  
  # Stop processes via PID files
  for pidfile in "$STATE_DIR/heartbeat.pid" "$STATE_DIR/reconcile.pid"; do
    if [[ -f "$pidfile" ]]; then
      local pid
      pid="$(cat "$pidfile" 2>/dev/null || true)"
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        log "Stopped process (PID: $pid)"
      fi
      rm -f "$pidfile"
    fi
  done
  
  # Fallback: kill by process name
  if need_cmd pkill; then
    pkill -f 'agent-runner.sh' 2>/dev/null || true
  fi
}

# ---------- Remove agent files ----------
remove_agent_files() {
  log "Removing agent files and directories..."
  
  [[ -d "$STATE_DIR" ]] && rm -rf "$STATE_DIR" && log "Removed $STATE_DIR"
  [[ -d "$AGENT_ROOT" ]] && rm -rf "$AGENT_ROOT" && log "Removed $AGENT_ROOT"
  [[ -d "$CONFIG_ROOT" ]] && rm -rf "$CONFIG_ROOT" && log "Removed $CONFIG_ROOT"
}

# ---------- Remove binaries ----------
remove_binaries() {
  if [[ "$REMOVE_BINARIES" -eq 1 ]]; then
    log "Removing xray and sing-box binaries..."
    
    [[ -f "$XRAY_BIN" ]] && rm -f "$XRAY_BIN" && log "Removed $XRAY_BIN"
    [[ -f "$SINGBOX_BIN" ]] && rm -f "$SINGBOX_BIN" && log "Removed $SINGBOX_BIN"
    
    # Remove xray data directories
    if [[ "$INSTALL_MODE" == "user" ]]; then
      [[ -d "${HOME}/.config/xray" ]] && rm -rf "${HOME}/.config/xray"
      [[ -d "${HOME}/.local/share/xray" ]] && rm -rf "${HOME}/.local/share/xray"
      [[ -d "${HOME}/.config/sing-box" ]] && rm -rf "${HOME}/.config/sing-box"
      [[ -d "${HOME}/.local/share/sing-box" ]] && rm -rf "${HOME}/.local/share/sing-box"
    else
      [[ -d "/usr/local/etc/xray" ]] && rm -rf "/usr/local/etc/xray"
      [[ -d "/usr/local/share/xray" ]] && rm -rf "/usr/local/share/xray"
      [[ -d "/var/log/xray" ]] && rm -rf "/var/log/xray"
      [[ -d "/etc/sing-box" ]] && rm -rf "/etc/sing-box"
      [[ -d "/var/lib/sing-box" ]] && rm -rf "/var/lib/sing-box"
      [[ -d "/var/log/sing-box" ]] && rm -rf "/var/log/sing-box"
    fi
    
    log "Removed proxy binaries and data"
  fi
}

# ---------- Remove certificates ----------
remove_certificates() {
  if [[ "$REMOVE_CERTS" -eq 1 ]]; then
    log "Removing acme.sh and SSL certificates..."
    
    if [[ -d "$ACME_SH_DIR" ]]; then
      # Try to uninstall acme.sh properly
      if [[ -x "${ACME_SH_DIR}/acme.sh" ]]; then
        "${ACME_SH_DIR}/acme.sh" --uninstall >/dev/null 2>&1 || true
      fi
      
      rm -rf "$ACME_SH_DIR"
      log "Removed $ACME_SH_DIR"
    fi
    
    # Remove acme.sh aliases from shell configs
    for rcfile in "${HOME}/.bashrc" "${HOME}/.cshrc" "${HOME}/.tcshrc" "${HOME}/.zshrc"; do
      if [[ -f "$rcfile" ]] && grep -q 'acme.sh' "$rcfile" 2>/dev/null; then
        sed -i.bak '/acme\.sh/d' "$rcfile" 2>/dev/null || true
      fi
    done
    
    log "Removed SSL certificates and acme.sh"
  fi
}

# ---------- Main uninstall process ----------
log "================================================"
log "NodeHub Agent Uninstall"
log "================================================"

stop_systemd_services
remove_cron_jobs
stop_processes
remove_agent_files
remove_binaries
remove_certificates

log "================================================"
log "NodeHub Agent has been successfully uninstalled."
log "================================================"

if [[ "$REMOVE_BINARIES" -eq 0 ]]; then
  log "Note: xray and sing-box binaries were not removed."
  log "      Use --remove-binaries to remove them."
fi

if [[ "$REMOVE_CERTS" -eq 0 ]]; then
  log "Note: SSL certificates and acme.sh were not removed."
  log "      Use --remove-certs to remove them."
fi

log "Done."
