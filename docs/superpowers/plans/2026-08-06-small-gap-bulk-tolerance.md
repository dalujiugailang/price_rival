# Small-Gap Bulk Tolerance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AZ-header bulk tolerance action that rounds each small-gap row up to the first legal price at or above TM, applies only rows meeting a configurable margin floor, and changes all new competitiveness comparisons to `>=`.

**Architecture:** Move small-gap detection and tolerance simulation from `App.tsx` into a pure utility that reuses the existing manual-price calculation path. Persist one tolerance-floor field in channel workspace state, pass evaluated row metadata into `MainTable`, and merge eligible prices into the existing `manualRecommendPrices` map after a native confirmation dialog.

**Tech Stack:** React 19, TypeScript 5.8, SheetJS `xlsx`, Node assertions executed with `tsx`, Vite.

---

### Task 1: Lock the rounding and competitiveness boundary contracts

**Files:**
- Create: `src/utils/pricingLogic.test.ts`
- Modify: `package.json`
- Modify: `src/utils/formulas.ts`
- Modify: `src/utils/pricingWorkbook.ts`
- Modify: `src/utils/pricingWorkbook.test.ts`

- [ ] **Step 1: Add failing pricing-logic tests**

Add `"test:pricing-logic": "tsx src/utils/pricingLogic.test.ts"` and create a Node-assertion test that verifies:

```ts
assert.equal(getRoundedCompetitivePrice(1060, 1060), 1060);
assert.equal(getRoundedCompetitivePrice(1068, 1068), 1100);

const equalProduct = calculateProductPrice(productWithEqualJdTmZzPrices, 0.03);
assert.equal(equalProduct.tmItemWin, true);
assert.equal(equalProduct.tmHandWin, true);
assert.equal(equalProduct.zzItemWin, true);
assert.equal(equalProduct.ahsZzHandWin, true);
assert.equal(equalProduct.postTmItemWin, true);
assert.equal(equalProduct.postTmHandWin, true);
assert.equal(equalProduct.postZzItemWin, true);
assert.equal(equalProduct.postAhsZzHandWin, true);
```

The fixture must use `jdPrice = tmPrice = zzPrice = 1000`, equal JD/TM subsidies, and a raw `zz券后价` equal to the AHS-subsidized JD quote.

- [ ] **Step 2: Run the logic test and verify RED**

Run: `npm run test:pricing-logic`

Expected: FAIL because an equal legal competitor price currently rounds upward and equality flags currently evaluate false.

- [ ] **Step 3: Implement the minimal `>=` changes**

In `getRoundedCompetitivePrice`, accept the first rounded price satisfying both conditions:

```ts
rounded >= competitorPrice && rounded >= start
```

Change the four pre-competition and four post-competition comparisons in `calculateProductPrice`, plus the four manual-price comparisons in `applyManualRecommendedPrice`, from `>` to `>=` while retaining the existing `competitorPrice > 0` guards.

- [ ] **Step 4: Make exported Excel formulas use `>=`**

Change the generated flag formula to:

```ts
`--AND(${competitorCell}>0,${comparedCell}>=${competitorCell})`
```

Update `pricingWorkbook.test.ts` to assert every generated competitiveness formula contains `>=` and preserves the competitor-validity guard.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm run test:pricing-logic
npm run test:pricing-export
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit the boundary changes**

```bash
git add package.json src/utils/pricingLogic.test.ts src/utils/formulas.ts src/utils/pricingWorkbook.ts src/utils/pricingWorkbook.test.ts
git commit -m "feat: treat equal competitor prices as competitive"
```

### Task 2: Extract and test small-gap tolerance evaluation

**Files:**
- Create: `src/utils/smallGapTolerance.ts`
- Create: `src/utils/smallGapTolerance.test.ts`
- Modify: `package.json`
- Modify: `src/types.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the failing small-gap evaluation test**

Add `"test:small-gap": "tsx src/utils/smallGapTolerance.test.ts"`. Define the desired API in the test:

```ts
const evaluated = evaluateSmallGapTolerance({
  products: [smallGapProduct],
  toleranceMargin: -0.02,
  subsidyRules,
  channel: CHANNELS.tradeIn
});

assert.equal(evaluated[0].smallGapTolerancePrice, 1100);
assert.equal(evaluated[0].smallGapToleranceEligible, true);
assert.ok(evaluated[0].smallGapOpportunityRemark?.includes('取整容忍价'));
```

Use `tmPrice = 1068`, a current recommendation below TM, and a subsidy rule beginning at 1100. Add separate cases for margin exactly equal to the tolerance floor, below the floor, missing TM, and already-equal recommendation.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run test:small-gap`

Expected: FAIL because `smallGapTolerance` does not exist.

- [ ] **Step 3: Add row metadata types**

Extend `CalculatedProduct` with:

