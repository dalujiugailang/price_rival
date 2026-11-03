import {TrackingBatch} from '../types';
type Reply={notModified:boolean;etag?:string;batches?:TrackingBatch[]};
// One account/permission-version entry, no localStorage. Every mount revalidates access.
export function createPriceAnalysisCache(fetcher:(etag?:string)=>Promise<Reply>) {
 let generation=0,key='',cached:{etag?:string;batches:TrackingBatch[]}|null=null;
 let flight:{generation:number;promise:Promise<{success:true;batches:TrackingBatch[]}>}|null=null;
 return {
  load(identity:string) {
   if(identity!==key){key=identity;generation++;cached=null;flight=null;}
   if(flight?.generation===generation)return flight.promise;
   const started=generation,previous=cached;
   const promise=fetcher(previous?.etag).then(result=>{
    if(result.notModified&&!previous)throw new Error('分析缓存已失效，请重新打开页面');
    const data=result.notModified?previous!:{etag:result.etag,batches:result.batches!};
    if(started===generation)cached=data;
    return {success:true as const,batches:data.batches};
   }).catch(error=>{if(started===generation)cached=null;throw error;}).finally(()=>{if(flight?.generation===started)flight=null;});
   flight={generation:started,promise};return promise;
  },
  clear(){generation++;key='';cached=null;flight=null;}
 };
}
