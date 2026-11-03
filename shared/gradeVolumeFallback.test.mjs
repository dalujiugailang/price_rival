import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolveGradeVolume} from './gradeVolumeFallback.mjs';
const row=(level,soldVolume,extra={})=>({skuId:'1',model:'甲',sku:'甲256',level,soldVolume,quoteVolume:10,...extra});
const source=(id,rows)=>({id,fileName:`${id}.xlsx`,data:{rows}});
test('missing combinations use second then third, zero stays zero, no sum, no fourth',()=>{
 const result=resolveGradeVolume(source('latest',[row('A',0)]),[source('second',[row('A',99),row('B',2)]),source('third',[row('B',88),row('C',3)]),source('fourth',[row('D',4)])]);
 assert.deepEqual(result.data.rows.map(r=>[r.level,r.soldVolume,r.activitySourceId]),[['A',0,'latest'],['B',2,'second'],['C',3,'third']]);
 assert.deepEqual(result.used.map(r=>r.filled),[1,1]);
});
test('fallback handles absent SKU, skips conflicting identity and normalizes grade keys',()=>{
 const result=resolveGradeVolume(source('latest',[row(' a ',0)]),[source('second',[row('A',99),row('B',2,{sku:'错误规格'}),row('C',3,{skuId:'2'})]),source('third',[row('B',5)])]);
 assert.equal(result.data.rows.length,3);
 assert.equal(result.data.rows.find(r=>r.level==='B').soldVolume,5);
 assert.equal(result.conflicts.length,1);
});

test('resolved counts and provenance reach expansion investment and export', async()=>{
 const {buildGradePlan,applyGradeStrategyPrices}=await import('./gradeExpansion.mjs');
 const {createGradeWorkbook}=await import('../server/gradeRoutes.mjs');
 const XLSX=await import('xlsx');
 const primary=source('latest',[row('A',0)]);
 const resolved=resolveGradeVolume(primary,[source('second',[row('B',2)])]);
 const request={volumeId:'latest',templateId:'t',skuIds:['1'],prices:[{id:'p',skuId:'1',model:'甲',ppv:'A甲256',level:'A',price:1000,newSeries:'新',display:{recommendAdjustment:100}}]};
 const template={models:{甲:'t'},rules:[{template:'t',level:'A',rank:1,ratio:1},{template:'t',level:'B',rank:2,ratio:.8}]};
 const plan=buildGradePlan({volume:resolved.data,template,...request});
 const priced=applyGradeStrategyPrices(plan,[{ppv:'A甲256',最终报价:900},{ppv:'B甲256',最终报价:700}]);
 const b=priced.rows.find(r=>r.level==='B');
 assert.equal(b.soldVolume,2);assert.equal(b.investment,200);assert.match(b.status.join(' '),/second.xlsx/);
 const wb=XLSX.read(createGradeWorkbook({...priced,id:'run',request,sources:{volume:primary,volumeFallbacks:resolved.used,template:{fileName:'t.xlsx'}},createdAt:'now'}),{type:'buffer'});
 assert.ok(wb.SheetNames.includes('成交量匹配来源'));
 const records=XLSX.utils.sheet_to_json(wb.Sheets['成交量匹配来源']);
 assert.equal(records.find(r=>r['等级']==='B')['底表文件'],'second.xlsx');
});
