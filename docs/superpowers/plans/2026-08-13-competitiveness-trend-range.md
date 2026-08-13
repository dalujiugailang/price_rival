# 竞争力趋势展示范围切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“历史追平周期竞争力波动走势”默认展示包含今日实时草稿在内的最近 15 个节点，并提供“近15次追价 / 全部”切换。

**Architecture:** 保留组件现有完整时间线，在独立纯函数中按展示范围截取数据；组件只维护临时展示状态，并把派生后的数据交给 Recharts。这样不会改变历史落数、顶部 KPI 或详细审计的数据源。

**Tech Stack:** React 19、TypeScript、Recharts、Tailwind CSS、Node `assert` + `tsx`

---

## 文件结构

- 新建 `src/utils/trendRange.ts`：定义展示范围类型和最近 15 条截取规则。
- 新建 `src/utils/trendRange.test.ts`：覆盖默认截取、不足 15 条和全部模式。
- 修改 `package.json`：增加独立的趋势范围测试命令。
- 修改 `src/components/CompetitivenessSummary.tsx`：接入展示状态、派生数据和左下角切换按钮。

### Task 1: 趋势范围纯函数

**Files:**
- Create: `src/utils/trendRange.test.ts`
- Create: `src/utils/trendRange.ts`
- Modify: `package.json`

- [ ] **Step 1: 写入失败测试**

创建 `src/utils/trendRange.test.ts`：

```ts
import assert from 'node:assert/strict';
import { getTrendRangeData } from './trendRange';

const twentyPoints = Array.from({ length: 20 }, (_, index) => index + 1);

assert.deepEqual(
  getTrendRangeData(twentyPoints),
  [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
);

assert.deepEqual(getTrendRangeData([1, 2, 3]), [1, 2, 3]);
assert.deepEqual(getTrendRangeData(twentyPoints, 'all'), twentyPoints);

console.log('trend range checks passed');
```

在 `package.json` 的 `scripts` 中加入：

```json
"test:trend-range": "tsx src/utils/trendRange.test.ts"
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `npm run test:trend-range`

Expected: FAIL，错误说明找不到 `./trendRange` 模块。

- [ ] **Step 3: 写入最小实现**

创建 `src/utils/trendRange.ts`：

```ts
export type TrendRange = 'recent15' | 'all';

const RECENT_TREND_COUNT = 15;

export const getTrendRangeData = <T>(
  data: T[],
  range: TrendRange = 'recent15'
): T[] => range === 'all' ? data : data.slice(-RECENT_TREND_COUNT);
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm run test:trend-range`

Expected: PASS，并输出 `trend range checks passed`。

- [ ] **Step 5: 提交纯函数与测试**

```bash
git add package.json src/utils/trendRange.ts src/utils/trendRange.test.ts
git commit -m "test: define competitiveness trend range behavior"
```

### Task 2: 折线图范围切换控件

**Files:**
- Modify: `src/components/CompetitivenessSummary.tsx:20-106`
- Modify: `src/components/CompetitivenessSummary.tsx:275-354`

- [ ] **Step 1: 接入范围状态和派生数据**

在工具函数 imports 中加入：

```ts
import { getTrendRangeData, TrendRange } from '../utils/trendRange';
```

在 `selectedBatchId` 状态后加入默认范围：

```ts
const [trendRange, setTrendRange] = useState<TrendRange>('recent15');
```

在 `timelineData` 的 `useMemo` 后加入：

```ts
const displayedTimelineData = useMemo(
  () => getTrendRangeData(timelineData, trendRange),
  [timelineData, trendRange]
);
```

并把折线图的 `data={timelineData}` 改为：

```tsx
data={displayedTimelineData}
```

- [ ] **Step 2: 添加左下角紧凑切换按钮**

保持现有 `h-80 min-h-[300px]` 图表高度不变，在图表容器结束后、主图面板结束前加入：

```tsx
<div
  className="inline-flex border border-[#141414] bg-white"
  role="group"
  aria-label="趋势展示范围"
>
  {([
    ['recent15', '近15次追价'],
    ['all', '全部']
  ] as const).map(([value, label]) => (
    <button
      key={value}
      type="button"
      aria-pressed={trendRange === value}
      onClick={() => setTrendRange(value)}
      className={`px-2.5 py-1 text-[10px] font-bold leading-none first:border-r first:border-[#141414] ${
        trendRange === value
          ? 'bg-[#141414] text-white'
          : 'bg-white text-[#141414] hover:bg-stone-100'
      }`}
    >
      {label}
    </button>
  ))}
</div>
```

- [ ] **Step 3: 运行趋势范围测试**

Run: `npm run test:trend-range`

Expected: PASS，并输出 `trend range checks passed`。

- [ ] **Step 4: 运行类型检查**

Run: `npm run lint`

Expected: PASS，TypeScript 无错误。

- [ ] **Step 5: 运行生产构建**

Run: `npm run build`

Expected: PASS，Vite 生成 `dist`，无构建错误。

- [ ] **Step 6: 页面验收**

在含超过 15 个时间线节点的数据下检查：

- 首次进入时“近15次追价”为黑底白字，横轴包含最后 14 次正式落数和“今日(工作台)”。
- 点击“全部”后显示完整时间线，按钮选中态同步变化。
- 点击“近15次追价”后恢复最后 15 个节点。
- 顶部 KPI、图例、Tooltip 和详细审计数据源不随切换改变。
- 刷新页面后恢复默认“近15次追价”。

- [ ] **Step 7: 提交组件改动**

```bash
git add src/components/CompetitivenessSummary.tsx
git commit -m "feat: toggle competitiveness trend history range"
```

### Task 3: 最终回归验证

**Files:**
- Verify only

- [ ] **Step 1: 运行本次功能测试**

Run: `npm run test:trend-range`

Expected: PASS，并输出 `trend range checks passed`。

- [ ] **Step 2: 运行全部既有专项测试**

Run: `npm run test:pricing-logic && npm run test:pricing-export && npm run test:small-gap && npm run test:tm-price-gaps`

Expected: 四个命令全部以退出码 0 完成。

- [ ] **Step 3: 重新运行类型检查和生产构建**

Run: `npm run lint && npm run build`

Expected: 两个命令都以退出码 0 完成。

- [ ] **Step 4: 检查最终改动范围**

Run: `git status --short && git diff --check HEAD~2..HEAD`

Expected: 只有用户原有未跟踪项可能留在工作区；本功能提交不存在空白错误，且不包含无关文件。
