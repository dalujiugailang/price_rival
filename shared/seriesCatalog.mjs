// Product-line positioning is maintained explicitly; never inferred from model age.
export const SERIES_POSITIONS = ['旗舰', '次旗舰', '中端'];
export const INITIAL_SERIES_CATALOG = [
 ['华为','Mate 90 Pro Max','旗舰'],['华为','Mate 90','旗舰'],['华为','Mate 90 Pro','旗舰'],
 ['华为','Pura X Max','旗舰'],['华为','Mate 80','次旗舰'],['华为','Pura 80','次旗舰'],['华为','Mate 90 RS/Lucia','旗舰'],
 ['荣耀','Magic9','旗舰'],['荣耀','Magic9 Pro Max','旗舰'],['荣耀','X80 Pro Max','中端'],
 ['小米','18 Pro Max','旗舰'],['小米','小米 18 Pro','旗舰'],['小米','15 Ultra','次旗舰'],['小米','17 Pro','次旗舰'],
 ['REDMI','REDMI K100 Pro Max','旗舰'],['REDMI','REDMI K100','旗舰'],['REDMI','REDMI Note 17 Pro','中端'],
 ['OPPO','Find X10','旗舰'],['OPPO','Find X10 Pro Max','旗舰'],['OPPO','Find N6','旗舰'],['OPPO','Find X9','次旗舰'],
 ['一加','Ace 7 Pro','旗舰'],['一加','一加 16','旗舰'],['vivo','X500 Pro Max','旗舰'],['vivo','X Fold6','旗舰'],['vivo','X500','旗舰'],
 ['iQOO','iQOO Neo12','次旗舰'],['iQOO','iQOO 16','旗舰'],['iQOO','iQOO 15T','次旗舰'],
 ['三星','Galaxy Z Fold8','旗舰'],['真我','GT8 Pro','旗舰'],['努比亚','Z80 Ultra','旗舰'],['摩托罗拉','moto razr 70 Ultra','旗舰']
].map(([brand,newSeries,newSeriesPosition])=>({brand,newSeries,newSeriesPosition}));
const normalize = value => String(value ?? '').trim().replace(/\s+/g,'').toLowerCase();
const aliases = new Map([['redmi','小米'],['xiaomi','小米'],['huawei','华为'],['honor','荣耀'],['oneplus','一加'],['samsung','三星'],['motorola','摩托罗拉'],['moto','摩托罗拉'],['realme','真我'],['nubia','努比亚']]);
export const seriesCatalogKey = (brand,newSeries) => JSON.stringify([aliases.get(normalize(brand)) || normalize(brand),normalize(newSeries)]);
export function validateSeriesCatalog(entries) {
 if(!Array.isArray(entries) || entries.length>5000) throw new Error('商品库格式无效，最多5000条');
 const keys=new Set();
 return entries.map(entry=>{
  const row={brand:String(entry.brand??'').trim(),newSeries:String(entry.newSeries??'').trim(),newSeriesPosition:String(entry.newSeriesPosition??'').trim()};
  if(!row.brand || !row.newSeries || row.brand.length>100 || row.newSeries.length>200 || !SERIES_POSITIONS.includes(row.newSeriesPosition)) throw new Error('品牌、新机系列不能为空，定位须为旗舰、次旗舰或中端');
  const key=seriesCatalogKey(row.brand,row.newSeries);
  if(keys.has(key)) throw new Error(`商品库存在重复：${row.brand} / ${row.newSeries}`);
  keys.add(key);return row;
 });
}
export const seriesCatalogIndex = entries => new Map(entries.map(row=>[seriesCatalogKey(row.brand,row.newSeries),row.newSeriesPosition]));
export const positionProducts = (products,index) => products.map(product=>({...product,newSeriesPosition:index.get(seriesCatalogKey(product.brand,product.newSeries)) || ''}));
export function missingSeries(products,index) {
 const missing=new Map();
 for(const product of products) {
  const key=seriesCatalogKey(product.brand,product.newSeries);
  if(!index.has(key)) missing.set(key,{brand:product.brand || '',newSeries:product.newSeries || '',newSeriesPosition:''});
 }
 return [...missing.values()];
}
export function positionBatch(batch,index) {
 return {...batch,products:positionProducts(batch.products || [],index),...(batch.restorePayload?{restorePayload:{...batch.restorePayload,productsMaster:positionProducts(batch.restorePayload.productsMaster || [],index)}}:{})};
}

// Use the server-frozen target IDs; never expand the historical backfill window.
export function syncCatalogHistory(batches,catalog) {
 const targets=new Set(catalog.backfilledBatchIds);
 const index=seriesCatalogIndex(catalog.entries);
 return batches.map(batch=>(batch.channelId || 'tradeIn')==='tradeIn' && targets.has(batch.id)?positionBatch(batch,index):batch);
}
