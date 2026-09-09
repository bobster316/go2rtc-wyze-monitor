#!/usr/bin/env bash
set -euo pipefail

umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
output="${project_dir}/cameras.yaml"
camera_port=322
skip_network_check=false
assume_yes=false

usage() {
  cat <<'EOF'
Usage: ./raspberry-pi/configure.sh [options]

Interactive first-run camera configuration.

Options:
  --skip-camera-check  Save cameras even when TCP port 322 is unreachable
  --yes                Accept the final summary without another prompt
  -h, --help           Show this help
EOF
}

while (($#)); do
  case "$1" in
    --skip-camera-check) skip_network_check=true ;;
    --yes) assume_yes=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ ! -t 0 && "${WYZE_INSTALL_ALLOW_PIPED_INPUT:-0}" != "1" ]]; then
  echo "Camera configuration needs an interactive terminal." >&2
  exit 1
fi

confirm() {
  local prompt="$1" default="${2:-no}" answer
  if $assume_yes; then return 0; fi
  if [[ "$default" == "yes" ]]; then
    read -r -p "${prompt} [Y/n] " answer
    [[ -z "$answer" || "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
  else
    read -r -p "${prompt} [y/N] " answer
    [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
  fi
}

is_ipv4() {
  local ip="$1" octet
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS=. read -r -a octets <<<"$ip"
  for octet in "${octets[@]}"; do
    ((10#$octet >= 0 && 10#$octet <= 255)) || return 1
  done
}

yaml_quote() {
  local value="$1"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

slugify() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/_/g; s/^_+//; s/_+$//')"
  [[ -n "$value" ]] || value="camera"
  printf '%s' "$value"
}

camera_reachable() {
  local ip="$1"
  timeout 3 bash -c "exec 3<>/dev/tcp/${ip}/${camera_port}" >/dev/null 2>&1
}

declare -A used_ids=()
declare -a summary_names=() summary_ips=() summary_users=()
tmp="$(mktemp "${project_dir}/.cameras.yaml.tmp.XXXXXX")"
cleanup() { rm -f -- "$tmp"; }
trap cleanup EXIT INT TERM

printf '%s\n' \
  '# Created by raspberry-pi/configure.sh. Contains camera credentials.' \
  'ffmpeg: ffmpeg' \
  'defaultQuality: main' \
  '' \
  'cameras:' >"$tmp"

echo "Wyze Monitor camera setup"
echo "Enable RTSP/RTSPS in the Wyze app before continuing."
echo "For each camera enter its display name, reserved LAN IPv4 address,"
echo "RTSP username and RTSP password. Passwords are never displayed."
echo

camera_number=1
while true; do
  name=''
  while [[ -z "$name" ]]; do
    read -r -p "Camera ${camera_number} display name: " name
    [[ "$name" != *$'\n'* && "$name" != *$'\r'* ]] || name=''
  done

  base_id="$(slugify "$name")"
  camera_id="$base_id"
  suffix=2
  while [[ -n "${used_ids[$camera_id]:-}" ]]; do
    camera_id="${base_id}_${suffix}"
    ((suffix += 1))
  done
  used_ids[$camera_id]=1

  ip=''
  until is_ipv4 "$ip"; do
    read -r -p "Camera ${camera_number} LAN IPv4 address: " ip
    is_ipv4 "$ip" || echo "Enter an IPv4 address such as 192.168.1.50."
  done

  rtsp_user=''
  while [[ -z "$rtsp_user" ]]; do
    read -r -p "Camera ${camera_number} RTSP username: " rtsp_user
    [[ "$rtsp_user" != *$'\n'* && "$rtsp_user" != *$'\r'* ]] || rtsp_user=''
  done

  password=''
  while [[ -z "$password" ]]; do
    read -r -s -p "Camera ${camera_number} RTSP password: " password
    echo
    [[ "$password" != *$'\n'* && "$password" != *$'\r'* ]] || password=''
    [[ -n "$password" ]] || echo "Password cannot be empty."
  done

  if ! $skip_network_check; then
    if camera_reachable "$ip"; then
      echo "Camera ${camera_number}: ${ip}:${camera_port} is reachable."
    else
      echo "Warning: ${ip}:${camera_port} is not reachable from this Pi." >&2
      if ! confirm "Save this camera anyway?" no; then
        echo "Re-entering camera ${camera_number}."
        unset 'used_ids[$camera_id]'
        continue
      fi
    fi
  fi

  printf '  - id: %s\n    name: %s\n    ip: %s\n    user: %s\n    password: %s\n\n' \
    "$(yaml_quote "$camera_id")" \
    "$(yaml_quote "$name")" \
    "$(yaml_quote "$ip")" \
    "$(yaml_quote "$rtsp_user")" \
    "$(yaml_quote "$password")" >>"$tmp"

  summary_names+=("$name")
  summary_ips+=("$ip")
  summary_users+=("$rtsp_user")
  ((camera_number += 1))

  read -r -p "Add another camera? [y/N] " add_another
  [[ "$add_another" =~ ^[Yy]([Ee][Ss])?$ ]] || break
  unset add_another
done

printf '%s\n' \
  'streams:' \
  '  main: stream0' \
  '  sub: stream1' \
  '' \
  "port: ${camera_port}" \
  'tls: true' >>"$tmp"

echo
echo "Configuration summary (passwords hidden):"`r`n echo "If anything is wrong, answer N below and re-enter the wizard with ./raspberry-pi/install.sh --configure."
for ((i=0; i<${#summary_names[@]}; i++)); do
  printf '  %d. %s â€” %s â€” user %s\n' "$((i + 1))" "${summary_names[$i]}" "${summary_ips[$i]}" "${summary_users[$i]}"
done

confirm "Save ${#summary_names[@]} camera(s)? (answer N to cancel and re-run --configure)" yes || {
  echo "Configuration cancelled; no file was changed."
  exit 1
}

if [[ -f "$output" ]]; then
  backup="${output}.bak-$(date +%Y%m%d-%H%M%S)-$$"
  cp -p -- "$output" "$backup"
  echo "Previous configuration backed up to ${backup}."
fi

chmod 600 "$tmp"
mv -f -- "$tmp" "$output"
trap - EXIT INT TERM
echo "Saved ${output} with mode 600."



