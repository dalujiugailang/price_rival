# TM Price Gap Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four sign-colored TM price-gap columns beside the pre/post margin columns and export them as dynamic Excel formulas.

**Architecture:** A pure `tmPriceGaps` utility owns validity and subtraction rules. `MainTable` inserts the four derived display columns and keeps all fixed-column indexes aligned; `pricingWorkbook` locates the same columns by Chinese label and replaces cached values with dynamic formulas.

**Tech Stack:** React 19, TypeScript 5.8, SheetJS `xlsx`, Node assertions executed with `tsx`, Vite.

---

### Task 1: Lock the four price-gap calculations

**Files:**
- Create: `src/utils/tmPriceGaps.ts`
- Create: `src/utils/tmPriceGaps.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the failing pure-function test**

Add `"test:tm-price-gaps": "tsx src/utils/tmPriceGaps.test.ts"` and test the intended API:

```ts
const positive = getTmPriceGaps({
  jdPrice: 1100,
  jdHandPrice: 1200,
  recommendJdPrice: 1150,
  postJdHandPrice: 1250,
  tmPrice: 1000,
  tmHandPrice: 1180
});
assert.deepEqual(positive, {
  preItemGap: 100,
  preHandGap: 20,
  postItemGap: 150,
  postHandGap: 70
});

assert.deepEqual(getTmPriceGaps({
  jdPrice: 900,
  jdHandPrice: 1000,
  recommendJdPrice: 950,
  postJdHandPrice: 1050,
  tmPrice: 1000,
  tmHandPrice: 1100
}), {
  preItemGap: -100,
  preHandGap: -100,
  postItemGap: -50,
  postHandGap: -50
});

