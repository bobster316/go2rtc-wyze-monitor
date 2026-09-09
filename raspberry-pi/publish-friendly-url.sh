#!/usr/bin/env bash
set -euo pipefail

friendly_hostname="${WYZE_FRIENDLY_HOSTNAME:-wyze-monitor}"
[[ "$friendly_hostname" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || {
  echo "Invalid Wyze Monitor friendly hostname: ${friendly_hostname}" >&2
  exit 2
}

command -v avahi-publish-address >/dev/null 2>&1 || {
  echo "avahi-publish-address is required for the friendly URL." >&2
  exit 1
}

publisher_pid=""
published_ip=""

stop_publisher() {
  if [[ -n "$publisher_pid" ]] && kill -0 "$publisher_pid" 2>/dev/null; then
    kill "$publisher_pid" 2>/dev/null || true
    wait "$publisher_pid" 2>/dev/null || true
  fi
  publisher_pid=""
}
trap stop_publisher EXIT INT TERM

while true; do
  current_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')"
  if [[ -z "$current_ip" ]]; then
    current_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi

  if [[ -n "$current_ip" && "$current_ip" != "$published_ip" ]]; then
    stop_publisher
    avahi-publish-address -R "${friendly_hostname}.local" "$current_ip" &
    publisher_pid=$!
    published_ip="$current_ip"
    echo "Published http://${friendly_hostname}.local -> ${current_ip}"
  elif [[ -n "$publisher_pid" ]] && ! kill -0 "$publisher_pid" 2>/dev/null; then
    wait "$publisher_pid" 2>/dev/null || true
    publisher_pid=""
    published_ip=""
  fi

  sleep 5
done
