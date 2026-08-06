# Dynamic Excel Pricing Formulas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a workbook where users can edit the trial post-pricing value and have subsidy thresholds, post-pricing metrics, margins, and competitiveness flags recalculate through Excel `XLOOKUP` formulas.

**Architecture:** Keep the existing UI table unchanged and add a focused workbook helper under `src/utils`. `MainTable` will build the familiar export columns, add explicit system-versus-trial columns, then delegate formula injection, subsidy-rule sheet creation, formatting, and recalculation metadata to the helper.

**Tech Stack:** React 19, TypeScript 5.8, SheetJS `xlsx` 0.18.5, Node assertions executed with `tsx`.

---

### Task 1: Add executable workbook-formula checks

**Files:**
- Create: `src/utils/pricingWorkbook.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the failing formula contract check**

Create a `tsx`-executable test that builds a two-header-row worksheet, calls the not-yet-created helper, and asserts:

```ts
assert.match(postAhsCell.f || '', /_xlfn\.XLOOKUP/);
assert.match(postAhsCell.f || '', /,-1\)/);
assert.match(postMarginCell.f || '', /0\.0466/);
assert.ok((postTmWinCell.f || '').includes('>'));
assert.ok(!(postTmWinCell.f || '').includes('>='));
assert.equal(workbook.SheetNames[1], '补贴规则');
assert.equal(workbook.Workbook?.CalcPr?.fullCalcOnLoad, true);
```

Add the command:

```json
"test:pricing-export": "tsx src/utils/pricingWorkbook.test.ts"
```

- [ ] **Step 2: Run the check and verify it fails**

Run: `npm run test:pricing-export`

Expected: FAIL because `./pricingWorkbook` does not exist.

- [ ] **Step 3: Commit the failing contract check**

```bash
git add package.json src/utils/pricingWorkbook.test.ts
git commit -m "test: define dynamic pricing workbook contract"
```

### Task 2: Implement the workbook formula helper

**Files:**
- Create: `src/utils/pricingWorkbook.ts`
- Modify: `src/utils/pricingWorkbook.test.ts`

- [ ] **Step 1: Define the helper interface and column lookup**

Export a single orchestration function with this contract:

```ts
export interface DynamicPricingWorkbookOptions {
  workbook: XLSX.WorkBook;
  pricingSheet: XLSX.WorkSheet;
  pricingSheetName: string;
  products: CalculatedProduct[];
  channelId: ChannelId;
  subsidyRules: SubsidyRule[];
  selfSubsidyRules: SelfOperatedSubsidyRule[];
}

export const addDynamicPricingWorkbookSheets = (
  options: DynamicPricingWorkbookOptions
): void => { /* formula and rules-sheet work */ };
```

Read row 2 of the pricing worksheet to map labels to zero-based indexes and convert them with `XLSX.utils.encode_col`. Throw a descriptive error if a required trial formula column is missing.

- [ ] **Step 2: Create the visible subsidy-rule worksheet**

For JD trade-in, output standardized columns `新机系列`, `价格门槛`, `AHS投入`, and `京东补贴`, followed by the union of rule `rawFields`. Sort by series and threshold. For self-operated, output `价格门槛` and `AHS投入`, followed by raw fields, sorted by threshold.

- [ ] **Step 3: Inject cached formulas for each product row**

Use `_xlfn.XLOOKUP` because OOXML stores future Excel functions with the `_xlfn.` prefix. For JD trade-in, the AHS formula must have this shape, using absolute rule ranges and actual cell references:

```ts
const formula = seriesRuleCount === 0
  ? currentAhsCell
  : `IFERROR(_xlfn.XLOOKUP(1,('${rulesName}'!$A$2:$A$${lastRuleRow}=${seriesCell})*('${rulesName}'!$B$2:$B$${lastRuleRow}<=${trialCell}),'${rulesName}'!$C$2:$C$${lastRuleRow},0,0,-1),0)`;
