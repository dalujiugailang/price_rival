# Codex 实施记录与本次 PR 更新索引

整理日期：2026-10-23（Asia/Shanghai）。本文由 Codex 对实施会话、仓库差异、既有 PR 与本次回归结果整理，供代码评审追溯。它是脱敏摘要，不包含原始对话导出、成员账号、业务明细、凭据或本机配置。

## 基线与集成方法

- 目标仓库 `dalujiugailang/price_rival`，基线 `main@958a323`。
- 截图中的 [PR #5：改价后保留筛选范围并实时更新竞争力](https://github.com/dalujiugailang/price_rival/pull/5) 已合并，不重复提交。
- 本地工作分支起点为 `2fc7442`，落后于主分支；本次在独立临时分支对本地新增差异做三方合并，而非用旧工作区覆盖主分支。
- 冲突处理：竞争力页面同时保留报告深链/导出模式与主分支的实时草稿；前后端共享竞争力计算时保留主分支的停用指标 `null` 口径。
- 本地运行目录和正式数据库不被本 PR 更改。PR 只提交源码、依赖清单、测试、功能文档与本记录；不自动合并，不表示完成新的生产发布。

## 一、独立价格分析模块

**原因**：旧比较粒度和展示不足以判断同 PPV 的双平台价格波动，也不易拆解物品价与补贴变化。

| 更新 | 行为与边界 | 主要位置 |
| --- | --- | --- |
| 两期对比 | 完整 PPV 匹配；对比期/基准期同排；差额＝对比期－基准期；新增、退出分列 | `src/components/PriceAnalysis.tsx`、`PriceComparisonPanels.tsx` |
| 七项保存指标 | 基准价、京东物品价/新品总投入/到手价、天猫裸机价/人工补贴/到手价 | `src/utils/priceAnalysis.ts` |
| 品牌指数 | 固定基准期报价量权重，显示样本与覆盖率；重复冲突排除，缺失不补零 | `aggregate`、`indexPpv` |
| 全量时序 | 全部已保存快照 PPV 并集，不要求首尾共同出现；批次筛选只限制 PPV 集合，保留其完整历史 | `src/components/PriceTimeline.tsx` |
| 联动与定位 | 品牌→新机系列联动；整行展开/收起；双击曲线定位批次；日期仅年月日；点击批次跳转历史并淡蓝高亮 | `TimelineHistoryDetails.tsx`、`HistoryPanel.tsx`、`MainTable.tsx` |
| 可视化 | 京东蓝、天猫橙、基准价紫；平滑连线；图例显隐；浮层避开悬停位置 | `PriceTimeline.tsx` |
| 性能 | 快照索引缓存、惰性计算、默认分批展示；选择批次后完整展示匹配 PPV | `priceAnalysis.ts`、`PriceAnalysis.test.tsx` |

价格分析和历史均保持只读。连线跨缺失期仅为视觉处理，不填充价格；同日多个批次不合并。

## 二、规则日报与利润评估

**原因**：把模糊的价格落后整理为可分类、可追溯、可分工处理的建议。

- 物品价落后且追平后边际＜0：**亏损风险 → 分货+销售**。
- 追平后边际非负、但低于快照利润底线：**利润底线限制 → 我方定价决策**，是否继续追平由业务判断。
- 仍有追价空间：不生成反馈；缺少规则/上限时标记**利润空间待核验**。
- 仅当**京东物品价＞天猫，且京东到手价≤天猫**时生成**补贴竞争力不足 → 京东换新渠道方**，推动其与采销争取补贴；持平也需争取超过。
- 分类卡片、品牌数量条、价格/缺口明细、依据展开、筛选导出和快照定位。缺口不是总投入/损失，也不代表销量影响。
- 利润评估接入用户提供的 TSX/CSS：四项指标、零利润线、底线、风险区间、差距摘要。底层统一使用项目已有 Recharts BarChart，支持 Tooltip、图例显隐、风险区间开关和计算详情。
- 源字段利润率为小数，UI 接口为百分数，仅在展示边界乘100；复用原追平测算结果。**未加入情景模拟、滑块、自动执行追价或修改历史价格**。
- 分类色与字段色集中维护：风险红、底线限制琥珀、补贴靛蓝、待核验灰；当前京东蓝、天猫橙、底线绿。

主要位置：`DailyAdvicePanel.tsx`、`ProfitComparison.tsx`、`ProfitRateComparison.tsx/.css`、`advicePalette.ts`、`src/utils/priceAnalysis.ts`。

## 三、价格分析独立权限

**原因**：历史查看权限不应隐式开放完整价格分析。

- 新增 `tradeIn.priceAnalysis`，权限管理单独勾选；普通成员默认不开通，管理员沿用现有全权限规则。
- 新增受保护的 `/api/price-analysis/batches`，前端 AuthorizedPriceAnalysis 从此接口读取分析数据。
- 仅有历史权限不能访问分析；仅有分析权限可以分析但不获得历史跳转、下载或编辑权限。
- 未登录401；缺少该权限403；不得将隐藏按钮视为完整隔离。

位置：`shared/accessPolicy.mjs`、`server/priceAnalysisAccess.mjs`、`server/index.mjs`、`AuthorizedPriceAnalysis.tsx`、`src/App.tsx`、`HistoryPanel.tsx`。

## 四、PPV 双源与等级成交量回退

**原因**：流量与质检成交来源覆盖不同，整体文件回退会遗漏部分 SKU+等级组合。

- 独立上传流量表、质检成交表；完整汇总取并集，Top2 仍只考虑流量表的组合，保留原有排名/并列规则。
- 等级推算按 SKU+LEVEL 查最新、第二、第三版本底表；缺失组合逐级回退，真实0保留，不累加多个版本，不读取第四版本。
- 回退来源随结果、投入及导出保留。

位置：`UploadSection.tsx`、`shared/gradeVolumeFallback.mjs`、`shared/gradeExpansion.mjs`、`server/gradeRoutes.mjs`。

## 五、飞书竞争力简报

**原因**：让已确认批次的竞争力结果能够按明确范围形成可核验简报，避免临时截图与重复发送。

- 从服务器历史选择已保存且已确认的明细批次，按品牌/新机系列生成追踪器截图与预览；未确认/仅汇总不自动回退为旧批次。
- 复用已有竞争力组件与共享计算口径，PNG 校验、批次摘要与权限验证均在服务端执行。
- 持久化预览、接收对象、发送状态和消息ID；防重复、并发发送；超时/未知状态不自动重发。
- 联系人核验、默认对象唯一匹配、已停用成员拒绝、报告深链及安全 OAuth 返回。
- 操作仍需用户确认；本 PR 的测试使用模拟接口，**不发送真实飞书消息**。

位置：`server/feishu*.mjs`、`FeishuPushDialog.tsx`、`FeishuReportPage.tsx`、`captureCompetitivenessTracker.tsx`、`shared/competitiveness*.mjs`；配置与权限说明见 [feishu-push.md](feishu-push.md)。

## Codex 记录来源与证据边界

- 价格分析实施会话：`01a1588a-f188-7903-81a2-7756fbcab681`。先确认只读、完整 PPV、报价量权重，再迭代时序、日报、利润组件和独立权限。后续用户确认覆盖了初版日报对象、到手价条件和时序范围，本记录以最终代码为准。
- PPV双源/等级回退会话：`01a15736-e3ab-7952-960f-71f97bfed74b`。历史记录包含最小云端补丁回读，但未完成登录后真实上传验收，不能写成整套新分支已发布。
- 飞书发送准备会话：`01a1630d-7e9e-7b51-a2b8-5e7b09f9dc31`。历史记录停在发送前核验，不能把准备、预览功能或模拟测试表述为真实发送成功。
- 本会话此前在本机4001完成了价格分析、利润图交互和权限管理界面验收；**本次整合分支重新执行了代码回归和构建，未宣称在生产完成端到端验收**。

## 本次整合分支验证

- `npm run lint`、`npm run build`。
- `node --test server/priceAnalysisAccess.test.mjs shared/gradeVolumeFallback.test.mjs server/feishuPush.test.mjs server/feishuRecipient.test.mjs`：9项通过；飞书HTTP测试仅使用本机模拟接口。
- `node --import tsx` 分别执行：`priceAnalysis.test.ts`、`PriceAnalysis.test.tsx`、`PriceTimeline.test.tsx`、`DailyAdvicePanel.test.tsx`、`ProfitComparison.test.tsx`、`ppvAggregation.test.ts`、`UploadSection.test.tsx`、`competitiveness.test.ts`、`competitivenessView.test.ts`、`tableColumnFilters.test.ts`、`retainedFilterScope.test.ts`、`snapshotHistory.test.tsx`、`brandCompetitiveness.test.ts`、`competitivenessTrendExport.test.ts`、`pricingLogic.test.ts`、`pricingWorkbook.test.ts`、`api.test.ts`（路径以对应src目录为准）。
- 保留PR #5的静态表格成员集、实时值与实时竞争力；数值筛选、天蓝高亮、停用指标空值继续回归。
- Recharts服务端静态渲染可能提示容器尺寸；生产构建仍有既有大包提示，均不等同于浏览器运行失败。

## 不包含的本地材料与上线注意

- 不提交数据库、`output/`业务明细与截图、`.env`、原始Codex会话、机器专用launchd配置/绝对路径。
- 新增 `sharp`、`html-to-image` 依赖，部署需安装匹配依赖并重新构建镜像/应用，不能只复制前端dist。
- 新价格分析权限需管理员按需授权；不批量改写既有成员。
- 飞书应用权限、生产可访问的APP_URL、真实发送及生产页面验收需要独立核验；本 PR 不自动触发这些操作。
