# 价格分析统一筛选

三个 tab 的批次、品牌、新机系列、PPV 匹配范围、时序所属批次和搜索统一放在 tab 正下方。当前视图不使用的控件原生 disabled 置灰，切换视图保留筛选值。日报建议使用第二个批次选择框，显示为“建议批次”；价格时序使用全部历史，仅所属批次筛选限制 PPV 集合，曲线仍保留完整历史。

验证：类型检查、生产构建、PriceAnalysis/PriceTimeline 组件测试、priceAnalysis/priceAnalysisCache 工具测试和 diff 检查通过。ego-browser 独立样本预览确认三个 tab 置灰状态、切换保留、品牌联动、时序搜索生效；1366px 下筛选区无横向溢出。预览文件在 outputs/filter-review-20261104，不随部署发布。

云端已更新三个生产组件并重建 price-rival；未更新其他服务。运行镜像 `sha256:2dbaabd005092ed9ada1b055124a8237f4cbbbd85ddf7db03e7bab24a9d796bf`，`/assets/index-BXUjDLw3.js` SHA-256 为 `662698ae066544a3e14d47fe2b23db8968ae2527447b0c01b83e2c0a387906a9`，与本地验证构建一致。

`/api/auth/config` 返回 200、authConfigured=true、devLoginEnabled=false；未登录首页及资源返回 401。浏览器云端会话停在飞书登录页，因此登录后的生产页面尚未视觉验收。

发布前后 price-rival.sqlite 与 tradein-risk.sqlite 的全部业务表逻辑内容摘要一致，quick_check 均为 ok。云端备份和核验记录位于 `/home/ubuntu/price_rival/deploy-backups/20261104-unified-price-filters`，包含源码归档、两个 SQLite 一致性备份、旧镜像编号、构建日志与 verification.json。旧镜像标签 `price-rival:rollback-20261104-unified-price-filters`。