```

Use the same lookup to return JD subsidy column D. For self-operated, omit the series predicate and return 0 when no rules exist. Write cached `v` values from each `CalculatedProduct` so non-recalculating previews still show the system result.

Inject formulas for adjustment amount, post-AHS quote, post-JD hand price, post-margin, and every post-competitiveness column present in the export. All competitiveness formulas must use strict `>`.

- [ ] **Step 4: Apply numeric formats and workbook recalculation metadata**

Use `#,##0.00` for prices, `0.00%` for margin, and `0` for binary flags. Configure:

```ts
workbook.Workbook = {
  ...(workbook.Workbook || {}),
  CalcPr: {
    ...(workbook.Workbook?.CalcPr || {}),
    calcMode: 'auto',
    fullCalcOnLoad: true,
    forceFullCalc: true
  }
};
```

- [ ] **Step 5: Run the formula checks**

Run: `npm run test:pricing-export`

Expected: PASS for trade-in lookup, self-operated lookup, no-rule fallback, formula formats, strict comparisons, and recalculation metadata.

- [ ] **Step 6: Commit the helper**

```bash
git add src/utils/pricingWorkbook.ts src/utils/pricingWorkbook.test.ts
git commit -m "feat: build dynamic pricing workbook formulas"
```

### Task 3: Wire dynamic formulas into the existing export button

**Files:**
- Modify: `src/components/MainTable.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Pass current subsidy rules into `MainTable`**

Extend props and the existing call site:

```tsx
subsidyRules={activeState.subsidyRules}
selfSubsidyRules={activeState.selfSubsidyRules}
```

Keep these inputs export-only; do not alter live calculation state.

- [ ] **Step 2: Build export-only system and trial columns**

Leave `fixedCodes`, `fixedLabels`, and visible table rendering unchanged. In the export column list:

- Insert `系统推荐追后价` before `试算追后价`.
- Rename the exported reason and reminder labels to `系统追价理由` and `系统小差额提醒`.
- Insert `追后京东总补贴` before `追后京东总到手价`.
- Preserve the current system recommendation as the initial numeric value of both system and trial price columns.
- Export formula inputs and calculated cached values as numbers instead of formatted currency/percent text.

- [ ] **Step 3: Add rules and formulas before writing the file**

After creating and appending the pricing sheet, call:

```ts
addDynamicPricingWorkbookSheets({
  workbook: wb,
  pricingSheet: ws,
  pricingSheetName,
  products: filteredProducts,
  channelId,
  subsidyRules,
  selfSubsidyRules
});
```

Append the existing `测算设置` sheet after `补贴规则` so the exported order is pricing sheet, subsidy rules, settings.

- [ ] **Step 4: Run focused checks and type checking**

Run: `npm run test:pricing-export`

Expected: PASS.

Run: `npm run lint`

Expected: TypeScript exits 0 with no diagnostics.

- [ ] **Step 5: Commit the UI wiring**

```bash
git add src/App.tsx src/components/MainTable.tsx
git commit -m "feat: export editable post-pricing workbook"
```

### Task 4: End-to-end workbook and production verification

**Files:**
- Modify only if verification reveals a defect in files already listed above.

- [ ] **Step 1: Run all available verification commands**

Run:

```bash
npm run test:pricing-export
npm run lint
npm run build
```

Expected: all three commands exit 0.

- [ ] **Step 2: Inspect the generated workbook structure programmatically**

Have the formula check serialize and read back the workbook. Confirm that the workbook contains the pricing sheet, visible `补贴规则`, and `测算设置`; formula cells retain `_xlfn.XLOOKUP`; system and trial columns retain numeric cached values; and source fields remain after fixed export columns.

- [ ] **Step 3: Review the final diff for scope and accidental formatting**

Run:

```bash
git diff HEAD~3 --check
git status --short
```

Expected: no whitespace errors, no generated `.xlsx` files, and only the planned source, test, package, and documentation changes.

- [ ] **Step 4: Commit any verification-only correction**

If verification required a code correction, commit only that correction:

```bash
git add src/utils/pricingWorkbook.ts src/utils/pricingWorkbook.test.ts src/components/MainTable.tsx src/App.tsx
git commit -m "fix: correct dynamic pricing workbook export"
```
