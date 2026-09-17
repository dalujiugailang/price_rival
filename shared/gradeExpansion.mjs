import { roundUploadPrice } from './uploadPrice.mjs';

const text = v => String(v ?? '').trim();
const norm = v => text(v).replace(/\s+/g, '').toLowerCase();
const money = v => Math.round((v + Number.EPSILON) * 100) / 100;
export const gradePriceChoiceKey = (skuId, level) => `${skuId}:${norm(level)}`;

// Use the saved workspace adjustment, never a newly fetched Daily Price.
// Older inputs may reconstruct it from their own saved pre/post item prices.
export function gradePriceAdjustment(input) {
  const adjustment=input.display?.recommendAdjustment;
  if(typeof adjustment==='number'&&Number.isFinite(adjustment))return adjustment;
  const original=input.display?.jdPrice;
  return typeof original==='number'&&Number.isFinite(original)&&original>0&&Number.isFinite(input.price)
    ? money(input.price-original) : null;
}

export function resolveGradeInputLevel({ ppv, model, level }, rules = []) {
  if (text(level)) return text(level);
  if (!norm(model)) return '';
  // Historical snapshots may omit level. Match a known grade followed by the
  // model name so A, A1 and A+ (or 99-S and 99-S1) cannot be confused.
  const matches = [...new Set(rules.map(r => r.level))]
    .filter(candidate => norm(ppv).startsWith(norm(`${candidate}${model}`)));
  return matches.length === 1 ? matches[0] : '';
}

// No subsidy/competitor/margin input or output: expansion rows never become CalculatedProduct.
export function buildGradePlan({ volume, template, prices, skuIds, priceChoices = {} }) {
  const issues = [], rows = [], skippedSkus = [];
  const requested = new Set(skuIds.map(text));
  for (const skuId of requested) {
    const volumeRows = volume.rows.filter(r => r.skuId === skuId);
    const inputs = prices.filter(p => text(p.skuId) === skuId);
    const model = volumeRows[0]?.model || inputs[0]?.model || '';
    const fail = message => issues.push({ skuId, model, message });
    const adjustments=inputs.map(gradePriceAdjustment);
    if(inputs.length&&adjustments.every(a=>a!==null&&a<=0)){
      skippedSkus.push({skuId,model,reason:adjustments.every(a=>a===0)?'已定价记录调整额全部为0，不扩展追价':'已定价记录均未加价，不扩展追价'});
      continue;
    }
    if(adjustments.some(a=>a===null)){fail('缺少已定价记录调整额，无法判断是否追价');continue;}
    if (!volumeRows.length) { fail('完整底表未匹配 SKU，无法确定型号及规格'); continue; }
    const sku = volumeRows[0].sku;
    if (!inputs.length) { fail('没有已定价 PPV'); continue; }
    if (inputs.some(p => norm(p.model) !== norm(model))) { fail('已定价 SKU 的型号与底表不一致'); continue; }
    const templateName = Object.hasOwn(template.models, model) ? template.models[model] : '';
    const rules = template.rules.filter(r => r.template === templateName).sort((a, b) => a.rank - b.rank);
    if (!rules.length) { fail('型号未匹配等级模板'); continue; }
    const byLevel = new Map();
    let invalid = false;
    for (const input of inputs) {
      const rule = rules.find(r => norm(r.level) === norm(input.level));
      if (!rule || !(Number.isFinite(input.price) && input.price > 0)) { fail(`已定价等级 ${input.level} 未匹配模板或价格无效`); invalid = true; continue; }
      if (norm(input.ppv) !== norm(`${input.level}${sku}`)) { fail(`PPV ${input.ppv} 与 SKU/等级不一致`); invalid = true; continue; }
      const entries = byLevel.get(rule.level) || [];
      entries.push({ ...input, rank: rule.rank }); byLevel.set(rule.level, entries);
    }
    const fixed = new Map();
    for (const [level, entries] of byLevel) {
      const distinct = new Set(entries.map(p => p.price));
      const choice = priceChoices[gradePriceChoiceKey(skuId, level)];
      const selected = entries.find(p => p.id === choice);
      if (distinct.size > 1 && !selected) { fail(`${level} 在不同记录中有多个最终价格，请选择保留的价格`); invalid = true; }
      else fixed.set(level, selected || entries[0]);
    }
    if (invalid) continue;
    const ordered = [...fixed.values()].sort((a, b) => a.rank - b.rank);
    const coverageRank = ordered[0].rank;
    // Only actually raised records can anchor expansion; zero-adjustment grades
    // are preserved when their SKU has another raised grade.
    const eligible=ordered.filter(p=>gradePriceAdjustment(p)>0);
    if(!eligible.length){skippedSkus.push({skuId,model,reason:'所选已定价记录均未加价，不扩展追价'});continue;}
    const anchor = eligible.sort((a,b)=>a.price-b.price||a.rank-b.rank||text(a.id).localeCompare(text(b.id)))[0];
    const anchorRule = rules.find(r => r.rank === anchor.rank);
    const selectedRules = rules.filter(r => (r.rank >= coverageRank && r.rank < coverageRank + 6) || fixed.has(r.level));
    for (const rule of selectedRules) {
      const previous = fixed.get(rule.level);
      const ppv = `${rule.level}${sku}`;
      const volumeRow = volumeRows.find(r => norm(r.level) === norm(rule.level));
      const targetPrice = previous?.price ?? anchor.price * rule.ratio / anchorRule.ratio;
      const price = previous?.price ?? roundUploadPrice(targetPrice);
      const status = [];
      if (previous && Math.abs(previous.price - roundUploadPrice(anchor.price * rule.ratio / anchorRule.ratio)) > 0.01) status.push('保留已定价');
      if (rule.rank >= coverageRank + 6) status.push('六档外已定价');
      rows.push({ model, sku, skuId, ppv, level: rule.level, rank: rule.rank, template: templateName,
        newSeries: (previous || anchor).newSeries || '', sourcePriceId:(previous || anchor).id,
        ratio: rule.ratio, anchorPpv: anchor.ppv, anchorPrice: anchor.price, anchorRatio: anchorRule.ratio,
        origin: previous ? '重点追价' : '等级推算', targetPrice: money(targetPrice), price,
        quoteVolume: volumeRow?.quoteVolume ?? 0, soldVolume: volumeRow?.soldVolume ?? 0,
        strategyPrice: null, adjustment: null, investment: null, status });
    }
  }
  // PPV names must identify one SKU. Otherwise deduplicating would conceal bad input.
  const identities = new Map();
  for (const row of rows) {
    const key = norm(row.ppv), previous = identities.get(key);
    if (previous && previous !== row.skuId) throw new Error(`PPV ${row.ppv} 对应多个 SKU ID，请修正底表`);
    identities.set(key, row.skuId);
  }
  return { rows, issues, skippedSkus };
}

