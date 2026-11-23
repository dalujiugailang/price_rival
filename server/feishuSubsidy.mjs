import {MATRIX_HEADERS,FULL_SUBSIDY_HEADERS,validateMatrixRows} from '../shared/subsidyMatrix.mjs';
export const SUBSIDY_SOURCE='https://atrenew.feishu.cn/sheets/R3AhsUUKQhGm6YtFWO4c8PX0nVb?sheet=aL9xy9';
export async function pullFeishuSubsidy({env=process.env,fetchImpl=fetch}={}) {
  const call=async(path,options={})=>{
    const response=await fetchImpl(`https://open.feishu.cn/open-apis${path}`,{...options,signal:AbortSignal.timeout(20000)});
    const payload=await response.json();
    if(!response.ok||payload.code!==0)throw new Error(`飞书读取失败（${payload.code||response.status}）：${String(payload.msg||'未知错误').slice(0,200)}`);
    return payload;
  };
  if(!env.FEISHU_APP_ID||!env.FEISHU_APP_SECRET)throw new Error('飞书应用尚未配置');
  const auth=await call('/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app_id:env.FEISHU_APP_ID,app_secret:env.FEISHU_APP_SECRET})});
  const headers={authorization:`Bearer ${auth.tenant_access_token}`},doc='R3AhsUUKQhGm6YtFWO4c8PX0nVb',sheetId='aL9xy9';
  const metadata=await call(`/sheets/v3/spreadsheets/${doc}/sheets/query`,{headers});
  const sheet=metadata.data.sheets.find(s=>s.sheet_id===sheetId);
  if(!sheet||sheet.grid_properties.row_count>100000)throw new Error('工作表不存在或行数超过10万');
  const rows=[];
  for(let start=1;start<=sheet.grid_properties.row_count;start+=2000){
    const result=await call(`/sheets/v2/spreadsheets/${doc}/values/${sheetId}!A${start}:K${Math.min(start+1999,sheet.grid_properties.row_count)}?valueRenderOption=UnformattedValue`,{headers});
    rows.push(...result.data.valueRange.values);
  }
  const norm=v=>String(v??'').replace(/\s/g,'');
  const index=rows.findIndex(r=>MATRIX_HEADERS.every(h=>r.some(v=>norm(v)===norm(h))));
  if(index<0)throw new Error('补贴表缺少指定五列表头');
  const archiveHeaders=FULL_SUBSIDY_HEADERS.filter(h=>rows[index].some(v=>norm(v)===norm(h)));
  const columns=archiveHeaders.map(h=>rows[index].findIndex(v=>norm(v)===norm(h)));
  const records=rows.slice(index+1).map(r=>Object.fromEntries(archiveHeaders.map((h,i)=>[h,r[columns[i]]??''])));
  const checked=validateMatrixRows(records);
  if(checked.errors.length)throw new Error(checked.errors.slice(0,5).join('；'));
  const conflicts=new Map();
  for(const r of checked.rules){const key=r.series+'\0'+r.threshold,value=`${r.jd}/${r.ahs}/${r.inflationTotal??0}/${r.inflationAhs??0}`;if(conflicts.has(key)&&conflicts.get(key)!==value)throw new Error(`补贴规则冲突：${r.series}，门槛${r.threshold}`);conflicts.set(key,value);}
  // CSV cells are literal values; escape formula-like text for safe spreadsheet opening.
  const cell=v=>'"'+String(typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v).replaceAll('"','""')+'"';
  const buffer=Buffer.from('\uFEFF'+[archiveHeaders,...checked.rules.map(r=>archiveHeaders.map(h=>r.raw[h]))].map(r=>r.map(cell).join(',')).join('\r\n'),'utf8');
  return {buffer,rules:checked.rules.map(r=>({newSeries:r.series,threshold:r.threshold,ahsInput:r.ahs,jdSubsidy:r.jd,...(r.ruleVersion===2?{ruleVersion:2,inflationTotal:r.inflationTotal,inflationAhs:r.inflationAhs}:{}),rawFields:r.raw})),warnings:checked.warnings};
}
