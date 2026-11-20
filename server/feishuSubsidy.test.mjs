import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from './database.mjs';
import {pullFeishuSubsidy} from './feishuSubsidy.mjs';
const env={FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test'};
const mock=rows=>async url=>({ok:true,json:async()=>url.includes('tenant_access')?{code:0,tenant_access_token:'secret'}:url.includes('/sheets/query')?{code:0,data:{sheets:[{sheet_id:'aL9xy9',grid_properties:{row_count:10}}]}}:{code:0,data:{valueRange:{values:[['品牌','新机系列','门槛','京东总补贴（含京东券）','爱回收承担总补贴'],...rows]}}}});
test('read evaluated amounts and preserve zero in five-column archive',async()=>{
 const result=await pullFeishuSubsidy({env,fetchImpl:mock([['品牌','型号',199,50,0]])});
 assert.equal(result.rules[0].ahsInput,0);assert.match(result.buffer.toString(),/"199","50","0"/);
});
test('invalid amounts and conflicting pricing tiers reject import',async()=>{
 await assert.rejects(pullFeishuSubsidy({env,fetchImpl:mock([['品牌','型号',199,'F3+H3',0]])}),/金额/);
 await assert.rejects(pullFeishuSubsidy({env,fetchImpl:mock([['品牌','型号',199,50,0],['品牌','型号',199,60,0]])}),/冲突/);
});
test('identical contents always get independent sequential archives with retrievable originals',()=>{
 const db=createDatabase(':memory:');
 try {const input={fileName:'原表.xlsx',buffer:Buffer.from('same bytes')};const a=db.saveSubsidyArchive(input),b=db.saveSubsidyArchive(input);assert.notEqual(a.id,b.id);assert.equal(b.version,a.version+1);assert.match(a.fileName,/^\d{4}-\d{2}-\d{2}补贴v1\.xlsx$/);assert.equal(Buffer.from(db.getSourceFile(a.id).original).toString(),'same bytes');assert.equal(db.listSourceFiles('tradeIn').length,2);}finally{db.close();}
});
