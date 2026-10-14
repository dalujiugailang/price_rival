import assert from 'node:assert/strict';import {ocrText,OcrLine} from './ocrText';import {parseStrategyText} from './parseStrategyText';
const line=(text:string,x:number,y:number,confidence=.99):OcrLine=>({text,confidence,box:[[x,y],[x+60,y],[x+60,y+20],[x,y+20]]});
const sample=[line('适用型号',0,0),line('手机（1）',0,30),line('华为（9）',80,30),line('华为 Mate XT 2 非凡大师（326618）',180,30),line('策略',0,60),line('-2.5',100,60),line('备注',0,90),line('新品防风险',80,90),line('有效时间',0,120),line('2026-09-17 18:41:00',0,150),line('2026-11-30 23:59:59',0,180)];
const parsed=parseStrategyText(ocrText(sample,true));assert.equal(parsed.models.length,1);assert.equal(parsed.ratio,-2.5);assert.equal(parsed.end,'2026-11-30 23:59:59');
const low=sample.map(x=>x.text==='-2.5'?{...x,confidence:.6}:x);assert.equal(parseStrategyText(ocrText(low,true)).ratio,undefined);assert.ok(ocrText(low).includes('-2.5'));
console.log('OCR coordinates and low confidence tests passed');