assert.deepEqual(getTmPriceGaps({
  jdPrice: 1000,
  jdHandPrice: 1000,
  recommendJdPrice: 1000,
  postJdHandPrice: 1000,
  tmPrice: 0,
  tmHandPrice: 1000
}), {
  preItemGap: null,
  preHandGap: 0,
  postItemGap: null,
  postHandGap: 0
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run test:tm-price-gaps`

Expected: FAIL because `tmPriceGaps.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure function**

Create this input/result contract and independently validate the two TM comparison fields:

```ts
interface TmPriceGapInput {
  jdPrice: number;
  jdHandPrice: number;
  recommendJdPrice: number;
  postJdHandPrice: number;
  tmPrice: number;
  tmHandPrice: number;
}

export interface TmPriceGaps {
  preItemGap: number | null;
  preHandGap: number | null;
  postItemGap: number | null;
  postHandGap: number | null;
}

export const getTmPriceGaps = (input: TmPriceGapInput): TmPriceGaps => ({
  preItemGap: input.tmPrice > 0 ? input.jdPrice - input.tmPrice : null,
  preHandGap: input.tmHandPrice > 0 ? input.jdHandPrice - input.tmHandPrice : null,
  postItemGap: input.tmPrice > 0 ? input.recommendJdPrice - input.tmPrice : null,
  postHandGap: input.tmHandPrice > 0 ? input.postJdHandPrice - input.tmHandPrice : null
});
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm run test:tm-price-gaps`

Expected: exit 0 and print `tm price gap checks passed`.

- [ ] **Step 5: Commit the calculation unit**

```bash
git add package.json src/utils/tmPriceGaps.ts src/utils/tmPriceGaps.test.ts
git commit -m "feat: calculate tm price gaps"
```

### Task 2: Insert and color the four page columns

**Files:**
- Modify: `src/components/MainTable.tsx`

- [ ] **Step 1: Insert fixed-column definitions**

Insert widths `120, 120`, codes `AW物差, AW到手差`, and labels `追前tm物品价差, 追前tm到手价差` after fixed index 18. Insert widths `120, 120`, codes `BE物差, BE到手差`, and labels `追后tm物品价差, 追后tm到手价差` after the shifted post-margin index 32.

- [ ] **Step 2: Keep channel visibility and export indexes aligned**

After both insertions, use:

```ts
const selfHiddenExportColumnIndexes = new Set([
  0, 10, 11, 12, 13, 14,
  19, 20, 21, 22,
  28, 31, 33, 34, 36, 37
]);
const noteDisplayHiddenColumnIndexes = new Set([26, 35]);
const isFixedColumnExported = (index: number) => (
  !isSelfOperated || !selfHiddenExportColumnIndexes.has(index) || index === 31
);
```

Update export special cases to shifted indexes: trial price `25`, reason `26`, small-gap note `28`, post AHS `29`, post AHS quote `30`, post JD hand price `31`.

- [ ] **Step 3: Add derived export values**

Call `getTmPriceGaps(p)` once in `getFixedExportValues` and insert:

```ts
gaps.preItemGap ?? '',
gaps.preHandGap ?? '',
// existing pre competitiveness through post margin
gaps.postItemGap ?? '',
gaps.postHandGap ?? '',
```

The array order must exactly match all 40 fixed labels.

- [ ] **Step 4: Render the four cells with sign colors**

Add a local renderer:

```tsx
const renderGapCell = (index: number, value: number | null) => (
  <td
    key={index}
    style={fixedColumnStyle(index)}
    className={`px-2 py-1 text-right border-r border-[#141414]/20 font-mono font-bold ${
      value === null ? 'text-[#141414]/30' : value > 0 ? 'text-green-700' : value < 0 ? 'text-red-700' : 'text-[#141414]'
    }`}
  >
    {value === null ? '-' : formatRMB(value)}
  </td>
);
```

Use it for indexes `19`, `20`, `33`, and `34`. Shift every existing switch case after index 18 by two, and every case after shifted post margin index 32 by another two.

- [ ] **Step 5: Realign header interactions**

Move the manual-price/reason/small-gap highlighted header indexes to `25`, `26`, and `28`. Put the reason filter on `26`, the tolerance button on `28`, and the regular highlighted trial-price header on `25`.

- [ ] **Step 6: Run type checking and build**

Run:

```bash
npm run lint
npm run build
```

Expected: both exit 0; the existing bundle-size warning may remain.

- [ ] **Step 7: Commit the page columns**

```bash
git add src/components/MainTable.tsx
git commit -m "feat: show tm price gap columns"
```

### Task 3: Add dynamic Excel formulas

**Files:**
- Modify: `src/utils/pricingWorkbook.test.ts`
- Modify: `src/utils/pricingWorkbook.ts`

- [ ] **Step 1: Add failing formula assertions**

Extend the test labels and row values with `jd总到手价` plus all four gap columns. After `addDynamicPricingWorkbookSheets`, assert:

```ts
assert.match(cellFor(pricingSheet, '追前tm物品价差').f || '', /^IF\(.+>0,.+-.+,""\)$/);
assert.match(cellFor(pricingSheet, '追前tm到手价差').f || '', /^IF\(.+>0,.+-.+,""\)$/);
assert.match(cellFor(pricingSheet, '追后tm物品价差').f || '', /^IF\(.+>0,.+-.+,""\)$/);
assert.match(cellFor(pricingSheet, '追后tm到手价差').f || '', /^IF\(.+>0,.+-.+,""\)$/);
assert.equal(cellFor(pricingSheet, '追前tm物品价差').v, product.jdPrice - product.tmPrice);
assert.equal(cellFor(pricingSheet, '追后tm到手价差').v, product.postJdHandPrice - product.tmHandPrice);
```

- [ ] **Step 2: Run the export test and verify RED**

Run: `npm run test:pricing-export`

Expected: FAIL because the four cells still contain static cached values without formulas.

- [ ] **Step 3: Write the four workbook formulas**

For trade-in only, locate `jd总到手价`, both TM columns, and the four gap result columns by label. For every exported product row, call `writeFormulaCell` with:

```ts
`IF(${tmPriceCell}>0,${currentJdCell}-${tmPriceCell},"")`
`IF(${tmHandPriceCell}>0,${currentJdHandPriceCell}-${tmHandPriceCell},"")`
`IF(${tmPriceCell}>0,${trialPriceCell}-${tmPriceCell},"")`
`IF(${tmHandPriceCell}>0,${postJdHandPriceCell}-${tmHandPriceCell},"")`
```

Use cached values from `getTmPriceGaps(product)`, falling back to `0` only for the numeric cache when TM is invalid. Apply `PRICE_FORMAT` and add the four labels to the numeric formatting list.

- [ ] **Step 4: Run export and regression tests**

Run:

```bash
npm run test:pricing-export
npm run test:tm-price-gaps
npm run test:pricing-logic
npm run test:small-gap
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the dynamic formulas**

```bash
git add src/utils/pricingWorkbook.ts src/utils/pricingWorkbook.test.ts
git commit -m "feat: export dynamic tm price gaps"
```

### Task 4: Document and verify the complete workflow

**Files:**
- Modify: `README.md`
- Modify outside repository: `../AGENTS.md`

- [ ] **Step 1: Document the four formulas and validity rule**

Add a short section stating the four subtraction formulas, TM comparison values must be greater than 0, page sign colors, self-operated hiding, and dynamic Excel formulas.

- [ ] **Step 2: Run fresh full verification**

Run:

```bash
npm run test:tm-price-gaps
npm run test:pricing-logic
npm run test:small-gap
npm run test:pricing-export
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Verify the live page on port 5001**

Reload `http://localhost:5001/` and verify the two pre-gap labels immediately follow `追前边际利润率`, the two post-gap labels immediately follow `追后边际利润率`, negative cells are red, positive cells are green, and the reason filter plus `容忍（N）` control remain in their intended columns. Switch to self-operated and verify all four TM gap columns are hidden.

- [ ] **Step 4: Review scope and repository state**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors or generated workbook files. Commit repository documentation:

```bash
git add README.md
git commit -m "docs: document tm price gap columns"
```
