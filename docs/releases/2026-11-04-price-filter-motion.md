# 价格分析筛选切换动画

继统一筛选面板后，按用户最新要求，将当前 tab 不适用的控件由固定置灰改为滑出淡去；适用时重新滑入，值仍保存在父组件。品牌与系列保持显示，未选品牌时系列仍禁用。批次行整体使用高度过渡，其他控件通过稳定 key 和布局弹簧衔接位置及宽度变化。

实现使用项目现有 motion/react：退场透明度 180ms、位移 280ms、批次行高度过渡 320ms；布局弹簧 stiffness=360、damping=36、mass=1。退出控件设置 inert 和 aria-hidden，退出后移除；按系统 prefers-reduced-motion 关闭位移与布局动画。首次打开不播放进场。

类型检查、PriceAnalysis 现有回归测试、构建与 diff 检查通过。ego-browser 独立预览确认各 tab 最终控件集合、快速连续切换后无残留、搜索值保留，以及 1366px 下无筛选区溢出。验收浏览器的空闲 requestAnimationFrame 也仅约 2fps，不能据此宣称实际用户浏览器达到特定帧率。

云端仅更新 PriceAnalysis.tsx，运行镜像 `sha256:6b1ecf41e4b6f7ad4f2efc7fd3b8a952eb302e1cfe2f5af766b144058d0044fa`。本地构建资源 `/assets/index-DtI5TnUl.js` 的 SHA-256 为 `7e9f905e4e6a8d2191ff022b804946a9d46b467ce6c56240b7c8f86c8867fb7f`。发布核验记录、源码及数据库备份位于云端 `/home/ubuntu/price_rival/deploy-backups/20261104-price-filter-motion`。回滚镜像为 `price-rival:rollback-20261104-price-filter-motion`。

云端资源摘要与本地验证构建一致；认证正常、开发免登录关闭、未登录首页返回 401。两个数据库 quick_check 均为 ok；业务表内容一致，主库唯一变化为一条 auth_sessions 记录的 last_seen_at，风险库内容完全一致。

云端浏览器仍停在飞书登录页，登录后的生产视觉验收待完成。
