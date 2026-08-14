# 竞争力走势 Excel 导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在历史竞争力趋势图中导出一个包含总盘和全部品牌的 Excel 工作簿，每张表都有可编辑的原生折线图和明细数据。

**Architecture:** 前端复用现有总盘/品牌时间线与“近15次追价/全部”筛选，生成轻量导出载荷；受登录保护的 Express 接口使用 `@office-kit/xlsx@0.9.0` 生成原生图表工作簿并返回文件流；前端下载 Blob。工作簿构建保持为独立纯模块，便于用解析回读方式验证单元格与图表结构。

**Tech Stack:** React 19、TypeScript、Express、`@office-kit/xlsx@0.9.0`、Node test/tsx、Vite。

---

## Task 1: 构建前端导出数据模型

**Files:**
- Create: `src/utils/competitivenessTrendExport.ts`
- Create: `src/utils/competitivenessTrendExport.test.ts`
- Modify: `package.json`

- [x] 先写失败测试，覆盖：总盘固定第一张表、全部有数据品牌均被导出、品牌下拉选择不影响导出、近15次只保留尾部15个节点、实时节点标记为“实时草稿”。
- [x] 运行 `npm run test:competitiveness-export-model`，确认测试因模块未实现而失败。
- [x] 实现以下稳定载荷类型与构建函数：

```ts
export interface CompetitivenessTrendExportPoint {
  date: string;
  batchName: string;
  nodeType: '历史正式' | '实时草稿';
  tmDirectScore: number;
  tmItemScore: number;
  ahsVsZzDirectScore: number;
  zzItemScore: number;
}

export interface CompetitivenessTrendExportSheet {
  sheetName: string;
  chartTitle: string;
  points: CompetitivenessTrendExportPoint[];
}

export interface CompetitivenessTrendExportPayload {
  rangeLabel: '近15次追价' | '全部';
  sheets: CompetitivenessTrendExportSheet[];
}
```

`buildCompetitivenessTrendExportPayload` 使用 `buildBrandCompetitivenessTimeline` 和 `getTrendRangeData`，总盘后依 `brandOptions` 顺序加入所有非空品牌；不接收当前 `selectedBrand`。
- [x] 运行模型测试并确认通过。

## Task 2: 生成含原生折线图的工作簿

**Files:**
- Create: `server/competitivenessWorkbook.mjs`
- Create: `server/competitivenessWorkbook.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] 先写失败测试：清理/去重非法 Sheet 名；首张表为“总盘走势”；每张表含一张图、四个系列和固定数据列；58.6% 回读为数值 `0.586` 而不是文本。
- [x] 运行 `npm run test:competitiveness-workbook`，确认测试因模块/依赖未实现而失败。
- [x] 精确安装 `@office-kit/xlsx@0.9.0`，避免预发布 API 漂移。
- [x] 实现 `createCompetitivenessTrendWorkbook(payload)`：
  - 校验至少一张非空数据表；
  - 清理 `[]:*?/\\`、截断31字符并追加序号解决重名；
  - 每张表顶部 A1 放 0%–100% 原生折线图，图例在底部；
  - 数据表从第23行开始，冻结表头，竞争力除以100写为数值并应用 `0.0%` 格式；
  - 四条线使用页面现有名称与颜色 `C2873E`、`B43E2B`、`1E824C`、`1B6D87`；
  - 图表公式引用同表数据区域，使 Excel 中修改数据后可刷新。
- [x] 回读生成文件并运行工作簿测试，确认全部通过。

## Task 3: 增加受保护的下载接口与客户端

**Files:**
- Modify: `server/index.mjs`
- Modify: `src/api.ts`
- Modify: `server/competitivenessWorkbook.test.mjs`

- [x] 在测试中补充文件名 `竞争力走势_总盘及品牌_YYYY-MM-DD.xlsx` 和空载荷拒绝用例，先确认失败。
- [x] 在 Express 中增加 `POST /api/exports/competitiveness-trends`，复用现有 `/api` 登录保护，设置标准 xlsx MIME、UTF-8 `Content-Disposition` 并发送 Buffer。
- [x] 在 `src/api.ts` 增加 Blob 下载方法，同时从响应头解析文件名；错误沿用现有 API 错误处理。
- [x] 运行工作簿测试，并用未登录请求确认接口返回 401/403 而非文件。

## Task 4: 在主趋势图接入导出按钮

**Files:**
- Modify: `src/components/CompetitivenessSummary.tsx`

- [x] 在品牌筛选框旁增加硬边框【导出Excel】按钮；导出中禁用并显示简短状态，失败信息显示在按钮附近。
- [x] 点击时用当前总盘时间线、历史批次、工作台明细、全部品牌、当前范围和渠道生成载荷，再调用下载接口。
- [x] 使用临时 Object URL 触发浏览器下载并及时释放；品牌筛选只影响页面 KPI/折线图，不影响工作簿包含的品牌。
- [x] 保持现有图表高度、图例和“近15次追价/全部”布局不变。

## Task 5: 全链路验证与文件验收

**Files:**
- Output: `outputs/competitiveness-trend-export-qa/竞争力走势_总盘及品牌_YYYY-MM-DD.xlsx`

- [x] 运行：

```bash
npm run test:competitiveness-export-model
npm run test:competitiveness-workbook
npm run test:trend-range
npm run test:brand-competitiveness
npm run lint
npm run build
```

- [x] 重启 3001 API 服务，保持 5001 Vite 页面可用。
- [x] 在 5001 页面分别验证“近15次追价”和“全部”，点击导出并确认文件成功下载。
- [x] 将完整范围下载文件保存到 `outputs/competitiveness-trend-export-qa/`，用 `@oai/artifact-tool` 导入并检查：首表、各品牌表、关键数据区域、公式/错误扫描，并渲染每个 Sheet 验证版式。
- [x] 最后回读 OOXML/工作簿对象，确认每张表恰有一张原生图、四个系列，且百分比数据为数值。
