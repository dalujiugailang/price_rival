# 本地 4001 常驻服务

本项目以生产模式构建后，由用户级 macOS LaunchAgent 托管。只监听 `127.0.0.1:4001`，使用本项目的 `data/price-rival.sqlite` 和 `.env.local`，关闭开发免登录。

- 主任务：`com.codex.competition-pricing`，`RunAtLoad=true`、`KeepAlive=true`，登录后启动，进程退出后自动恢复。
- 检查任务：`com.codex.competition-pricing.keepalive`，每 60 秒检查 `/api/auth/config` 的 HTTP 状态和登录配置 JSON，失败时 `launchctl kickstart -k` 重启主任务。
- LaunchAgent 配置：`~/Library/LaunchAgents/` 下的同名 plist。
- 实际执行脚本和日志：`~/Library/Application Support/CompetitionPricing/`。
- 此目录保存与安装版本一致的脚本和 plist。更新前，将旧文件移动到各自原目录的 `.archive/<UTC时间>/`，不直接删除。

## 查看状态

```zsh
launchctl print "gui/$(id -u)/com.codex.competition-pricing"
launchctl print "gui/$(id -u)/com.codex.competition-pricing.keepalive"
lsof -nP -iTCP:4001 -sTCP:LISTEN
curl --fail http://127.0.0.1:4001/api/auth/config
tail -n 10 "$HOME/Library/Application Support/CompetitionPricing/competition-pricing-keepalive.log"
```

检查任务在两次执行之间显示 `not running` 是正常的；应同时检查 `last exit code = 0` 和 `run interval = 60 seconds`。

## 更新前端或手动重启

在项目目录执行 `npm run build`，成功后：

```zsh
launchctl kickstart -k "gui/$(id -u)/com.codex.competition-pricing"
```

等待 API 恢复后打开 <http://127.0.0.1:4001/>。

## 运行边界

用户级服务在登录电脑后启动，注销后停止；电脑休眠期间不保证每分钟执行，唤醒后恢复。飞书登录沿用 `.env.local` 中已登记的回调地址；若该地址为本机 3000 端口，应用会额外启动仅监听 `127.0.0.1:3000` 的回调转接，不对局域网开放。
