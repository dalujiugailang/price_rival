#!/bin/zsh
set -eu

project_dir='/Users/dudu_1/Desktop/trae/重点日常项目/【拍拍】自动化竞争追价-云端复刻-20261015'
export PATH='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
cd "$project_dir"

exec /usr/bin/env \
  NODE_ENV=production \
  HOST=127.0.0.1 \
  PORT=4001 \
  AUTH_DEV_BYPASS=false \
  APP_URL=http://127.0.0.1:4001 \
  DATABASE_PATH="$project_dir/data/price-rival.sqlite" \
  RISK_OCR_URL=http://127.0.0.1:18080 \
  /opt/homebrew/bin/node --env-file="$project_dir/.env.local" server/index.mjs
