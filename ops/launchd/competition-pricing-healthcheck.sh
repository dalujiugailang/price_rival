#!/bin/zsh
set -eu

service_label='com.codex.competition-pricing'
service_url='http://127.0.0.1:4001/api/auth/config'
timestamp="$(/bin/date '+%Y-%m-%d %H:%M:%S')"
node_bin='/opt/homebrew/bin/node'

# Validate the auth endpoint JSON as well as its status, rather than accepting a different site's HTTP 200.
if /usr/bin/curl --fail --silent --show-error --connect-timeout 3 --max-time 10 "$service_url" |
  "$node_bin" --input-type=module -e '
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    try {
      const config = JSON.parse(raw);
      if (typeof config.authConfigured !== "boolean" || config.devLoginEnabled !== false) process.exit(1);
    } catch { process.exit(1); }
  '; then
  print -- "$timestamp keepalive ok"
  exit 0
fi

print -- "$timestamp keepalive failed; restarting $service_label"
/bin/launchctl kickstart -k "gui/$(/usr/bin/id -u)/$service_label"
