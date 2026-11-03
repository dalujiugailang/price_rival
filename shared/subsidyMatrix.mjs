export const MATRIX_HEADERS = ['品牌','新机系列','门槛','京东总补贴（含京东券）','爱回收承担总补贴'];

export function validateMatrixRows(rows) {
  const errors=[], warnings=[], rules=[], seen=new Map();
  if (!Array.isArray(rows) || rows.length>100000) throw new Error('补贴表须为有效行数组且不超过10万行');
  const number=v => typeof v==='number' ? v : typeof v==='string' && v.trim() ? Number(v.replace(/[,，¥￥\s]/g,'')) : NaN;
  rows.forEach((raw,i)=>{
    if (MATRIX_HEADERS.every(h=>raw[h]===undefined || raw[h]===null || raw[h]==='')) return;
    const brand=String(raw['品牌']??'').trim(), series=String(raw['新机系列']??'').trim();
    const [threshold,jd,ahs]=MATRIX_HEADERS.slice(2).map(h=>number(raw[h]));
    if (!brand || !series || ![threshold,jd,ahs].every(v=>Number.isFinite(v)&&v>=0)) {errors.push(`第${i+2}行：品牌/系列为空，或金额非数字、为空、为负数`);return;}
    const key=JSON.stringify([brand,series,threshold,jd,ahs]);
    if(seen.has(key)) warnings.push(`第${i+2}行与第${seen.get(key)}行完全重复，保留原始明细`);
    seen.set(key,i+2);
    if(ahs>jd || ahs>10000) warnings.push(`第${i+2}行承担额异常：${ahs}，请核验`);
    rules.push({id:`row-${i+2}`,sourceRow:i+2,brand,series,threshold,jd,ahs,raw});
  });
  if(!rules.length) errors.push('没有有效补贴规则');
  return {rules,errors,warnings};
}

export function groupThresholds(rules) {
  const values=[...new Set(rules.map(r=>r.threshold))].sort((a,b)=>a-b), groups=[];
  for(const value of values) {
    const last=groups.at(-1);
    if(last && value-last.min<=10) {last.max=value;last.values.push(value);}
    else groups.push({min:value,max:value,values:[value]});
  }
  return groups.map(g=>({...g,key:String(g.min),label:g.min===g.max?String(g.min):`${g.min}–${g.max}`,low:0,high:0,delta:0}));
}

export function buildMatrix(rules) {
  const groups=groupThresholds(rules), byThreshold=new Map(groups.flatMap(g=>g.values.map(v=>[v,g]))), rows=new Map();
  for(const rule of rules) {
    const key=rule.series;
    if(!rows.has(key)) rows.set(key,{key,brand:rule.brand,series:rule.series,cells:{}});
    const cells=rows.get(key).cells, group=byThreshold.get(rule.threshold);
    (cells[group.key] ||= []).push(rule);
  }
  for(const row of rows.values()) {
    row.brand=[...new Set(Object.values(row.cells).flat().map(rule=>rule.brand).filter(Boolean))].join(' / ')||'未提供品牌';
  }
  for(const group of groups) {
    const values=rules.filter(r=>byThreshold.get(r.threshold)===group).map(r=>r.ahs);
    group.low=Math.min(...values);group.high=Math.max(...values);group.delta=group.high-group.low;
  }
  return {groups,rows:[...rows.values()],stats:{series:rows.size,rules:rules.length,rawThresholds:byThreshold.size,mergedThresholds:groups.length,maxDelta:Math.max(0,...groups.map(g=>g.delta))}};
}

// Same highest reached raw threshold as pricing engine; ties remain traceable.
export function hitMatrixRules(rules,brand,series,price) {
  return hitAvailableRules(rules.filter(r=>r.brand===brand&&r.series===series),price);
}

// Production pricing matches newSeries only; a brand label must not change eligibility.
export function hitWorkspaceSeriesRules(rules,series,price) {
  return hitAvailableRules(rules.filter(r=>r.series===series),price);
}

function hitAvailableRules(available,price) {
  if(!available.length || !Number.isFinite(price) || price<0) return {status:'missing',rules:[],ahs:null};
  const reached=available.filter(r=>r.threshold<=price);
  if(!reached.length) return {status:'below',rules:[],ahs:0};
  const threshold=Math.max(...reached.map(r=>r.threshold)), hits=reached.filter(r=>r.threshold===threshold);
  const conflict=new Set(hits.map(r=>`${r.ahs}/${r.jd}`)).size>1;
  return {status:conflict?'conflict':'hit',rules:hits,ahs:conflict?null:hits[0].ahs};
}

export function compareSubsidyProfit({baseProfit,basePrice,baselineSubsidy,subsidy,floor,mode='fixed'}) {
  if(![baseProfit,basePrice,baselineSubsidy,subsidy,floor].every(Number.isFinite)||basePrice<=0) return null;
  const delta=subsidy-baselineSubsidy, rawProfit=baseProfit-delta*(mode==='system'?1.0466:1);
  const profit=Math.abs(rawProfit)<1e-9?0:rawProfit, rate=profit/basePrice;
  // Avoid marking an exactly-on-floor saved rate as below floor after amount/rate conversion.
  return {delta,profit,rate,risk:rate < -1e-12?'亏损风险':rate < floor-1e-12?'低利润风险':'正常'};
}
