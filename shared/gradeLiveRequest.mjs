// Stable request identity prevents equivalent workspace renders from querying again.
export const gradeRequestKey = request => JSON.stringify([
  request.volumeId, request.templateId, request.workspaceVersion, request.trackingBatchId || '',
  [...request.skuIds].sort(),
  request.prices.map(p=>[p.id,p.ppv,p.skuId,p.model,p.level,p.price,p.newSeries,p.display]).sort(),
  Object.entries(request.priceChoices).sort(), request.subsidyRules
]);

// Short-lived, bounded cache for switching workspace tabs. Failed calls are retryable.
export function createGradeRequestCache(calculate, {now=Date.now, ttl=60000, limit=4}={}) {
  const cache=new Map();
  const load = (request, refresh=false) => {
    const key=gradeRequestKey(request), existing=cache.get(key);
    if (!refresh && existing && existing.expires>now()) return existing.promise;
    const entry={expires:Infinity,promise:null};
    entry.promise=Promise.resolve().then(()=>calculate(request)).then(result=>{
      entry.expires=now()+ttl;
      return result;
    }).catch(error=>{
      if(cache.get(key)===entry)cache.delete(key);
      throw error;
    });
    cache.delete(key);cache.set(key,entry);
    while(cache.size>limit)cache.delete(cache.keys().next().value);
    return entry.promise;
  };
  load.update=(request,result)=>{
    const key=gradeRequestKey(request);
    if(cache.has(key))cache.set(key,{expires:now()+ttl,promise:Promise.resolve(result)});
  };
  return load;
}
