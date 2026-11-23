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

## 2026-11-20 云端发布与回填

用户明确授权后已部署至 `/home/ubuntu/price_rival`。以云端现有源码为基线增量发布15个商品库相关文件，未带入本地效率仓库或其他未发布的界面改动；补齐现有TrackingBatch.competitionCoveragePpvs可选类型声明，使合并后的源码类型检查通过。商品库入口最终为数据源标题栏右侧带Layers图标的小按钮，点击直接弹窗编辑；本次竞争表存在未匹配组合时标题旁显示跳动橙色感叹号，点击自动带入待补组合，只需选择定位并保存。

- 运行镜像：`sha256:05ebb6e7a6bbfbc2daf0c04f84b75e9f49da0dfd11373347d26e14afb7d8eac1`。
- 云端备份：`deploy-backups/20261120-series-catalog`，包含源码、两个SQLite在线一致性副本、变更前摘要、目标ID、构建日志及verification.json。旧镜像标签：`price-rival:rollback-20261120-series-catalog`。回滚源码/镜像时勿用旧数据库覆盖后续业务数据。
- 云端运行容器回读：商品库33条，首次回填8次；目标日期2026-10-31、11-03、11-05、11-09、11-12、11-16、11-17、11-19。11-19快照269行全部匹配。
- 8次目标仅新增定位字段（包含恢复输入），价格、利润、竞争力和全部批次元数据不变；其他77次快照payload逐字节不变。其他业务表、风险库内容不变，quick_check=ok。
- 候选镜像中商品库/等级展示/认证/访问控制15项测试通过；合并源码类型检查通过；正式反向代理认证配置正常、devLoginEnabled=false，未登录商品库返回401。
- 静态资源：`/assets/index-BR8ejfE1.js`、`/assets/index-Dzea3gHt.css`。
- 浏览器访问配置域名dudusmoney.cloud遇到NET::ERR_CERT_COMMON_NAME_INVALID，未绕过证书告警，因此未完成登录后的线上视觉验收；生产容器、数据库和反向代理内部HTTP检查已完成。未更改域名、证书或认证配置。
- 本地核验副本：`outputs/series-catalog-20261120/cloud-verification.json`。

## 2026-11-20 保存性能优化（已发布）

卡点：前端商品库保存回调会await refreshServerBatches(true)，因此保存按钮等待全量68期有效历史下载和处理。生产数据副本测得全历史JSON约41,445,268字节，gzip约4,417,162字节，读取/序列化约898ms、gzip约607ms（不是网络端到端计时）。原后端即使无变更也重写8份目标快照。

优化：保存成功后不再请求全量历史；只按服务端冻结的8个目标ID在已加载历史中同步定位字段，并失效旧的在途历史响应，后续正常导航刷新仍读取正式数据。未变化版本不重复更新客户端。后端无改动直接返回、不新增版本归档、不写快照；实际修改只写定位发生变化的目标快照。并发revision校验保留。响应新增Server-Timing中的catalog耗时，便于后续定位。

同一生产副本对照：无改动保存279.7ms→0.7ms；单系列修改378.3ms→388.4ms，后端有改动耗时没有明显改善，主要收益是去除全量历史传输与页面处理。未声称浏览器端保存完成只需0.7ms。

云端仅更新App、shared/seriesCatalog、server/seriesCatalog及其测试4个文件；候选容器12项迁移/并发/局部历史同步/权限/认证测试通过，合并后类型检查通过。运行镜像sha256:2ea9860eba354b9a7885042ae3c3db58685b5608d0937130cf58020553dd091f。备份目录deploy-backups/20261120-series-catalog-speed，回滚镜像price-rival:rollback-20261120-series-catalog-speed。发布前后商品库revision=2、库内容、目标ID和全部快照payload均一致，quick_check=ok，开发免登录继续关闭。生产用户登录后的端到端点击耗时未实测。
