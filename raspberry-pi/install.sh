#!/usr/bin/env bash
set -euo pipefail

umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
requested_profile=""
dry_run=false
reconfigure=false
install_docker_requested=false
assume_yes=false
skip_camera_check=false

usage() {
  cat <<'EOF'
Usage: ./raspberry-pi/install.sh [options]

First-run installer for Raspberry Pi 4 and Raspberry Pi 5.

Options:
  --dry-run            Read-only compatibility and prerequisite check
  --configure          Replace camera configuration using the wizard
  --install-docker     Install Docker Engine from Docker's signed apt repository
  --skip-camera-check  Do not require camera TCP port 322 to be reachable
  --pi4 | --pi5        Override automatic model profile selection
  --yes                Accept safe defaults and installation confirmations
  -h, --help           Show this help
EOF
}

while (($#)); do
  case "$1" in
    --dry-run) dry_run=true ;;
    --configure) reconfigure=true ;;
    --install-docker) install_docker_requested=true ;;
    --skip-camera-check) skip_camera_check=true ;;
    --pi4) requested_profile="pi4" ;;
    --pi5) requested_profile="pi5" ;;
    --yes) assume_yes=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

confirm() {
  local prompt="$1" default="${2:-no}" answer
  if $assume_yes; then return 0; fi
  [[ -t 0 ]] || die "${prompt} Run interactively or pass --yes when appropriate."
  if [[ "$default" == "yes" ]]; then
    read -r -p "${prompt} [Y/n] " answer
    [[ -z "$answer" || "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
  else
    read -r -p "${prompt} [y/N] " answer
    [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
  fi
}

is_ipv4() {
  local ip_value="$1" octet
  [[ "$ip_value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS=. read -r -a ip_octets <<<"$ip_value"
  for octet in "${ip_octets[@]}"; do
    ((10#$octet >= 0 && 10#$octet <= 255)) || return 1
  done
}

valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && ((10#$1 >= 1024 && 10#$1 <= 65535)); }
valid_friendly_hostname() { [[ "$1" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; }

prompt_default() {
  local variable="$1" prompt="$2" default="$3" answer
  if $assume_yes; then
    printf -v "$variable" '%s' "$default"
    return
  fi
  read -r -p "${prompt} [${default}]: " answer
  printf -v "$variable" '%s' "${answer:-$default}"
}

[[ "$(uname -s)" == "Linux" ]] || die "This installer must run on the Raspberry Pi."
[[ -r /proc/device-tree/model ]] || die "Raspberry Pi model information is unavailable."

model="$(tr -d '\0' </proc/device-tree/model)"
case "$model" in
  *"Raspberry Pi 5"*) detected_profile="pi5" ;;
  *"Raspberry Pi 4"*) detected_profile="pi4" ;;
  *) die "Unsupported model: ${model}. Only Raspberry Pi 4 and Pi 5 are supported." ;;
esac
profile="${requested_profile:-$detected_profile}"
if [[ "$profile" != "$detected_profile" ]]; then
  say "Warning: selected ${profile}, but detected ${model}."
  $dry_run || confirm "Continue with the selected profile?" no || exit 1
fi

machine="$(uname -m)"
userland="$(dpkg --print-architecture 2>/dev/null || true)"
case "${machine}:${userland}" in
  aarch64:arm64|arm64:arm64) runtime_arch="ARM64" ;;
  aarch64:armhf|arm64:armhf|armv7l:armhf|armv8l:armhf) runtime_arch="ARM32v7" ;;
  *) die "Unsupported kernel/userland combination: ${machine}/${userland:-unknown}." ;;
esac

[[ -r /etc/os-release ]] || die "/etc/os-release is missing."
# shellcheck disable=SC1091
source /etc/os-release
case "${ID:-}" in
  debian|raspbian) ;;
  *) die "Unsupported OS '${PRETTY_NAME:-unknown}'. Use Raspberry Pi OS or Debian." ;;
esac

memory_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
free_kb="$(df -Pk "$project_dir" | awk 'NR==2 {print $4}')"
((free_kb >= 2097152)) || die "At least 2 GiB of free storage is required."

host_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')"
if ! is_ipv4 "$host_ip"; then
  host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
is_ipv4 "$host_ip" || die "Could not determine this Pi's LAN IPv4 address."

say "Wyze Monitor preflight"
say "  Model:        ${model}"
say "  Profile:      ${profile}"
say "  OS:           ${PRETTY_NAME:-unknown}"
say "  Architecture: ${runtime_arch} (${userland})"
say "  Memory:       $((memory_kb / 1024)) MiB"
say "  Free storage: $((free_kb / 1024)) MiB"
say "  LAN address:  ${host_ip}"
if ((memory_kb < 1900000)); then
  say "  Warning: less than 2 GiB RAM; local multi-camera display may be constrained."
fi

docker_available=false
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker_available=true
  say "  Docker:       available to current user"
elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1 && systemctl is-active --quiet docker; then
  docker_available=true
  say "  Docker:       installed; sudo authentication may be requested"
elif command -v docker >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1 && sudo -n docker compose version >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
  docker_available=true
  say "  Docker:       available through sudo"
else
  say "  Docker:       missing or inaccessible"
fi

if $dry_run; then
  [[ -f "${project_dir}/cameras.yaml" ]] && say "  Cameras:      configuration present" || say "  Cameras:      configuration required"
  say "Dry run complete. No files, packages, services or containers were changed."
  exit 0
fi

run_root() {
  if ((EUID == 0)); then "$@"; else command -v sudo >/dev/null || die "sudo is required."; sudo "$@"; fi
}

install_docker() {
  command -v apt-get >/dev/null || die "apt-get is required to install Docker."
  command -v curl >/dev/null 2>&1 || {
    run_root apt-get update
    run_root apt-get install -y ca-certificates curl
  }

  local repo_family key_url repo_url keyring sources arch
  arch="$(dpkg --print-architecture)"
  # Docker directs Pi OS ARM64 to Debian; current ARMHF also uses Debian.
  # https://docs.docker.com/engine/install/raspberry-pi-os/
  repo_family="debian"
  key_url="https://download.docker.com/linux/${repo_family}/gpg"
  repo_url="https://download.docker.com/linux/${repo_family}"
  keyring="/etc/apt/keyrings/docker.asc"
  sources="/etc/apt/sources.list.d/docker.sources"

  say "Installing Docker from ${repo_url} using its signed apt repository."
  run_root apt-get update
  run_root apt-get install -y ca-certificates curl
  run_root install -m 0755 -d /etc/apt/keyrings
  run_root curl -fsSL "$key_url" -o "$keyring"
  run_root chmod a+r "$keyring"
  printf 'Types: deb\nURIs: %s\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: %s\n' \
    "$repo_url" "${VERSION_CODENAME}" "$arch" "$keyring" | run_root tee "$sources" >/dev/null
  run_root apt-get update
  run_root apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  run_root systemctl enable --now docker

  say "Docker was installed without adding users to the root-equivalent docker group."
  say "The installer will use sudo when direct Docker access is unavailable."
}

install_launchers() {
  local icon_dir="/usr/local/share/icons/hicolor/scalable/apps"
  local application_dir="/usr/local/share/applications"
  local desktop_dir="" desktop_launcher

  chmod 700 "${script_dir}/wyze-monitor"
  run_root ln -sfn "${script_dir}/wyze-monitor" /usr/local/bin/wyze-monitor
  run_root install -d -m 0755 "$icon_dir" "$application_dir"
  run_root install -m 0644 "${script_dir}/wyze-monitor.svg" "${icon_dir}/wyze-monitor.svg"
  run_root install -m 0644 "${script_dir}/wyze-monitor.desktop" "${application_dir}/wyze-monitor.desktop"

  if command -v xdg-user-dir >/dev/null 2>&1; then
    desktop_dir="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
  elif [[ -d "${HOME}/Desktop" ]]; then
    desktop_dir="${HOME}/Desktop"
  fi
  if [[ -n "$desktop_dir" && -d "$desktop_dir" ]]; then
    desktop_launcher="${desktop_dir}/Wyze Monitor.desktop"
    install -m 0755 "${script_dir}/wyze-monitor.desktop" "$desktop_launcher"
    if command -v gio >/dev/null 2>&1; then
      gio set "$desktop_launcher" metadata::trusted true >/dev/null 2>&1 || true
    fi
    say "Desktop launcher: ${desktop_launcher}"
  else
    say "No desktop folder detected; the application-menu launcher was installed for Desktop editions."
  fi
  say "SSH command: wyze-monitor"
}

install_friendly_url() {
  local friendly_hostname="${FRIENDLY_HOSTNAME:-wyze-monitor}" resolved_ip=""
  valid_friendly_hostname "$friendly_hostname" || die "Invalid friendly hostname: ${friendly_hostname}."
  [[ "${FRIENDLY_HTTP_PORT:-80}" == "80" ]] || die "The no-port friendly URL requires FRIENDLY_HTTP_PORT=80."

  if ! command -v avahi-publish-address >/dev/null 2>&1; then
    say "Installing Raspberry Pi OS local-name support (avahi-daemon and avahi-utils)."
    run_root apt-get update
    run_root apt-get install -y avahi-daemon avahi-utils
  fi
  run_root systemctl enable --now avahi-daemon

  resolved_ip="$(timeout 3 avahi-resolve-host-name -4 "${friendly_hostname}.local" 2>/dev/null | awk 'NR==1 {print $2}' || true)"
  if [[ -n "$resolved_ip" && "$resolved_ip" != "${PI_HOST_IP}" ]]; then
    die "${friendly_hostname}.local is already claimed by ${resolved_ip}. Choose a different friendly hostname."
  fi

  run_root install -d -m 0755 /usr/local/lib/wyze-monitor
  run_root install -m 0755 "${script_dir}/publish-friendly-url.sh" /usr/local/lib/wyze-monitor/publish-friendly-url.sh
  run_root install -m 0644 "${script_dir}/wyze-monitor-url.service" /etc/systemd/system/wyze-monitor-url.service
  printf 'WYZE_FRIENDLY_HOSTNAME=%s\n' "$friendly_hostname" | run_root tee /etc/default/wyze-monitor-url >/dev/null
  run_root chmod 0644 /etc/default/wyze-monitor-url
  run_root systemctl daemon-reload
  run_root systemctl enable --now wyze-monitor-url.service
  say "Friendly URL: http://${friendly_hostname}.local"
}

if ! $docker_available; then
  if ! $install_docker_requested; then
    confirm "Install Docker Engine from Docker's official signed apt repository?" yes || die "Docker is required."
  fi
  install_docker
fi

if [[ ! -f "${project_dir}/cameras.yaml" || "$reconfigure" == true ]]; then
  configure_args=()
  $skip_camera_check && configure_args+=(--skip-camera-check)
  $assume_yes && configure_args+=(--yes)
  "${script_dir}/configure.sh" "${configure_args[@]}"
else
  say "Keeping existing cameras.yaml. Use --configure to replace it."
fi

chmod 600 "${project_dir}/cameras.yaml"

env_file="${script_dir}/.env"
if [[ ! -f "$env_file" ]]; then
  selected_ip="$host_ip"
  friendly_hostname=wyze-monitor
  monitor_port=18765
  webrtc_port=18555
  prompt_default selected_ip "Pi LAN IPv4 address" "$selected_ip"
  is_ipv4 "$selected_ip" || die "Invalid Pi LAN IPv4 address: ${selected_ip}"
  prompt_default friendly_hostname "Friendly URL name (http://NAME.local)" "$friendly_hostname"
  valid_friendly_hostname "$friendly_hostname" || die "Use lowercase letters, numbers and internal hyphens only."
  prompt_default monitor_port "Diagnostic dashboard TCP port" "$monitor_port"
  valid_port "$monitor_port" || die "Dashboard port must be from 1024 to 65535."
  prompt_default webrtc_port "WebRTC TCP/UDP port" "$webrtc_port"
  valid_port "$webrtc_port" || die "WebRTC port must be from 1024 to 65535."
  [[ "$monitor_port" != "$webrtc_port" ]] || die "Dashboard and WebRTC ports must differ."
  printf 'PI_HOST_IP=%s\nFRIENDLY_HOSTNAME=%s\nFRIENDLY_HTTP_PORT=80\nMONITOR_PUBLIC_PORT=%s\nWEBRTC_PUBLIC_PORT=%s\nDEFAULT_QUALITY=main\n' \
    "$selected_ip" "$friendly_hostname" "$monitor_port" "$webrtc_port" >"$env_file"
  chmod 600 "$env_file"
  say "Saved ${env_file} with mode 600."
fi

if ! grep -q '^FRIENDLY_HOSTNAME=' "$env_file"; then
  printf '\nFRIENDLY_HOSTNAME=wyze-monitor\nFRIENDLY_HTTP_PORT=80\n' >>"$env_file"
fi
chmod 600 "$env_file"
# shellcheck disable=SC1090
set -a
source "$env_file"
set +a

install_launchers
install_friendly_url

say "Building and starting the isolated Wyze Monitor deployment."
"${script_dir}/setup.sh" "$profile"

# shellcheck disable=SC1090
source "$env_file"
health_url="http://${PI_HOST_IP}:${MONITOR_PUBLIC_PORT:-18765}/api/health"
healthy=false
for _ in {1..20}; do
  if command -v curl >/dev/null 2>&1 && curl -fsS "$health_url" >/dev/null 2>&1; then healthy=true; break; fi
  if command -v wget >/dev/null 2>&1 && wget -q -O /dev/null "$health_url"; then healthy=true; break; fi
  sleep 1
done
$healthy || die "Containers started, but ${health_url} did not become healthy."

say
say "Installation complete."
say "Open: http://${FRIENDLY_HOSTNAME:-wyze-monitor}.local"
say "Diagnostic address: ${health_url%/api/health}"
say "Confirm that every configured camera displays a live picture."
say "Run from SSH: wyze-monitor"
say "Reconfigure later with: wyze-monitor configure"
