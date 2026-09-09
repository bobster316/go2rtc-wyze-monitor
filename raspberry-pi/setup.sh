#!/usr/bin/env bash
set -euo pipefail

profile="${1:-pi5}"
[[ "$profile" == "pi5" || "$profile" == "pi4" ]] || {
  echo "Usage: ./raspberry-pi/setup.sh [pi5|pi4]" >&2
  exit 2
}
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"
command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
docker_cmd=(docker)
if ! docker compose version >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo docker compose version >/dev/null && sudo docker info >/dev/null; then
    docker_cmd=(sudo docker)
  else
    echo "Docker Engine and the Compose plugin must be installed and accessible." >&2
    exit 1
  fi
fi
dc() { "${docker_cmd[@]}" compose "$@"; }

machine="$(uname -m)"
userland="$(dpkg --print-architecture 2>/dev/null || true)"
case "${machine}:${userland}" in
  aarch64:arm64|arm64:arm64) runtime_arch="ARM64" ;;
  aarch64:armhf|arm64:armhf|armv7l:armhf|armv8l:armhf) runtime_arch="ARM32v7" ;;
  *)
    echo "Unsupported architecture: kernel=${machine}, userland=${userland:-unknown}." >&2
    echo "Expected Raspberry Pi OS arm64 or armhf on an ARMv7/ARMv8 kernel." >&2
    exit 1
    ;;
esac

model="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)"
if [[ "$profile" == "pi5" && -n "$model" && "$model" != *"Raspberry Pi 5"* ]]; then
  echo "Warning: pi5 profile selected on detected model: ${model}" >&2
fi
echo "Preflight: ${model:-unknown Pi model}; ${runtime_arch}; ${userland} userland."
if [[ "$userland" == "armhf" ]]; then
  echo "32-bit note: Docker Engine v29+ must use Debian armhf packages, not retired Raspbian packages."
fi

[[ -f ../cameras.yaml ]] || { echo "../cameras.yaml is missing." >&2; exit 1; }

if [[ ! -f .env ]]; then
  host_ip="$(hostname -I | awk '{print $1}')"
  sed "s/^PI_HOST_IP=.*/PI_HOST_IP=${host_ip}/" .env.example > .env
  chmod 600 .env
fi

set -a
source .env
set +a
if ! grep -q '^LOCAL_UID=' .env; then
  printf '\nLOCAL_UID=%s\nLOCAL_GID=%s\n' "$(id -u)" "$(id -g)" >> .env
fi
export LOCAL_UID="${LOCAL_UID:-$(id -u)}"
export LOCAL_GID="${LOCAL_GID:-$(id -g)}"
running="$("${docker_cmd[@]}" ps -q --filter label=com.docker.compose.project=wyze-monitor-rpi)"
if [[ -z "$running" ]]; then
  for port in "${FRIENDLY_HTTP_PORT:-80}" "${MONITOR_PUBLIC_PORT:-18765}" "${WEBRTC_PUBLIC_PORT:-18555}"; do
    ! ss -H -ltn "sport = :${port}" | grep -q . || {
      echo "Port ${port} is already in use." >&2
      exit 1
    }
  done
fi

mkdir -p runtime
chmod 700 runtime
override="compose.${profile}.yaml"
dc -f compose.yaml -f "$override" build monitor-web config-init
dc -f compose.yaml -f "$override" run --rm config-init
# Both services read configuration at startup. Recreate even when only the
# bind-mounted camera/YAML content changed, so reconfiguration actually applies.
dc -f compose.yaml -f "$override" up -d --force-recreate go2rtc monitor-web
dc -f compose.yaml -f "$override" ps
echo "Dashboard: http://${FRIENDLY_HOSTNAME:-wyze-monitor}.local"
echo "Diagnostic address: http://${PI_HOST_IP}:${MONITOR_PUBLIC_PORT:-18765}"
