import {test} from 'node:test';import assert from 'node:assert/strict';import {registerRiskOcr} from './riskOcr.mjs';
test('OCR role, input, single task and upstream failure',async()=>{
 let handler;let finish;const app={post:(_p,_access,h)=>handler=h};
 registerRiskOcr(app,()=>{}, {url:'http://ocr:8080',fetcher:()=>new Promise(r=>finish=r)});
 const run=async(role,image)=>{let status=200,data;const res={status(x){status=x;return this},json(x){data=x}};await handler({authUser:{role},body:{image}},res);return {status,data};};
 const image='data:image/png;base64,aGVsbG8=';
 assert.equal((await run('viewer',image)).status,403);assert.equal((await run('editor',image)).status,403);
 assert.equal((await run('admin','https://example.com')).status,400);
 assert.equal((await run('admin','data:image/png;base64,'+'a'.repeat(14000001))).status,413);
 const active=run('admin',image);assert.equal((await run('admin',image)).status,429);
 finish({ok:true,json:async()=>({lines:[{text:'-2.5',confidence:.95,box:[[0,0],[1,0],[1,1],[0,1]]}],durationMs:100})});assert.equal((await active).status,200);
 registerRiskOcr(app,()=>{},{url:'http://ocr:8080',fetcher:async()=>{throw Error('timeout')}});assert.equal((await run('admin',image)).status,503);
});