```ts
smallGapTolerancePrice?: number;
smallGapToleranceMargin?: number;
smallGapToleranceEligible?: boolean;
```

- [ ] **Step 4: Implement the pure evaluator**

Move `SMALL_GAP_THRESHOLD`, Top-20 threshold calculation, and the current reminder logic from `App.tsx` into `smallGapTolerance.ts`. For eligible small-gap candidates:

```ts
const tolerancePrice = getRoundedCompetitivePrice(product.tmPrice, product.tmPrice);
const simulated = applyManualRecommendedPrice(
  product,
  tolerancePrice,
  toleranceMargin,
  subsidyRules,
  { channel, selfSubsidyRules }
);
const toleranceEligible = simulated.postMarginalProfit >= toleranceMargin;
```

Return the original calculated row plus reminder text and the three tolerance metadata fields. Use `>=` for already-competitive checks.

- [ ] **Step 5: Replace App-local reminder calculation**

Delete the moved constants/functions from `App.tsx` and call `evaluateSmallGapTolerance` after manual prices are applied, passing the active tolerance margin and subsidy inputs.

- [ ] **Step 6: Run logic tests and type checking**

Run:

```bash
npm run test:pricing-logic
npm run test:small-gap
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit the evaluator**

```bash
git add package.json src/types.ts src/App.tsx src/utils/smallGapTolerance.ts src/utils/smallGapTolerance.test.ts
git commit -m "feat: evaluate rounded small-gap tolerance"
```

### Task 3: Persist tolerance configuration and add the AZ bulk action

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/MainTable.tsx`

- [ ] **Step 1: Persist the tolerance margin**

Add `smallGapToleranceMargin: number` to `ChannelWorkspaceState`. In `normalizeState`, use the stored finite value or `-0.02`. Pass the active value to `evaluateSmallGapTolerance` and to `MainTable`.

Add an App handler that clamps percentage input to `-50%..50%` and stores its decimal form. Add a bulk handler that performs one state update:

```ts
manualRecommendPrices: {
  ...state.manualRecommendPrices,
  ...pricesByPpv
}
```

- [ ] **Step 2: Add MainTable props and local input text**

Add:

```ts
smallGapToleranceMargin: number;
onSmallGapToleranceMarginChange: (margin: number) => void;
onApplySmallGapTolerancePrices: (pricesByPpv: Record<string, number>) => void;
```

Mirror the existing margin input behavior so the displayed value uses percent units and resets to the persisted value on blur.

- [ ] **Step 3: Build the unfiltered eligible price map**

Derive the bulk map from `products`, not `filteredProducts`:

```ts
const tolerancePricesByPpv = Object.fromEntries(
  products
    .filter(product => product.smallGapToleranceEligible && Number.isFinite(product.smallGapTolerancePrice))
    .map(product => [product.ppv, product.smallGapTolerancePrice as number])
);
```

- [ ] **Step 4: Render the AZ header controls**

Keep the first header row code `AZ提醒`. For fixed column index 26 in the second header row, render the label, tolerance percentage input, and `一键容忍（N）` button. Widen only the AZ column enough to fit the controls and keep the existing hard-border industrial style. Continue hiding the column for self-operated.

- [ ] **Step 5: Add second confirmation and one-state application**

On button click, rebuild the current map, then call:

```ts
window.confirm(
  `确认一键容忍 ${count} 条 PPV 吗？\n` +
  `容忍边际底线：${formatPercent(smallGapToleranceMargin)}\n` +
  '目标价将按现有取整规则调整至不低于 tm裸机价的首个合法价格。'
)
```

Only call `onApplySmallGapTolerancePrices` when confirmed. Disable the button when the map is empty.

- [ ] **Step 6: Show row-level simulation details**

In AZ body cells, keep the current reminder and include the rounded tolerance price, simulated post-margin, and status text. The evaluator owns the text; `MainTable` only renders `smallGapOpportunityRemark`.

- [ ] **Step 7: Run tests, lint, and build**

Run:

```bash
npm run test:pricing-logic
npm run test:small-gap
npm run test:pricing-export
npm run lint
npm run build
```

Expected: all commands exit 0; the existing bundle-size warning may remain.

- [ ] **Step 8: Commit the state and UI integration**

```bash
git add src/App.tsx src/components/MainTable.tsx
git commit -m "feat: add AZ bulk tolerance control"
```

### Task 4: Update business documentation and verify the live workflow

**Files:**
- Modify: `README.md`
- Modify outside repository: `../AGENTS.md`
- Modify planned source files only if verification exposes a defect.

- [ ] **Step 1: Update the documented competitiveness rule**

Replace statements requiring strict `>` with: valid competitor prices use `>=`, new calculations and new official snapshots use the new rule, and historical saved snapshots are not recalculated. Add the AZ bulk-tolerance default, rounding, subsidy-rematch, and confirmation behavior to `README.md` and `../AGENTS.md`.

