import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canAccess,DEFAULT_VIEWER_SCOPES,pagesForChannel,validateAccess} from '../shared/accessPolicy.mjs';
import {listPriceAnalysisBatches} from './priceAnalysisAccess.mjs';
const member=scopes=>({role:'viewer',enabled:true,scopes});
test('price analysis is explicitly granted and independent of history',()=>{
 const history=member(['tradeIn.history']);
 assert.equal(canAccess(history,'tradeIn','priceAnalysis'),false);
 const analysis=member(['tradeIn.priceAnalysis']);
 assert.equal(canAccess(analysis,'tradeIn','priceAnalysis'),true);
 assert.equal(canAccess(analysis,'tradeIn','history'),false);
 assert.equal(DEFAULT_VIEWER_SCOPES.includes('tradeIn.priceAnalysis'),false);
 assert.equal(pagesForChannel('selfOperated').some(page=>page.id==='priceAnalysis'),false);
 assert.equal(canAccess({...analysis,enabled:false},'tradeIn','priceAnalysis'),false);
 assert.equal(canAccess({role:'admin'},'tradeIn','priceAnalysis'),true);
 assert.deepEqual(validateAccess({role:'viewer',enabled:true,scopes:['tradeIn.priceAnalysis']}).scopes,['tradeIn.priceAnalysis']);
});
test('server data boundary rejects history-only users before reading data',()=>{
 const channels=[];const db={listBatches:channel=>{channels.push(channel);return [{id:'snapshot'}];}};
 assert.throws(()=>listPriceAnalysisBatches(db,member(['tradeIn.history'])),error=>error.statusCode===403);
 assert.deepEqual(channels,[]);
 assert.deepEqual(listPriceAnalysisBatches(db,member(['tradeIn.priceAnalysis'])),[{id:'snapshot'}]);
 assert.deepEqual(channels,['tradeIn']);
});
