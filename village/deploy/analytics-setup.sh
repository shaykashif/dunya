#!/usr/bin/env bash
# One-shot setup for the analytics collector on the server:
#   cd /var/www/dunya && git pull && (cd squad && npm install && npm run viewer:build) && sudo bash village/deploy/analytics-setup.sh
# Installs and starts the collector (systemd), publishes the nginx route /a/e, and sends a test event.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  # sudo often drops the user's PATH (nvm); look where the invoking user's node lives.
  NODE="$(sudo -u "${SUDO_USER:-root}" -i bash -lc 'command -v node' 2>/dev/null || true)"
fi
[ -x "$NODE" ] || { echo "node not found"; exit 1; }
echo "repo $REPO, node $NODE ($("$NODE" -v))"

cat > /etc/systemd/system/sim-analytics.service <<UNIT
[Unit]
Description=sim.shaykas.com anonymous analytics collector
After=network.target

[Service]
ExecStart=$NODE --no-warnings $REPO/analytics/collect.ts
Environment=PORT=5180
DynamicUser=yes
StateDirectory=sim-analytics
Restart=always
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable sim-analytics >/dev/null 2>&1
systemctl restart sim-analytics

# SELinux (Oracle Linux): let nginx talk to the collector on localhost.
if command -v setsebool >/dev/null 2>&1; then setsebool -P httpd_can_network_connect 1 || true; fi

cp "$REPO/village/deploy/sim.shaykas.com.conf" /etc/nginx/conf.d/sim.shaykas.com.conf
nginx -t
systemctl reload nginx

sleep 1
curl -fsS http://127.0.0.1:5180/a/health >/dev/null && echo "collector: up"
code="$(curl -sk -o /dev/null -w '%{http_code}' -X POST https://127.0.0.1/a/e -H 'Host: sim.shaykas.com' -d '{"name":"setup_test","sid":"setup"}')"
echo "nginx route /a/e: HTTP $code (204 is right)"
echo "report: sudo $NODE --no-warnings $REPO/analytics/report.ts"
