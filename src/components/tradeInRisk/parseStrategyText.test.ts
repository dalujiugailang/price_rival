import assert from 'node:assert/strict';
import {parseStrategyText} from './parseStrategyText';
const result=parseStrategyText(`策略分组:
爱回收-京东
爱回收-京东换新
类别:
手机
策略范围:
全局
非全局
类型:
GA:价格测试
适用范围:
品牌
型号
适用型号:
请选择品牌
请选择型号
+添加
类别
品牌
型号
操作
手机(1)
华为(9)
华为MateXT2非凡大师(326618)
删除
手机(1)
华为(9)
人民出版社
华为PuraXView(326614)
删除
手机(1)
小米(184)
小米18 Fold (326636)
删除
SKU属性:
添加一行
等级:
请选择
策略:
-2.5
%
策略金额:
备注:
新品防风险`);
assert.deepEqual(result.models,['华为MateXT2非凡大师','华为PuraXView','小米18 Fold']);
assert.equal(result.ratio,-2.5);assert.equal(result.note,'新品防风险');
assert.equal(result.fields['类别'],'手机');assert.equal(result.fields['类型'],'GA:价格测试');
assert.equal(result.fields['策略范围'],undefined);assert.equal(result.fields['策略分组'],undefined);
assert.equal(result.fields['适用范围'],undefined);assert.equal(result.start,undefined);
assert.ok(result.fields['后台型号编号'].includes('326618'));
assert.equal(parseStrategyText('策略:\n请选择').ratio,undefined);
console.log('OCR文字解析测试通过：型号编号、比例、备注、选项歧义与杂字');

const table=parseStrategyText(`策略分组
类别
策略范围
全局
非全局
类型
策略标识
请选择
价位段
请选择
A级价位段
请选择
适用范围
品牌
型号
适用型号
请选择品牌
请选择型号
类别\t品牌\t型号\t操作
手机（1）\t华为（9）\t华为 Mate XT 2 非凡大师（326618）\t
手机（1）\t华为（9）\t华为 Pura X View（326614）\t
手机（1）\t小米（184）\t小米 18 Fold（326636）\t
SKU属性
等级
请选择
策略
-2.5
%
策略金额
0
备注
新品防风险
有效时间
2026-09-17 18:41:00
2026-11-30 23:59:59`);
assert.deepEqual(table.models,['华为 Mate XT 2 非凡大师','华为 Pura X View','小米 18 Fold']);
assert.equal(table.start,'2026-09-17 18:41:00');assert.equal(table.end,'2026-11-30 23:59:59');
assert.equal(table.ratio,-2.5);assert.equal(table.fields['策略金额'],'0');assert.equal(table.note,'新品防风险');
assert.equal(table.fields['策略范围'],undefined);assert.equal(table.fields['适用范围'],undefined);
console.log('无冒号、表格型号与有效时间解析测试通过');
