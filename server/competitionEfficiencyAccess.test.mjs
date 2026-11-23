import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAccess, validateAccess, pagesForChannel, DEFAULT_VIEWER_SCOPES } from '../shared/accessPolicy.mjs';
import { listAuthorizedBatches } from './accessProjection.mjs';
test('efficiency is an independent trade-in page permission', () => {
 const user = scopes => ({role:'viewer',enabled:true,scopes});
 assert.equal(canAccess(user(['tradeIn.competitiveness']), 'tradeIn', 'competitionEfficiency'),false);
 assert.equal(canAccess(user(['tradeIn.competitionEfficiency']), 'tradeIn', 'competitionEfficiency'),true);
 assert.equal(canAccess(user(['tradeIn.competitionEfficiency']), 'tradeIn', 'competitiveness'),false);
 assert.equal(canAccess({...user(['tradeIn.competitionEfficiency']),enabled:false}, 'tradeIn', 'competitionEfficiency'),false);
 assert.equal(canAccess({role:'admin'}, 'tradeIn', 'competitionEfficiency'),true);
 assert.equal(pagesForChannel('selfOperated').some(p=>p.id==='competitionEfficiency'),false);
 assert.equal(DEFAULT_VIEWER_SCOPES.includes('tradeIn.competitionEfficiency'),false);
 assert.deepEqual(validateAccess(user(['tradeIn.competitionEfficiency'])).scopes,['tradeIn.competitionEfficiency']);
});
test('efficiency-only viewers get all projected snapshots without workspace secrets',()=>{
 const batches = [1,2].map(id=>({id:String(id),channelId:'tradeIn',restorePayload:{selectedCompetitionPpvs:['p'],secret:1},products:[{ppv:'p',quoteVolume:10,basePrice:12345}]}));
 const result=listAuthorizedBatches({listBatches:()=>batches},{role:'viewer',enabled:true,scopes:['tradeIn.competitionEfficiency']});
 assert.equal(result.length,2);
 assert.deepEqual(result[0].competitionCoveragePpvs,['p']);
 assert.equal(result[0].restorePayload,undefined);
 assert.equal(result[0].products[0].basePrice,undefined);
});
