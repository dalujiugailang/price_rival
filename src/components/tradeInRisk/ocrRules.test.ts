import assert from 'node:assert/strict';
import {parseOcrStrategyText,parseCopiedStrategyText} from './parseStrategyText';
const text=`*策略分组：\t策略分组-爱回收默认分组爱回收-京东爱回收-自营分城定价-京东普通回收-1组\t爱回收-BD-普通回收\t爱回收-京东换新\t爱回收-BD-换新-荣耀\t爱回收-BD-换新-华为\t分城定价-自营-1组
爱回收-BD-换新-小米爱回收-BD-换新-vivo
*类别：\t手机
*策略范围：○全局非全局
*类型：\tGA:价格测试
策略标识:
请选择
价位段:
请选择
A级价位段:
请选择
适用范围:
品牌
型号
*适用型号：\t请选择品牌\t请选择型号\t十添加\t批量导入
批量删除
类别:
品牌
型号
操作
手机 (1)\t一加(357)\t一加16 (343105)\t删除
SKU属性:
添加一行
等级:
请选择
策略:
-2
%
*策略金额：\t0
备注:
新品防风险
有效时间:
2026-10-14 14:11:00
2026-10-3123:59:59`;
const result=parseOcrStrategyText(text);
assert.deepEqual(result.models,['一加16']);assert.equal(result.brand,'一加');assert.equal(result.ratio,-2);
assert.equal(result.fields['后台型号编号'],'一加16：343105');assert.equal(result.fields['类别'],'手机');assert.equal(result.fields['类型'],'GA:价格测试');assert.equal(result.fields['策略金额'],'0');assert.equal(result.note,'新品防风险');assert.equal(result.start,'2026-10-14 14:11:00');assert.equal(result.end,'2026-10-31 23:59:59');assert.equal(result.fields['策略分组'],undefined);assert.equal(result.fields['策略范围'],undefined);assert.equal(result.fields['适用范围'],undefined);
assert.equal(parseOcrStrategyText('策略:\n−2％').ratio,-2);assert.equal(parseCopiedStrategyText('策略:\n−2％').ratio,undefined);
console.log('Separate copy/OCR rules and exact OnePlus sample passed');