export function applyGradeStrategyPrices(plan, lookupRows) {
  const lookup = new Map();
  for (const item of lookupRows) {
    const ppv = norm(item.ppv);
    const raw = item['最终报价'] ?? item['最终报价（元）'] ?? item['最终报价(元)'] ?? item['finalQuote'];
    const price = raw === '' || raw === null || raw === undefined ? null : Number(raw);
    const valid = item.matched !== false && Number.isFinite(price) && price > 0 ? price : null;
    if (lookup.has(ppv) && lookup.get(ppv) !== valid) throw new Error(`Daily Price 返回同 PPV 多个价格：${item.ppv}`);
    lookup.set(ppv, valid);
  }
  const rows = plan.rows.map(row => {
    const quoteVolume = row.quoteVolume ?? 0, soldVolume = row.soldVolume ?? 0;
    const strategyPrice = lookup.get(norm(row.ppv)) ?? null;
    const adjustment = strategyPrice === null || row.price === null ? null : money(row.price - strategyPrice);
    // Missing activity counts mean no activity. Zero sales incur no spend,
    // including when the price itself still needs data to be calculated.
    const investment = soldVolume === 0 ? 0 : adjustment === null ? null : money(Math.max(adjustment, 0) * soldVolume);
    return { ...row, quoteVolume, soldVolume, strategyPrice, adjustment, investment,
      status: [...row.status.filter(s => !['未匹配成交量', '缺成交量'].includes(s)), ...(strategyPrice === null ? ['待补原价'] : adjustment < 0 ? ['低于策略价'] : [])] };
  });
  return { ...plan, rows, summary: summarizeGradeRows(rows) };
}

export function summarizeGradeRows(rows) {
  const sum = origin => money(rows.filter(r => r.origin === origin).reduce((s, r) => s + (r.investment ?? 0), 0));
  return { coreInvestment: sum('重点追价'), expansionInvestment: sum('等级推算'),
    totalInvestment: money(sum('重点追价') + sum('等级推算')),
    pendingRows: rows.filter(r => r.investment === null).length,
    adjustedRows: rows.filter(r => r.adjustment > 0).length,
    soldVolume: rows.reduce((s, r) => s + (r.soldVolume ?? 0), 0) };
}

// Apply the activity default to archived results without recalculating prices.
export function normalizeGradeActivity(run) {
  const rows = run.rows.map(row => {
    const quoteVolume = row.quoteVolume ?? 0, soldVolume = row.soldVolume ?? 0;
    return { ...row, quoteVolume, soldVolume,
      investment: soldVolume === 0 ? 0 : row.investment,
      status: (row.status || []).filter(s => !['未匹配成交量', '缺成交量'].includes(s)),
      ...(row.display ? { display: { ...row.display, quoteVolume, soldVolume } } : {}) };
  });
  return { ...run, rows, summary: summarizeGradeRows(rows) };
}
