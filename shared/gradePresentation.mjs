import { pricingColumnKeys, pricingBooleanKeys } from './pricingColumns.mjs';
import {gradeMarginalProfit as margin} from './gradeMargin.mjs';

const norm = value => String(value ?? '').replace(/\s+/g, '').toLowerCase();
const number = value => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const sum = (a,b) => a == null || b == null ? null : a+b;
const round = value => value == null ? null : Math.round(value*100)/100;
const read = (row, names) => Object.entries(row || {}).find(([key]) => names.some(name => norm(name)===norm(key)))?.[1];

// Keep calculation traces in snapshots; expose only a concise result status.
export function gradeResultStatus(row) {
  return [...new Set([...(row.status || []),...(row.displayStatus || [])])];
}

export function gradeResultValue(key, value) {
  if (!pricingBooleanKeys.has(key)) return value;
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  return null;
}

// Only known display fields are frozen. None are fed back into ratio pricing.
export function gradeSourceDisplay(product = {}) {
  return Object.fromEntries(pricingColumnKeys.map(key => {
    const value = product[key];
    return [key, ['string','boolean'].includes(typeof value) || typeof value==='number' && Number.isFinite(value) ? value : null];
  }));
}

export function addGradePresentation(result, { prices = [], subsidyRules = [] } = {}, dailyRows = []) {
  const inputs = new Map(prices.map(p => [p.id,p]));
  const daily = new Map(dailyRows.filter(d => d.matched !== false).map(d => [norm(d.ppv),d]));
  const rows = result.rows.map(row => {
    const input = inputs.get(row.sourcePriceId);
    const lookup = daily.get(norm(row.ppv)) || {};
    const display = Object.fromEntries(pricingColumnKeys.map(key => [key,null]));
    const newSeries = row.newSeries ?? input?.newSeries ?? '';
    const source = row.origin === '重点追价' ? input?.display : null;
    if (source) Object.assign(display, gradeSourceDisplay(source));
    const base = number(read(lookup,['BI基准价','biBasePrice']));
    const basePrice = base > 0 ? base : null;
    const rules = subsidyRules.filter(r => r.newSeries===newSeries).sort((a,b)=>a.threshold-b.threshold);
    const subsidy = (price,key) => {
      if (price == null || !rules.length) return null;
      const match = rules.filter(r => r.threshold<=price).at(-1);
      return match ? number(match[key]) : 0;
    };
    // Existing rows retain their saved fields; new grades use their own Daily Price
    // and the matching series rules. Never borrow another grade's subsidy or base.
    if (!source) {
      const ahsInput = subsidy(row.strategyPrice,'ahsInput');
      const jdSubsidy = subsidy(row.strategyPrice,'jdSubsidy');
      const ahsSubsidyAfter = subsidy(row.price,'ahsInput');
      Object.assign(display, {
        jdPrice:row.strategyPrice, basePrice, ahsInput, jdSubsidy,
        ahsQuotedPrice:round(sum(row.strategyPrice,ahsInput)),
        jdHandPrice:round(sum(row.strategyPrice,jdSubsidy)),
        preMarginalProfit:margin(row.strategyPrice,ahsInput,basePrice),
        ahsSubsidyAfter, postAhsPrice:round(sum(row.price,ahsSubsidyAfter)),
        postJdHandPrice:round(sum(row.price,subsidy(row.price,'jdSubsidy'))),
        postMarginalProfit:margin(row.price,ahsSubsidyAfter,basePrice),
        levelId:read(lookup,['等级id','levelid','level id']) ?? null,
        brand:read(lookup,['品牌名称','品牌','brandName','brand']) || null,
        pricingRemark: row.origin==='等级推算' ? `首次等级比推算：${row.anchorPrice} × ${row.ratio} ÷ ${row.anchorRatio}；${row.marginRemark||''}；${row.orderRemark||''}` : '保留已定价',
        recommendAdjustment:row.adjustment
      });
    }
    Object.assign(display, {newSeries, oldModel:row.model, ppv:row.ppv, skuId:row.skuId,
      quoteVolume:row.quoteVolume,soldVolume:row.soldVolume,recommendJdPrice:row.price});
    if(row.marginRemark)display.marginRemark=row.marginRemark;
    if (source) {
      const gap = (own, competitor) => number(display[competitor]) > 0 && number(display[own]) != null ? round(display[own]-display[competitor]) : null;
      display.preItemGap=gap('jdPrice','tmPrice'); display.preHandGap=gap('jdHandPrice','tmHandPrice');
      display.postItemGap=gap('recommendJdPrice','tmPrice'); display.postHandGap=gap('postJdHandPrice','tmHandPrice');
    }
    return {...row,newSeries,display,displayStatus: !source && !rules.length ? ['缺少本系列补贴规则，补贴及相关利润显示 -'] : []};
  });
  return {...result,rows,presentationVersion:1};
}

// Legacy saved runs keep their frozen prices; no current workspace values are mixed in.
export function gradeRowDisplay(row, request = {}) {
  if (row.display) return row.display;
  const anchor = (request.prices || []).find(p => p.ppv===row.anchorPpv && p.price===row.anchorPrice && String(p.skuId)===row.skuId);
  return {newSeries:row.newSeries || anchor?.newSeries || null,oldModel:row.model,ppv:row.ppv,skuId:row.skuId,
    quoteVolume:row.quoteVolume,soldVolume:row.soldVolume,jdPrice:row.strategyPrice,
    recommendJdPrice:row.price,recommendAdjustment:row.adjustment};
}

export function gradeAnchorReference(row, request = {}) {
  const anchor = (request.prices || []).find(p => String(p.skuId)===String(row.skuId)
    && norm(p.ppv)===norm(row.anchorPpv) && p.price===row.anchorPrice);
  const level = anchor?.level || (row.sku && row.anchorPpv?.endsWith(row.sku)
    ? row.anchorPpv.slice(0,-row.sku.length).trim() : null);
  return {anchorSkuId:row.skuId,anchorLevel:level,anchorPpv:row.anchorPpv,anchorPrice:row.anchorPrice};
}
