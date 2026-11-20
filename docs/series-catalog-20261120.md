# 新机系列定位商品库

数据源顶部提供默认折叠的紧凑商品库，初始33条完全采用用户确认的旗舰、次旗舰、中端分类。可搜索、修改、新增，维护时自动带入本次工作台未匹配的品牌/系列。保存前校验空值、重复键和定位枚举；版本冲突不覆盖其他人的保存。

字段为 `newSeriesPosition`，界面及Excel名称为「新机系列定位」。按品牌＋新机系列匹配，忽略空白与拉丁字母大小写，兼容现有系统将REDMI归为小米的品牌别名；不根据产品年代、旧机型号或其他新机系列推断定位。未命中留空，并在可编辑京东换新工作台提示用户去数据源补充。

商品库保存在业务SQLite的 `series_catalog_state`，每次维护将旧版本及操作者留在 `series_catalog_archive`。读取需要京东换新工作台或数据源权限，保存需要编辑身份及数据源权限。服务端保存新快照时重新匹配商品库，避免旧客户端传入错误标签。

首次初始化仅对京东换新按保存时间倒序的8次非汇总、有明细、未删除快照回填，包含products和restorePayload.productsMaster。目标ID写入状态表，重启不滚动扩大范围；后续商品库维护仍仅刷新这组历史目标。历史浏览不动态套用当前商品库，范围外快照维持原样。每个目标的原始payload在 `series_position_backups` 留存，不改变价格、补贴、利润、竞争力、确认状态和保存时间。新快照冻结保存时定位。

本地回填验证见 `outputs/series-catalog-20261120/local-backfill.json`：8次目标仅新增定位字段，其余74次payload逐字节不变。当前本地最新快照为2026-11-17，269行全部匹配；Reno17等未提供定位的历史系列留空。云端尚未部署，部署后会针对云端数据库首次启动时的最近8次快照独立迁移。

验证：
- `node --test server/seriesCatalog.test.mjs server/gradePresentation.test.mjs`，8项通过。
- `node --import tsx src/utils/pricingWorkbook.test.ts`、`src/utils/pricingLogic.test.ts`、`src/utils/competitiveness.test.ts`、`src/utils/snapshotPricingDraft.test.ts`通过。
- 历史快照SSR测试在提供location测试桩后通过（现有urlState依赖浏览器location）。
- `npm run lint`与构建通过；现有主包体积警告仍在。
- ego-browser验收实际商品库组件：默认折叠、展开后限高滚动、自动补入未匹配项、搜索、空定位校验、选择定位保存后缺失提示消失。仅在隔离测试夹具中给Reno17选择了次旗舰，未写入实际商品库。

旧机膨胀、追价公式、竞争力算法及分层汇总不在本次改动范围。
