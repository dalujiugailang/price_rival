# 品牌字段与品牌竞争力趋势 Implementation Plan

**Goal:** 从 daily price API 获取并回填品牌名称，在工作台增加 BK 品牌列，并按品牌展示四项竞争力历史趋势。

**Architecture:** 服务端代理统一补齐品牌字段并提供审计化历史回填；前端把品牌作为产品固定字段使用。品牌趋势通过独立纯函数按品牌过滤每期产品后复用现有竞争力公式，UI 只负责筛选和渲染。

**Tech Stack:** React 19、TypeScript、Recharts、Express、Node SQLite、XLSX、Node assert/tsx

---

### Task 1: 品牌字段解析

- 新建 `server/brand.mjs` 与测试，先验证 API 品牌字段优先、核验品牌推断和未知留空。
- 修改 daily price 代理，在保持原响应结构的前提下为每行补充【品牌名称】。
- 修改 `DailyPriceRow` 和上传适配，保留品牌行，即使该 PPV 没有价格匹配。

### Task 2: 共享历史品牌回填

- 先写数据库回填失败测试，验证只修改 `products[].brand` 且幂等。
- 在 `server/database.mjs` 增加事务化回填方法与审计日志。
- 新增 `/api/tracking-batches/brand-backfill` 与前端 API 客户端。
- daily price 同步查询当前与历史 PPV 并集，更新当前产品品牌、调用历史回填、刷新共享历史并返回未匹配清单。

### Task 3: BK 品牌名称列

- 为工作台固定列数组追加宽度、代码 BK、标签品牌名称、导出值和单元格。
- 更新工作簿/固定列测试，确认 BJ 后是 BK 品牌名称。
- 历史快照导出增加品牌名称。

### Task 4: 品牌竞争力趋势

- 先写 `brandCompetitiveness.test.ts`，覆盖品牌列表、历史排序、品牌过滤、今日草稿和空样本。
- 实现纯函数并在 `CompetitivenessSummary` 中新增品牌选择与第二张四折线图。
- 品牌图跟随上方时间范围，不改变总趋势、顶部 KPI 或详细审计。

### Task 5: 数据回填和联网补齐

- 对共享历史与当前工作台 PPV 并集调用 daily price API。
- 对未匹配 PPV 使用品牌官网核验后补齐；不能可靠确认的保持空值并报告。
- 执行品牌回填，核对更新批次/明细数量与审计记录。

### Task 6: 完整验证

- 运行品牌解析、数据库回填、品牌趋势、定价、工作簿、小差额、TM 价差测试。
- 运行 `npm run lint` 与 `npm run build`。
- 在 5001 验收 daily price 状态、BK 列、品牌下拉、四条品牌趋势和空明细提示。