- [ ] **Step 2: Run fresh complete verification**

Run:

```bash
npm run test:pricing-logic
npm run test:small-gap
npm run test:pricing-export
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Verify the running site on port 5001**

Reload `http://localhost:5001/` in the existing in-app browser and verify:

- the AZ header shows `-2` and `一键容忍（N）`;
- changing the tolerance input changes `N`;
- clicking the button opens the exact second-confirmation dialog;
- dismissing the dialog leaves prices unchanged;
- self-operated still hides the AZ control.

- [ ] **Step 4: Review scope and repository state**

Run:

```bash
git diff --check
git status --short
```

Expected: no generated workbooks, no whitespace errors, and only the planned source/test/docs files changed. Commit the repository documentation:

```bash
git add README.md
git commit -m "docs: document bulk tolerance and equality rules"
```

### Task 5: Move the tolerance setting into a compact popover

**Files:**
- Modify: `src/utils/smallGapTolerance.ts`
- Test: `src/utils/smallGapTolerance.test.ts`
- Modify: `src/components/MainTable.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add a failing threshold-preview selector test**

Extend `smallGapTolerance.test.ts` so the eligible price selector can evaluate an uncommitted popup threshold from the already simulated row metadata:

```ts
assert.deepEqual(getSmallGapTolerancePrices([exactBoundary], exactFloor), {
  'small-gap-ppv': 1100
});
assert.deepEqual(getSmallGapTolerancePrices([exactBoundary], exactFloor + 0.0001), {});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:small-gap`

Expected: FAIL because `getSmallGapTolerancePrices` currently ignores a popup threshold argument.

- [ ] **Step 3: Support an optional preview threshold**

Change the selector to use row simulation metadata when a threshold is provided and preserve the existing persisted eligibility behavior when it is omitted:

```ts
export const getSmallGapTolerancePrices = (
  products: CalculatedProduct[],
  toleranceMargin?: number
) => Object.fromEntries(
  products
    .filter(product => (
      Number.isFinite(product.smallGapTolerancePrice)
      && (toleranceMargin === undefined
        ? product.smallGapToleranceEligible
        : product.smallGapOpportunity
          && Number.isFinite(product.smallGapToleranceMargin)
          && (product.smallGapToleranceMargin as number) >= toleranceMargin)
    ))
    .map(product => [product.ppv, product.smallGapTolerancePrice as number])
);
```

- [ ] **Step 4: Replace the inline header settings with popover state**

In `MainTable`, add `showSmallGapTolerancePopover`, a popover ref, and a local percentage input initialized from `smallGapToleranceMargin` each time the popover opens. Parse and clamp valid input to `-50..50`, derive the preview margin in decimal form, and call `getSmallGapTolerancePrices(products, previewMargin)` so the count updates without persisting anything.

Add a document `mousedown` and `Escape` effect while open. Outside click, Escape, and `取消` close the popover and restore the persisted input text.

- [ ] **Step 5: Render the compact anchored popover**

Keep only this compact trigger in the AZ header flow:

```tsx
<button type="button" onClick={() => setShowSmallGapTolerancePopover(prev => !prev)}>
  容忍({persistedCount})
</button>
```

Render an absolutely positioned white panel beneath it with a black border, `%` input, `可应用 N 条`, `取消`, and `一键应用`. The panel must use absolute positioning and a higher z-index so it does not participate in table-header height.

- [ ] **Step 6: Commit threshold and prices atomically after confirmation**

Replace the two callbacks with one prop:

```ts
onApplySmallGapTolerance: (
  margin: number,
  pricesByPpv: Record<string, number>
) => void;
```

After native second confirmation, call it with the preview margin and preview map. In `App`, update `smallGapToleranceMargin` and merge `manualRecommendPrices` in the same `updateActiveState` callback. Close the popover only after confirmation succeeds.

- [ ] **Step 7: Run focused and full verification**

Run:

```bash
npm run test:small-gap
npm run test:pricing-logic
npm run test:pricing-export
npm run lint
npm run build
```

Expected: all commands exit 0; the existing bundle-size warning may remain.

- [ ] **Step 8: Verify the live header and popover on port 5001**

Reload `http://localhost:5001/` and verify the AZ second header row remains its compact height, only the small `容忍（N）` trigger is visible when closed, the popup defaults to `-2`, changing it updates the displayed count, and cancel/closing does not modify prices. Do not accept the native confirmation during non-destructive verification.

- [ ] **Step 9: Commit the popover interaction**

```bash
git add src/utils/smallGapTolerance.ts src/utils/smallGapTolerance.test.ts src/components/MainTable.tsx src/App.tsx
git commit -m "feat: move tolerance settings into popover"
```
