import {canAccess} from '../shared/accessPolicy.mjs';
export function listPriceAnalysisBatches(db,user) {
  if(!canAccess(user,'tradeIn','priceAnalysis')) {
    const error=new Error('未开通京东换新价格分析权限');error.statusCode=403;throw error;
  }
  return db.listBatches('tradeIn');
}
