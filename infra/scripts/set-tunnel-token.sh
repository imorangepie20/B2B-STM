#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/../.."
[[ -t 0 ]] || { echo 'Interactive terminal required' >&2; exit 1; }
[[ -f infra/secrets/tunnel.env ]] || { echo 'Initialize B2B secrets first' >&2; exit 1; }
if grep -Eq '^TUNNEL_TOKEN=.+' infra/secrets/tunnel.env; then
  echo 'Tunnel token is already configured; refusing replacement' >&2
  exit 1
fi
read -r -s -p 'Paste the new B2B tunnel Docker command (hidden), then Enter: ' command
printf '\n'
if [[ "$command" =~ --token[[:space:]]+([A-Za-z0-9_+/=-]+) ]]; then
  token=${BASH_REMATCH[1]}
elif [[ "$command" =~ ^[A-Za-z0-9_+/=-]{100,}$ ]]; then
  token=$command
else
  echo 'No valid tunnel token found; no changes made' >&2
  exit 1
fi
[[ ${#token} -ge 100 ]] || { echo 'Invalid token length' >&2; exit 1; }
umask 077
printf 'TUNNEL_TOKEN=%s\n' "$token" > infra/secrets/tunnel.env
chmod 600 infra/secrets/tunnel.env
unset token command
echo 'B2B tunnel token saved without displaying it.'
